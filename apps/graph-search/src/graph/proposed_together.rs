//! Durable projection of entities created by approved proposals in one conversation.
use std::collections::BTreeMap;

use serde::Serialize;
use sqlx::{PgPool, Postgres, Transaction};

use super::{native, store::Scope};

const MAX_BATCH_SIZE: usize = 500;
const MAX_DIAGNOSTICS: usize = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingConversationReport {
    pub count: i64,
    pub samples: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillBatch {
    pub after_conversation_id: Option<String>,
    pub cohorts: usize,
    pub examined_subjects: usize,
    pub ensured_pairs: usize,
    pub inserted_pairs: usize,
    pub invalid_records: usize,
    pub missing_conversations: Option<MissingConversationReport>,
    pub diagnostics: Vec<String>,
}

/// Persist unordered pairs in one database round trip. Conflicts are no-ops so
/// replay preserves original metadata and pair identity outlives event receipts.
pub async fn ensure_pairs(
    tx: &mut Transaction<'_, Postgres>,
    scope: &Scope,
    pairs: impl IntoIterator<Item = (String, String, String)>,
    conversation_id: &str,
) -> anyhow::Result<usize> {
    let mut canonical_pairs = BTreeMap::<(String, String), String>::new();
    for (left, right, created_at) in pairs {
        if left == right {
            continue;
        }
        let endpoints = if left < right {
            (left, right)
        } else {
            (right, left)
        };
        canonical_pairs
            .entry(endpoints)
            .and_modify(|timestamp| {
                if created_at > *timestamp {
                    *timestamp = created_at.clone();
                }
            })
            .or_insert(created_at);
    }
    if canonical_pairs.is_empty() {
        return Ok(0);
    }

    let mut sources = Vec::with_capacity(canonical_pairs.len());
    let mut targets = Vec::with_capacity(canonical_pairs.len());
    let mut timestamps = Vec::with_capacity(canonical_pairs.len());
    for ((source, target), timestamp) in canonical_pairs {
        sources.push(source);
        targets.push(target);
        timestamps.push(timestamp);
    }
    let inserted = sqlx::query(
        "WITH pairs AS (SELECT source_id, target_id, created_at FROM UNNEST($3::text[], $4::text[], $5::text[]) AS pair(source_id,target_id,created_at)) INSERT INTO graph.edge (organization_id,project_id,source_id,target_id,relationship_type,properties,created_at,updated_at,deduplication_key) SELECT $1,$2,pairs.source_id,pairs.target_id,'PROPOSED_TOGETHER',jsonb_build_object('source','system','inferredBy','system','confidence',1.0,'reasoning','Entities were created by approved proposals in the same conversation','conversationId',$6),pairs.created_at::timestamptz,pairs.created_at::timestamptz,pairs.source_id || ':' || pairs.target_id || ':PROPOSED_TOGETHER' FROM pairs ON CONFLICT (organization_id,project_id,deduplication_key) DO NOTHING",
    )
    .bind(&scope.organization)
    .bind(&scope.project)
    .bind(sources)
    .bind(targets)
    .bind(timestamps)
    .bind(conversation_id)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    Ok(inserted as usize)
}

/// Read missing-conversation diagnostics before a backfill starts or resumes.
pub async fn missing_conversations(
    pool: &PgPool,
    scope: &Scope,
) -> anyhow::Result<MissingConversationReport> {
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND entity_type='PROPOSAL' AND properties->>'status'='APPROVED' AND properties->>'action'='CREATE' AND NULLIF(BTRIM(properties->>'conversationId'),'') IS NULL",
    )
    .bind(&scope.organization)
    .bind(&scope.project)
    .fetch_one(pool)
    .await?;
    let samples = sqlx::query_scalar::<_, String>(
        "SELECT id FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND entity_type='PROPOSAL' AND properties->>'status'='APPROVED' AND properties->>'action'='CREATE' AND NULLIF(BTRIM(properties->>'conversationId'),'') IS NULL ORDER BY id LIMIT $3",
    )
    .bind(&scope.organization)
    .bind(&scope.project)
    .bind(MAX_DIAGNOSTICS as i64)
    .fetch_all(pool)
    .await?;
    Ok(MissingConversationReport { count, samples })
}

/// Process at most `batch_size` conversation cohorts and commit each batch.
/// Pass the returned cursor as `after_conversation_id` to resume after failure.
pub async fn run_batch(
    pool: &PgPool,
    scope: &Scope,
    after_conversation_id: Option<&str>,
    batch_size: usize,
) -> anyhow::Result<BackfillBatch> {
    anyhow::ensure!(
        (1..=MAX_BATCH_SIZE).contains(&batch_size),
        "batch size must be between 1 and {MAX_BATCH_SIZE}"
    );

    let missing_conversations = if after_conversation_id.is_none() {
        Some(missing_conversations(pool, scope).await?)
    } else {
        None
    };
    let mut tx = native::begin(pool, scope)
        .await
        .map_err(|error| anyhow::anyhow!("cannot start scoped backfill: {}", error.1))?;
    native::lock_project_cohort(&mut tx, scope).await?;

    let conversations = sqlx::query_scalar::<_, String>(
        "SELECT properties->>'conversationId' AS conversation_id FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND entity_type='PROPOSAL' AND properties->>'status'='APPROVED' AND properties->>'action'='CREATE' AND NULLIF(BTRIM(properties->>'conversationId'),'') IS NOT NULL AND ($3::text IS NULL OR properties->>'conversationId' > $3) GROUP BY properties->>'conversationId' ORDER BY properties->>'conversationId' LIMIT $4",
    )
    .bind(&scope.organization)
    .bind(&scope.project)
    .bind(after_conversation_id)
    .bind(batch_size as i64)
    .fetch_all(&mut *tx)
    .await?;

    let mut result = BackfillBatch {
        after_conversation_id: conversations.last().cloned(),
        cohorts: 0,
        examined_subjects: 0,
        ensured_pairs: 0,
        inserted_pairs: 0,
        invalid_records: 0,
        missing_conversations,
        diagnostics: Vec::new(),
    };

    for conversation_id in &conversations {
        result.cohorts += 1;
        let rows = sqlx::query_as::<_, (String, Option<String>, String, bool)>(
            "SELECT p.id, COALESCE(NULLIF(BTRIM(p.properties->>'resultingEntityId'),''),NULLIF(BTRIM(p.properties->>'targetEntityId'),''),target.target_id) AS subject_id, COALESCE(to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) AS created_at, (endpoint.id IS NOT NULL) AS endpoint_valid FROM graph.node p LEFT JOIN LATERAL (SELECT e.target_id FROM graph.edge e WHERE e.organization_id=p.organization_id AND e.project_id=p.project_id AND e.source_id=p.id AND e.relationship_type='TARGET_OF' ORDER BY e.created_at,e.id LIMIT 1) target ON true LEFT JOIN graph.node endpoint ON endpoint.organization_id=p.organization_id AND endpoint.project_id=p.project_id AND endpoint.id=COALESCE(NULLIF(BTRIM(p.properties->>'resultingEntityId'),''),NULLIF(BTRIM(p.properties->>'targetEntityId'),''),target.target_id) AND (NULLIF(BTRIM(p.properties->>'targetEntityType'),'') IS NULL OR endpoint.entity_type=NULLIF(BTRIM(p.properties->>'targetEntityType'),'')) AND endpoint.project_scoped AND NOT endpoint.deleted AND endpoint.entity_type NOT IN ('PROJECT','USER') WHERE p.organization_id=$1 AND p.project_id=$2 AND p.entity_type='PROPOSAL' AND p.properties->>'status'='APPROVED' AND p.properties->>'action'='CREATE' AND p.properties->>'conversationId'=$3 ORDER BY subject_id NULLS LAST,p.id",
        )
        .bind(&scope.organization)
        .bind(&scope.project)
        .bind(conversation_id)
        .fetch_all(&mut *tx)
        .await?;

        let mut subjects = BTreeMap::<String, String>::new();
        for (proposal_id, subject_id, created_at, endpoint_valid) in rows {
            let Some(subject_id) = subject_id else {
                result.invalid_records += 1;
                add_diagnostic(
                    &mut result.diagnostics,
                    format!(
                        "proposal {proposal_id} has no resultingEntityId, targetEntityId, or TARGET_OF endpoint"
                    ),
                );
                continue;
            };
            if !endpoint_valid {
                result.invalid_records += 1;
                add_diagnostic(
                    &mut result.diagnostics,
                    format!(
                        "proposal {proposal_id} subject {subject_id} has no live canonical endpoint in the requested project"
                    ),
                );
                continue;
            }
            subjects
                .entry(subject_id)
                .and_modify(|existing| {
                    if created_at > *existing {
                        *existing = created_at.clone();
                    }
                })
                .or_insert(created_at);
        }
        result.examined_subjects += subjects.len();
        let entries: Vec<_> = subjects.into_iter().collect();
        let mut pairs = Vec::with_capacity(
            entries
                .len()
                .saturating_mul(entries.len().saturating_sub(1))
                / 2,
        );
        for right_index in 1..entries.len() {
            let (right, right_created_at) = &entries[right_index];
            for (left, left_created_at) in &entries[..right_index] {
                let timestamp = if right_created_at > left_created_at {
                    right_created_at
                } else {
                    left_created_at
                };
                result.ensured_pairs += 1;
                pairs.push((left.clone(), right.clone(), timestamp.clone()));
            }
        }
        result.inserted_pairs += ensure_pairs(&mut tx, scope, pairs, conversation_id).await?;
    }

    tx.commit().await?;
    Ok(result)
}

fn add_diagnostic(diagnostics: &mut Vec<String>, text: String) {
    if diagnostics.len() < MAX_DIAGNOSTICS {
        diagnostics.push(text);
    }
}
