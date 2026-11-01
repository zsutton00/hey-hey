//! PostgreSQL storage for searchable units.
//!
//! Queries use runtime SQLx calls because no database was reachable when they
//! were written; convert them to checked macros once `.sqlx/` can be regenerated.

use std::collections::HashMap;

use anyhow::{Context, Result};
use serde_json::{Map, Value};
use sqlx::{PgPool, Postgres, Transaction};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::wire::{DeletionIdentity, Document, Filter, Level};

/// Words per chunk. Arctic Embed reads at most 512 tokens, so chunks stay well
/// under that; full-text matching always covers the whole chunk text.
const CHUNK_WORDS: usize = 200;

pub struct Unit {
    pub id: String,
    pub chunk_index: i32,
    pub text: String,
}

/// Splits a document into the units that are stored and encoded.
pub fn units(document: &Document) -> Vec<Unit> {
    if document.level == Level::Document {
        return vec![Unit {
            id: document.id.clone(),
            chunk_index: 0,
            text: document.text.clone(),
        }];
    }

    let words: Vec<&str> = document.text.split_whitespace().collect();
    words
        .chunks(CHUNK_WORDS)
        .enumerate()
        .map(|(index, chunk)| Unit {
            id: format!("{}_chunk_{index}", document.id),
            chunk_index: i32::try_from(index).expect("text is limited to 50000 characters"),
            text: chunk.join(" "),
        })
        .collect()
}

/// The organization's projection was deleted; it accepts no new content.
#[derive(Debug)]
pub struct OrganizationClosed;

/// Replaces every unit of the document with the given units.
pub async fn replace_document(
    pool: &PgPool,
    document: &Document,
    units: &[Unit],
    vectors: &[Vec<f32>],
) -> Result<Result<(), OrganizationClosed>> {
    let mut transaction = pool.begin().await?;

    // Serializes with projection deletion, which takes the same lock.
    lock_organization(&mut transaction, &document.organization_id).await?;
    let closed: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM search.projection_deletion WHERE organization_id = $1)",
    )
    .bind(&document.organization_id)
    .fetch_one(&mut *transaction)
    .await?;
    if closed {
        return Ok(Err(OrganizationClosed));
    }

    sqlx::query("DELETE FROM search.unit WHERE organization_id = $1 AND document_id = $2")
        .bind(&document.organization_id)
        .bind(&document.id)
        .execute(&mut *transaction)
        .await?;

    let metadata = Value::Object(document.metadata.clone());
    for (unit, vector) in units.iter().zip(vectors) {
        sqlx::query(
            "INSERT INTO search.unit (organization_id, project_id, id, document_id, chunk_index,
                                      type, task_type, title, text, metadata, created_at, updated_at, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                     $11::timestamptz, $12::timestamptz, $13::text::halfvec)",
        )
        .bind(&document.organization_id)
        .bind(&document.project_id)
        .bind(&unit.id)
        .bind(&document.id)
        .bind(unit.chunk_index)
        .bind(&document.kind)
        .bind(&document.task_type)
        .bind(&document.title)
        .bind(&unit.text)
        .bind(&metadata)
        .bind(document.created_at.map(timestamp_text))
        .bind(document.updated_at.map(timestamp_text))
        .bind(vector_literal(vector))
        .execute(&mut *transaction)
        .await
        .context("Cannot store a searchable unit")?;
    }

    transaction.commit().await?;
    Ok(Ok(()))
}

/// What is stored about a document apart from its text and vectors.
pub struct StoredDocument {
    pub project_id: Option<String>,
    pub kind: String,
    pub task_type: Option<String>,
    pub title: String,
    pub metadata: Map<String, Value>,
    pub created_at: Option<OffsetDateTime>,
    pub updated_at: Option<OffsetDateTime>,
}

#[derive(sqlx::FromRow)]
struct StoredRow {
    project_id: Option<String>,
    #[sqlx(rename = "type")]
    kind: String,
    task_type: Option<String>,
    title: String,
    metadata: Value,
    created_text: Option<String>,
    updated_text: Option<String>,
}

/// Loads a document's stored details, or `None` when it is not searchable.
pub async fn load_document(
    pool: &PgPool,
    organization_id: &str,
    document_id: &str,
) -> Result<Option<StoredDocument>> {
    let row: Option<StoredRow> = sqlx::query_as(
        "SELECT project_id, type, task_type, title, metadata,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS created_text,
                to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS updated_text
         FROM search.unit
         WHERE organization_id = $1 AND document_id = $2
         ORDER BY chunk_index LIMIT 1",
    )
    .bind(organization_id)
    .bind(document_id)
    .fetch_optional(pool)
    .await
    .context("Cannot load a stored document")?;

    row.map(|row| {
        let Value::Object(metadata) = row.metadata else {
            anyhow::bail!("Stored metadata of a document is not an object");
        };
        let instant = |text: Option<String>| {
            text.map(|text| OffsetDateTime::parse(&text, &Rfc3339))
                .transpose()
                .context("Stored timestamp is not RFC 3339")
        };
        Ok(StoredDocument {
            project_id: row.project_id,
            kind: row.kind,
            task_type: row.task_type,
            title: row.title,
            metadata,
            created_at: instant(row.created_text)?,
            updated_at: instant(row.updated_text)?,
        })
    })
    .transpose()
}

/// Merges the given metadata into every unit of a document without
/// re-encoding. Returns whether the document exists.
pub async fn patch_document(
    pool: &PgPool,
    organization_id: &str,
    document_id: &str,
    patch: &Map<String, Value>,
    title: Option<&str>,
    updated_at: Option<OffsetDateTime>,
) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE search.unit
         SET metadata = metadata || $3::jsonb,
             title = COALESCE($4, title),
             updated_at = COALESCE($5::timestamptz, updated_at)
         WHERE organization_id = $1 AND document_id = $2",
    )
    .bind(organization_id)
    .bind(document_id)
    .bind(Value::Object(patch.clone()))
    .bind(title)
    .bind(updated_at.map(timestamp_text))
    .execute(pool)
    .await
    .context("Cannot update a stored document")?;
    Ok(result.rows_affected() > 0)
}

/// How many levels of child tasks an archived task takes with it.
const MAX_TASK_DEPTH: i32 = 5;

/// Removes a task and the tasks nested under it, so none of them stay
/// searchable. Returns how many units were removed; none is not an error,
/// because a repeated archive converges on the same state.
pub async fn delete_task_tree(
    pool: &PgPool,
    organization_id: &str,
    project_id: &str,
    task_id: &str,
) -> Result<u64> {
    let result = sqlx::query(
        "WITH RECURSIVE tree (document_id, depth) AS (
             SELECT $3::text, 0
             UNION
             SELECT u.document_id, t.depth + 1
             FROM search.unit u
             JOIN tree t ON u.metadata ->> 'parentTaskId' = t.document_id
             WHERE u.organization_id = $1 AND u.project_id = $2 AND u.type = 'task'
               AND t.depth < $4
         )
         DELETE FROM search.unit
         WHERE organization_id = $1 AND document_id IN (SELECT document_id FROM tree)",
    )
    .bind(organization_id)
    .bind(project_id)
    .bind(task_id)
    .bind(MAX_TASK_DEPTH)
    .execute(pool)
    .await
    .context("Cannot remove an archived task")?;
    Ok(result.rows_affected())
}

/// A unit found by text, by meaning, or both, with its raw signal scores.
/// Text and metadata are loaded later, only for the returned page.
#[derive(sqlx::FromRow)]
pub struct Candidate {
    pub id: String,
    pub chunk_index: i32,
    #[sqlx(rename = "type")]
    pub kind: String,
    pub task_type: Option<String>,
    pub created_epoch: Option<f64>,
    /// Cosine similarity to the query vector.
    pub semantic: Option<f64>,
    /// Full-text rank plus trigram similarity.
    pub keyword: Option<f64>,
}

pub struct Retrieval<'a> {
    pub organization_id: &'a str,
    pub project_id: Option<&'a str>,
    pub filter: &'a Filter,
    pub keyword_text: Option<&'a str>,
    pub title_only: bool,
    pub vector: Option<&'a [f32]>,
}

/// Scores every unit that passes the filters. Searches are scoped to one
/// organization (and usually one project), so these are exact scans, and
/// ranking the complete set lets any offset reach every match.
const RETRIEVE: &str = r#"
WITH scoped AS (
    SELECT u.*
    FROM search.unit u
    WHERE u.organization_id = $1
      AND ($2::text IS NULL OR u.project_id = $2)
      AND u.metadata @> $3::jsonb
      AND ($4::text[] IS NULL OR lower(u.type) = ANY ($4) OR lower(u.task_type) = ANY ($4))
      AND ($5::text[] IS NULL OR u.metadata ->> 'status' = ANY ($5))
      AND ($6::text[] IS NULL OR u.task_type = ANY ($6))
      AND ($7::text[] IS NULL OR u.task_type IS NULL OR u.task_type <> ALL ($7))
      AND ($8::text[] IS NULL OR u.metadata -> 'tags' ?| $8)
      AND ($9::text[] IS NULL OR u.metadata -> 'topologySubfacets' ?| $9)
      AND ($10::text[] IS NULL OR u.metadata ->> 'serviceId' = ANY ($10) OR u.metadata -> 'serviceIds' ?| $10)
      AND ($11::text[] IS NULL OR u.metadata ->> 'sourceId' IS NULL OR u.metadata ->> 'sourceId' <> ALL ($11))
      AND ($12::timestamptz IS NULL OR u.created_at >= $12::timestamptz)
      AND ($13::timestamptz IS NULL OR u.created_at <= $13::timestamptz)
      AND ($14::timestamptz IS NULL OR u.updated_at >= $14::timestamptz)
      AND ($15::timestamptz IS NULL OR u.updated_at <= $15::timestamptz)
      AND NOT EXISTS (
          SELECT 1 FROM unnest($16::text[]) AS term
          WHERE NOT u.search_text @@ phraseto_tsquery('english', term))
),
-- Any query word ranks a unit, rather than requiring all of them.
lexical AS (
    SELECT replace(websearch_to_tsquery('english', coalesce($17, ''))::text, '&', '|')::tsquery AS query
),
semantic AS (
    SELECT s.id, 1 - (s.embedding <=> $18::text::halfvec) AS score
    FROM scoped s
    WHERE $18::text IS NOT NULL
),
keyword AS (
    SELECT s.id,
           CASE WHEN $19
                THEN greatest(similarity(s.title, $17), word_similarity($17, s.title))
                ELSE ts_rank_cd(s.search_text, l.query, 32)
                     + greatest(similarity(s.title, $17), word_similarity($17, s.text))
           END AS score
    FROM scoped s, lexical l
    WHERE $17::text IS NOT NULL
      AND CASE WHEN $19
               THEN s.title % $17 OR $17 <% s.title
               ELSE s.search_text @@ l.query OR s.title % $17 OR $17 <% s.text
          END
)
SELECT s.id, s.chunk_index, s.type, s.task_type,
       extract(epoch FROM s.created_at)::float8 AS created_epoch,
       sem.score::float8 AS semantic,
       kw.score::float8 AS keyword
FROM scoped s
LEFT JOIN semantic sem ON sem.id = s.id
LEFT JOIN keyword kw ON kw.id = s.id
WHERE sem.id IS NOT NULL OR kw.id IS NOT NULL
"#;

pub async fn retrieve(pool: &PgPool, retrieval: Retrieval<'_>) -> Result<Vec<Candidate>> {
    let filter = retrieval.filter;
    let candidates = sqlx::query_as::<_, Candidate>(RETRIEVE)
        .bind(retrieval.organization_id)
        .bind(retrieval.project_id)
        .bind(Value::Object(filter.equals.clone()))
        .bind(&filter.types)
        .bind(&filter.statuses)
        .bind(&filter.task_types)
        .bind(&filter.exclude_task_types)
        .bind(&filter.tags)
        .bind(&filter.topology_subfacets)
        .bind(&filter.service_ids)
        .bind(&filter.exclude_source_ids)
        .bind(filter.created_after.map(timestamp_text))
        .bind(filter.created_before.map(timestamp_text))
        .bind(filter.updated_after.map(timestamp_text))
        .bind(filter.updated_before.map(timestamp_text))
        .bind(&filter.must)
        .bind(retrieval.keyword_text)
        .bind(retrieval.vector.map(vector_literal))
        .bind(retrieval.title_only)
        .fetch_all(pool)
        .await
        .context("Search query failed")?;
    Ok(candidates)
}

pub struct UnitContent {
    pub text: String,
    pub metadata: Value,
}

/// Loads the text and metadata of the given units.
pub async fn load_content(
    pool: &PgPool,
    organization_id: &str,
    ids: &[String],
) -> Result<HashMap<String, UnitContent>> {
    let rows: Vec<(String, String, Value)> = sqlx::query_as(
        "SELECT id, text, metadata FROM search.unit WHERE organization_id = $1 AND id = ANY ($2)",
    )
    .bind(organization_id)
    .bind(ids)
    .fetch_all(pool)
    .await
    .context("Cannot load search results")?;
    Ok(rows
        .into_iter()
        .map(|(id, text, metadata)| (id, UnitContent { text, metadata }))
        .collect())
}

pub struct Totals {
    pub units: i64,
    pub average_length: f64,
}

/// Unit totals for one organization, or for all when `None` (development admins).
pub async fn totals(pool: &PgPool, organization_id: Option<&str>) -> Result<Totals> {
    let (units, average_length): (i64, Option<f64>) = sqlx::query_as(
        "SELECT count(*), avg(char_length(text))::float8 FROM search.unit
         WHERE $1::text IS NULL OR organization_id = $1",
    )
    .bind(organization_id)
    .fetch_one(pool)
    .await?;
    Ok(Totals {
        units,
        average_length: average_length.unwrap_or(0.0),
    })
}

pub enum DeletionOutcome {
    Deleted,
    Conflict(DeletionIdentity),
}

/// Records the tombstone (or loads the retained one), then deletes and
/// verifies the absence of the organization's searchable content.
pub async fn delete_organization(
    pool: &PgPool,
    identity: &DeletionIdentity,
) -> Result<DeletionOutcome> {
    let mut transaction = pool.begin().await?;
    lock_organization(&mut transaction, &identity.organization_id).await?;

    sqlx::query(
        "INSERT INTO search.projection_deletion
             (organization_id, marker_id, irreversible_closure_at, deletion_deadline)
         VALUES ($1, $2::uuid, $3::timestamptz, $4::timestamptz)
         ON CONFLICT (organization_id) DO NOTHING",
    )
    .bind(&identity.organization_id)
    .bind(&identity.marker_id)
    .bind(timestamp_text(identity.irreversible_closure_at))
    .bind(timestamp_text(identity.deletion_deadline))
    .execute(&mut *transaction)
    .await?;

    let (marker_id, closure_micros, deadline_micros): (String, i64, i64) = sqlx::query_as(
        "SELECT marker_id::text,
                (extract(epoch FROM irreversible_closure_at) * 1000000)::int8,
                (extract(epoch FROM deletion_deadline) * 1000000)::int8
         FROM search.projection_deletion WHERE organization_id = $1",
    )
    .bind(&identity.organization_id)
    .fetch_one(&mut *transaction)
    .await?;
    let retained = DeletionIdentity {
        organization_id: identity.organization_id.clone(),
        marker_id,
        irreversible_closure_at: from_micros(closure_micros)?,
        deletion_deadline: from_micros(deadline_micros)?,
    };
    if retained != *identity {
        return Ok(DeletionOutcome::Conflict(retained));
    }

    sqlx::query("DELETE FROM search.unit WHERE organization_id = $1")
        .bind(&identity.organization_id)
        .execute(&mut *transaction)
        .await?;
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM search.unit WHERE organization_id = $1")
            .bind(&identity.organization_id)
            .fetch_one(&mut *transaction)
            .await?;
    anyhow::ensure!(
        remaining == 0,
        "Organization content remained after deletion"
    );

    transaction.commit().await?;
    Ok(DeletionOutcome::Deleted)
}

async fn lock_organization(
    transaction: &mut Transaction<'_, Postgres>,
    organization_id: &str,
) -> Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(organization_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

fn timestamp_text(instant: OffsetDateTime) -> String {
    instant
        .format(&Rfc3339)
        .expect("valid instants format as RFC 3339")
}

fn from_micros(micros: i64) -> Result<OffsetDateTime> {
    Ok(OffsetDateTime::from_unix_timestamp_nanos(
        i128::from(micros) * 1000,
    )?)
}

fn vector_literal(vector: &[f32]) -> String {
    let values: Vec<String> = vector.iter().map(f32::to_string).collect();
    format!("[{}]", values.join(","))
}
