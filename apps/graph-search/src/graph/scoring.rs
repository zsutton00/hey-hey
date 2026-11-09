use super::{generated::SearchRequest, store::Candidate};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub fn weights(request: &SearchRequest) -> Value {
    if let Some(weights) = request
        .scoring
        .as_ref()
        .and_then(|s| s.relationship_weights.as_ref())
        .filter(|v| !v.is_empty())
    {
        return weights
            .iter()
            .map(|w| (w.kind.clone(), json!(w.weight as f32)))
            .collect();
    }
    json!({"SCOPED_TO_PROJECT":0.2,"SCOPED_TO_ORG":0.1,"HAS_INITIATIVE":1.0,
        "HAS_PLAN_STAGE":1.1,"HAS_PLAN_STEP":1.1,"HAS_TASK":0.9,"HAS_AGENT_SESSION":0.95,
        "HAS_IMPLEMENTATION_HINT":0.9,"HAS_DESIGN_DOC":0.9,"HAS_SUB_DOC":0.6,"HAS_MESSAGE":0.5,
        "MESSAGE_FOLLOWS":0.2,"MENTIONS":0.4,"ABOUT":0.8,"PLAN_TRACKS":1.35,
        "PLAN_STAGE_TRACKS":1.45,"PLAN_STEP_TRACKS":1.55,"BLOCKS":1.5,"TRACKS":1.0,
        "CREATED_VIA":0.6,"DERIVES_FROM":0.4,"INFLUENCES":0.7,"DEPENDS_ON":0.6,
        "RELATED_TO":0.6,"SUPERSEDES":0.6,"CONTRADICTS":0.6,"EVOLVES":0.6,"GUARANTEES":0.6,
        "IMPLEMENTS":0.6,"CONSUMES":0.6,"FULFILLED_BY":0.6,"STANDARD":0.6,"CONDITIONAL":0.6,"LOOP":0.6})
}
#[derive(Clone)]
pub struct Ranked {
    pub candidate: Candidate,
    pub count: i64,
    pub score: f64,
    pub penalty: f64,
    pub evidence: BTreeSet<String>,
}
pub fn rank(candidates: &[Candidate], request: &SearchRequest) -> Vec<Ranked> {
    let penalty = request
        .scoring
        .as_ref()
        .and_then(|s| s.depth_penalty)
        .unwrap_or(0.15) as f32;
    let mut by_id: BTreeMap<String, (Ranked, BTreeSet<String>)> = BTreeMap::new();
    for candidate in candidates {
        let mut boost = 0.0;
        if let Some(boosts) = &request.boosts {
            for b in boosts
                .entity_ids
                .iter()
                .flatten()
                .filter(|b| b.id == candidate.id)
            {
                boost += b.weight;
            }
            {
                for b in boosts
                    .entity_types
                    .iter()
                    .flatten()
                    .filter(|b| b.kind == candidate.entity_type)
                {
                    boost += b.weight;
                }
            }
        }
        let depth_penalty = (penalty * candidate.depth as f32) as f64;
        let score = candidate.weight + boost - depth_penalty;
        let (entry, seeds) = by_id.entry(candidate.id.clone()).or_insert_with(|| {
            (
                Ranked {
                    candidate: candidate.clone(),
                    count: 0,
                    score,
                    penalty: depth_penalty,
                    evidence: BTreeSet::new(),
                },
                BTreeSet::new(),
            )
        });
        if score > entry.score || score == entry.score && candidate.depth < entry.candidate.depth {
            entry.candidate = candidate.clone();
            entry.score = score;
            entry.penalty = depth_penalty;
        }
        entry.count += candidate.count;
        entry
            .evidence
            .extend(candidate.evidence.iter().flatten().cloned());
        seeds.insert(candidate.seed.clone());
    }
    let mut ranked: Vec<_> = by_id
        .into_values()
        .map(|(mut r, seeds)| {
            r.score += ((0.2_f32 as f64) * (seeds.len().saturating_sub(1) as f64).ln_1p()
                + (0.1_f32 as f64) * (r.count.saturating_sub(1) as f64).ln_1p())
            .clamp(0.0, 0.35_f32 as f64);
            r
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.candidate.id.cmp(&b.candidate.id))
    });
    ranked
}
