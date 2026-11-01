use super::{
    generated::*,
    scoring,
    store::{self, Edge, Node, Scope},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet};

pub async fn search(pool: &PgPool, scope: &Scope, request: SearchRequest) -> anyhow::Result<Value> {
    if let Some(structured) = &request.structured_read {
        return store::structured(pool, scope, structured).await;
    }
    let seeds: Vec<_> = request
        .seed_entity_ids
        .iter()
        .flatten()
        .chain(request.seed_node_ids.iter().flatten())
        .cloned()
        .collect();
    let mut query = serde_json::to_value(&request)?;
    query["_weights"] = scoring::weights(&request);
    query["_canonicalTypes"] = json!(ENTITY_TYPES);
    let candidates = store::walk(pool, scope, &seeds, &query).await?;
    if request.projection.as_deref() == Some("IDENTITIES_BY_SEED") {
        let groups:Vec<_>=seeds.iter().map(|seed| {
            let ids:BTreeSet<_>=candidates.iter().filter(|c|&c.seed==seed).map(|c|&c.id).collect();
            json!({"seedNodeId":seed,"targets":ids.iter().filter_map(|id| candidates.iter().find(|c| &c.id == *id)).map(|c| json!({"entityId":c.id,"entityType":c.entity_type})).collect::<Vec<_>>()})
        }).collect();
        return Ok(json!({"identitiesBySeed":groups}));
    }
    let all = scoring::rank(&candidates, &request);
    let mut response = page(pool, scope, &request, &all).await?;
    if request.group_results_by_seed == Some(true) {
        let mut groups = Vec::new();
        let mut seen_seeds = BTreeSet::new();
        for seed in &seeds {
            if !seen_seeds.insert(seed) {
                continue;
            }
            let selected: Vec<_> = candidates
                .iter()
                .filter(|c| &c.seed == seed)
                .cloned()
                .collect();
            let ranked = scoring::rank(&selected, &request);
            let mut group = page(pool, scope, &request, &ranked).await?;
            group["seedNodeId"] = json!(seed);
            groups.push(group);
        }
        response["seedResults"] = json!(groups);
    }
    Ok(response)
}
async fn page(
    pool: &PgPool,
    scope: &Scope,
    request: &SearchRequest,
    ranked: &[scoring::Ranked],
) -> anyhow::Result<Value> {
    let page = request.page.unwrap_or(0) as usize;
    let size = request.size.unwrap_or(20) as usize;
    let selected: Vec<_> = ranked
        .iter()
        .skip(page.saturating_mul(size))
        .take(size)
        .collect();
    let ids: Vec<_> = selected.iter().map(|r| r.candidate.id.clone()).collect();
    let nodes: BTreeMap<_, _> = store::nodes(pool, scope, &ids)
        .await?
        .into_iter()
        .map(|n| (n.id.clone(), n))
        .collect();
    let compact = request.projection.as_deref() == Some("COMPACT_RANKED");
    let edge_ids: Vec<_> = if compact {
        Vec::new()
    } else {
        selected
            .iter()
            .flat_map(|r| r.evidence.iter().cloned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    };
    let edges: BTreeMap<_, _> = store::edges(pool, scope, &edge_ids)
        .await?
        .into_iter()
        .map(|e| (e.id.clone(), e))
        .collect();
    let mut results = Vec::new();
    for r in selected {
        let c = &r.candidate;
        let node = nodes
            .get(&c.id)
            .ok_or_else(|| anyhow::anyhow!("Selected graph node disappeared"))?;
        let mut hit = json!({"node":node.wire(scope),"entityId":c.id,"entityType":node.entity_type,
            "score":r.score as f32,"scoreBreakdown":{"relationshipWeight":c.weight as f32,"depthPenalty":r.penalty as f32,"totalScore":r.score as f32}});
        if !compact {
            let mut segments = Vec::new();
            for (i, id) in c.edges.iter().enumerate() {
                let e = edges
                    .get(id)
                    .ok_or_else(|| anyhow::anyhow!("Selected graph edge disappeared"))?;
                segments.push(json!({"type":e.relationship_type,"direction":if e.source_id==c.nodes[i] {"OUTGOING"} else {"INCOMING"},
                    "sourceNodeId":c.nodes[i],"targetNodeId":c.nodes[i+1]}));
            }
            hit["path"] = json!({"depth":c.depth,"nodeIds":c.nodes,"segments":segments});
            if request.track_path_count == Some(true) {
                hit["pathCount"] = json!(r.count);
            }
        }
        results.push(hit);
    }
    let mut result = json!({"results":results,"totalElements":ranked.len(),"page":page,"size":size,"totalPages":ranked.len().div_ceil(size)});
    if !compact {
        result["relationships"] = json!(if request.include_relationships == Some(true) {
            edges.values().map(Edge::wire).collect::<Vec<_>>()
        } else {
            Vec::new()
        });
    }
    Ok(result)
}

pub fn validate_search(request: &SearchRequest) -> Result<(), String> {
    if request.projection.as_deref() == Some("STRUCTURED_READ") {
        let structured = request
            .structured_read
            .as_ref()
            .ok_or("STRUCTURED_READ requires structuredRead")?;
        let unique: BTreeSet<_> = structured.expansions.iter().map(|e| &e.key).collect();
        if unique.len() != structured.expansions.len() {
            return Err("Expansion keys must be unique".into());
        }
        return Ok(());
    }
    if request.structured_read.is_some() {
        return Err("structuredRead requires STRUCTURED_READ projection".into());
    }
    if request.seed_entity_ids.as_ref().is_none_or(Vec::is_empty)
        && request.seed_node_ids.as_ref().is_none_or(Vec::is_empty)
    {
        return Err("seedEntityIds or seedNodeIds is required".into());
    }
    if let Some(traversal) = &request.traversal {
        let included: BTreeSet<_> = traversal.relationship_types.iter().flatten().collect();
        if traversal
            .exclude_relationship_types
            .iter()
            .flatten()
            .any(|t| included.contains(t))
        {
            return Err("Relationship include and exclude filters cannot overlap".into());
        }
    }
    Ok(())
}

pub async fn incident(
    pool: &PgPool,
    scope: &Scope,
    request: IncidentEdgesRequest,
) -> anyhow::Result<Value> {
    let edges = store::incident(
        pool,
        scope,
        &request.seed_entity_ids,
        &request.relationship_types,
    )
    .await?;
    let ids: Vec<_> = edges
        .iter()
        .flat_map(|e| [e.source_id.clone(), e.target_id.clone()])
        .collect();
    let nodes: BTreeMap<_, _> = store::nodes(pool, scope, &ids)
        .await?
        .into_iter()
        .map(|n| (n.id.clone(), n))
        .collect();
    let weights = scoring::weights(&SearchRequest::default());
    let mut groups = Vec::new();
    let mut seen = BTreeSet::new();
    for seed in request.seed_entity_ids {
        if !seen.insert(seed.clone()) {
            continue;
        }
        let mut neighbors: BTreeMap<String, Vec<&Edge>> = BTreeMap::new();
        for edge in &edges {
            let other = if edge.source_id == seed {
                &edge.target_id
            } else if edge.target_id == seed {
                &edge.source_id
            } else {
                continue;
            };
            neighbors.entry(other.clone()).or_default().push(edge);
        }
        let total = neighbors.len();
        let mut neighbors: Vec<_> = neighbors.into_iter().collect();
        let score = |edges: &[&Edge]| {
            let mean = edges
                .iter()
                .map(|e| weights[&e.relationship_type].as_f64().unwrap_or(1.0))
                .sum::<f64>()
                / edges.len() as f64;
            mean + (0.1 * (edges.len().saturating_sub(1) as f64).ln_1p()).min(0.35) - 0.15
        };
        if total > 100 {
            neighbors.sort_by(|a, b| {
                score(&b.1)
                    .total_cmp(&score(&a.1))
                    .then_with(|| a.0.cmp(&b.0))
            });
            neighbors.truncate(100);
        }
        let endpoints: Vec<_> = neighbors
            .iter()
            .filter_map(|(id, _)| nodes.get(id))
            .map(|n| n.display(true))
            .collect();
        let relationships: Vec<_> = neighbors
            .iter()
            .flat_map(|(_, e)| e.iter().map(|e| e.wire()))
            .collect();
        groups.push(json!({"seedEntityId":seed,"neighborTotal":total,"relationships":relationships,"endpoints":endpoints}));
    }
    Ok(json!({"groups":groups}))
}
const DEFAULT_NEIGHBOR_TYPES: &[&str] = &[
    "HAS_TASK",
    "HAS_PLAN_STAGE",
    "HAS_PLAN_STEP",
    "HAS_DESIGN_DOC",
    "HAS_AGENT_SESSION",
    "HAS_IMPLEMENTATION_HINT",
    "PLAN_TRACKS",
    "PLAN_STAGE_TRACKS",
    "PLAN_STEP_TRACKS",
    "RELATED_TO",
    "DEPENDS_ON",
    "DERIVES_FROM",
    "SUPERSEDES",
    "CONTRADICTS",
    "EVOLVES",
    "GUARANTEES",
    "IMPLEMENTS",
    "CONSUMES",
    "FULFILLED_BY",
    "BLOCKS",
    "CREATED_VIA",
    "INFLUENCES",
    "MENTIONS",
    "PROPOSED_TOGETHER",
    "TRACKS",
];
fn structural(kind: &str) -> bool {
    matches!(
        kind,
        "HAS_TASK" | "HAS_PLAN_STAGE" | "HAS_PLAN_STEP" | "PLAN_TRACKS" | "PLAN_STAGE_TRACKS"
    )
}
fn relationship(kind: &str, outgoing: bool) -> Option<&'static str> {
    match kind {
        "MENTIONS" => Some(if outgoing { "mentions" } else { "mentioned-by" }),
        "CREATED_VIA" => Some("created-via"),
        "BLOCKS" => Some(if outgoing { "blocks" } else { "blocked-by" }),
        "TRACKS" => Some(if outgoing { "tracked-by" } else { "tracks" }),
        "PROPOSED_TOGETHER" => Some("proposed-together"),
        _ => None,
    }
}
pub async fn neighborhood(
    pool: &PgPool,
    scope: &Scope,
    request: EntityNeighborhoodRequest,
) -> anyhow::Result<Value> {
    let seed = &request.seed_entity_id;
    let types: Vec<_> = request
        .relationship_types
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| {
            DEFAULT_NEIGHBOR_TYPES
                .iter()
                .map(|s| s.to_string())
                .collect()
        })
        .into_iter()
        .filter(|t| !matches!(t.as_str(), "STANDARD" | "CONDITIONAL" | "LOOP"))
        .collect();
    if types.is_empty() {
        return Ok(json!({"relatedEntities":[],"agentSessions":[],"nodeCatalog":[]}));
    }
    let query = json!({"_canonicalTypes":ENTITY_TYPES,"_neighborhood":true,"includeSeedEntities":true,"traversal":{"depth":request.depth.unwrap_or(2),"relationshipTypes":types},"_weights":scoring::weights(&SearchRequest::default())});
    let candidates = store::walk(pool, scope, std::slice::from_ref(seed), &query).await?;
    let ranked = scoring::rank(&candidates, &SearchRequest::default());
    let selected: Vec<_> = ranked.iter().take(500).collect();
    let ids: Vec<_> = selected.iter().map(|r| r.candidate.id.clone()).collect();
    let nodes: BTreeMap<_, _> = store::nodes(pool, scope, &ids)
        .await?
        .into_iter()
        .map(|n| (n.id.clone(), n))
        .collect();
    let entries: BTreeMap<_, _> = selected
        .iter()
        .filter_map(|r| {
            nodes
                .get(&r.candidate.id)
                .map(|n| (n.id.clone(), (n, r.candidate.depth)))
        })
        .collect();
    let ids: Vec<_> = selected
        .iter()
        .flat_map(|r| r.evidence.iter().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let edges = store::edges(pool, scope, &ids).await?;
    let edges: Vec<_> = edges
        .iter()
        .filter(|e| {
            e.source_id == *seed || e.target_id == *seed || structural(&e.relationship_type)
        })
        .collect();
    let features: BTreeSet<_> = request
        .feature_ids
        .unwrap_or_default()
        .into_iter()
        .collect();
    let parents: BTreeSet<_> = edges
        .iter()
        .filter(|e| {
            e.target_id == *seed
                && e.relationship_type == "HAS_TASK"
                && !features.contains(&e.source_id)
                && entries
                    .get(&e.source_id)
                    .is_some_and(|(n, _)| n.entity_type == "TASK")
        })
        .map(|e| e.source_id.clone())
        .collect();
    let pivots: BTreeSet<_> = features
        .into_iter()
        .chain(request.plan_pivot_entity_ids.unwrap_or_default())
        .chain(parents.iter().cloned())
        .collect();
    let eligible: BTreeSet<_> = edges
        .iter()
        .filter(|e| {
            e.target_id == *seed
                && e.relationship_type == "HAS_TASK"
                && pivots.contains(&e.source_id)
        })
        .map(|e| e.source_id.clone())
        .collect();
    let excluded = |n: &Node| {
        n.id == *seed
            || matches!(n.entity_type.as_str(), "ARTIFACT" | "AGENT_SESSION")
            || pivots.contains(&n.id)
    };
    let mut related = Vec::new();
    let mut seen = BTreeSet::new();
    let mut direct = BTreeSet::new();
    for edge in &edges {
        let (other, outgoing) = if edge.source_id == *seed {
            (&edge.target_id, true)
        } else if edge.target_id == *seed {
            (&edge.source_id, false)
        } else {
            continue;
        };
        let Some((node, _)) = entries.get(other) else {
            continue;
        };
        if excluded(node) {
            continue;
        }
        if let Some(label) = relationship(&edge.relationship_type, outgoing)
            && seen.insert((node.id.clone(), label))
        {
            let mut entry = node.display(false);
            entry["relationship"] = json!(label);
            related.push(entry);
            direct.insert(node.id.clone());
        }
    }
    for parent in parents {
        if let Some((node, _)) = entries.get(&parent) {
            let mut entry = node.display(false);
            entry["relationship"] = json!("parent");
            related.push(entry);
        }
    }
    for (node, _) in entries.values() {
        if excluded(node) || direct.contains(&node.id) {
            continue;
        }
        let pivot = edges.iter().find(|e| {
            e.target_id == node.id
                && structural(&e.relationship_type)
                && eligible.contains(&e.source_id)
        });
        if let Some(pivot) = pivot
            && let Some((parent, _)) = entries.get(&pivot.source_id)
        {
            let mut entry = node.display(false);
            entry["relationship"] = json!("sibling-via-parent");
            let mut via = parent.display(false);
            via["relationship"] = json!("sibling-via-parent");
            via.as_object_mut()
                .expect("display object")
                .remove("status");
            via.as_object_mut()
                .expect("display object")
                .remove("taskType");
            entry["via"] = json!([via]);
            related.push(entry);
        }
    }
    let sessions: Vec<_> = entries
        .values()
        .filter(|(n, d)| n.id != *seed && n.entity_type == "AGENT_SESSION" && *d <= 1)
        .map(|(n, _)| n.display(false))
        .collect();
    let catalog: Vec<_> = entries
        .values()
        .filter(|(n, _)| {
            n.id != *seed && !matches!(n.entity_type.as_str(), "ARTIFACT" | "AGENT_SESSION")
        })
        .map(|(n, _)| n.display(false))
        .collect();
    Ok(json!({"relatedEntities":related,"agentSessions":sessions,"nodeCatalog":catalog}))
}
