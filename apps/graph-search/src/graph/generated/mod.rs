// Generated from openapi/specs/graphs/openapi.yaml. Do not edit.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct GraphEntityIdentity {
    #[serde(rename = "entityId")]
    pub entity_id: String,
    #[serde(rename = "entityType")]
    pub entity_type: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct StructuredGraphReadHop {
    #[serde(rename = "relationshipType")]
    pub relationship_type: String,
    #[serde(rename = "direction")]
    pub direction: String,
    #[serde(rename = "entityTypes")]
    pub entity_types: Vec<String>,
    #[serde(
        rename = "workItemTypeKeys",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub work_item_type_keys: Option<Vec<String>>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct StructuredGraphReadExpansion {
    #[serde(rename = "key")]
    pub key: String,
    #[serde(rename = "seeds")]
    pub seeds: Vec<GraphEntityIdentity>,
    #[serde(rename = "path")]
    pub path: Vec<StructuredGraphReadHop>,
    #[serde(rename = "excludeRoot")]
    pub exclude_root: bool,
    #[serde(rename = "limit")]
    pub limit: i64,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct StructuredGraphReadRequest {
    #[serde(rename = "root")]
    pub root: GraphEntityIdentity,
    #[serde(rename = "seeds")]
    pub seeds: Vec<GraphEntityIdentity>,
    #[serde(rename = "directEdgeTypes")]
    pub direct_edge_types: Vec<String>,
    #[serde(rename = "expansions")]
    pub expansions: Vec<StructuredGraphReadExpansion>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct TraversalPathExpansionHop {
    #[serde(rename = "direction", default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct TraversalPathExpansion {
    #[serde(
        rename = "seedEntityTypes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub seed_entity_types: Option<Vec<String>>,
    #[serde(rename = "relationshipChain")]
    pub relationship_chain: Vec<TraversalPathExpansionHop>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct TraversalOptions {
    #[serde(rename = "direction", default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(rename = "depth", default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<i64>,
    #[serde(
        rename = "relationshipTypes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub relationship_types: Option<Vec<String>>,
    #[serde(
        rename = "excludeRelationshipTypes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub exclude_relationship_types: Option<Vec<String>>,
    #[serde(
        rename = "pathExpansions",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub path_expansions: Option<Vec<TraversalPathExpansion>>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SearchFiltersDateRange {
    #[serde(rename = "from", default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(rename = "to", default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SearchFiltersUpdatedAtRange {
    #[serde(rename = "from", default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(rename = "to", default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SearchFilters {
    #[serde(
        rename = "entityTypes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub entity_types: Option<Vec<String>>,
    #[serde(rename = "labels", default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(rename = "statuses", default, skip_serializing_if = "Option::is_none")]
    pub statuses: Option<Vec<String>>,
    #[serde(rename = "taskTypes", default, skip_serializing_if = "Option::is_none")]
    pub task_types: Option<Vec<String>>,
    #[serde(
        rename = "excludeTaskTypes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub exclude_task_types: Option<Vec<String>>,
    #[serde(
        rename = "excludeReportTypes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub exclude_report_types: Option<Vec<String>>,
    #[serde(rename = "tags", default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(rename = "dateRange", default, skip_serializing_if = "Option::is_none")]
    pub date_range: Option<SearchFiltersDateRange>,
    #[serde(
        rename = "updatedAtRange",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub updated_at_range: Option<SearchFiltersUpdatedAtRange>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RelationshipWeight {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "weight")]
    pub weight: f64,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct TraversalScoringConfig {
    #[serde(
        rename = "depthPenalty",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub depth_penalty: Option<f64>,
    #[serde(
        rename = "relationshipWeights",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub relationship_weights: Option<Vec<RelationshipWeight>>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SearchBoostsEntityIdsItem {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "weight")]
    pub weight: f64,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SearchBoostsEntityTypesItem {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "weight")]
    pub weight: f64,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SearchBoosts {
    #[serde(rename = "entityIds", default, skip_serializing_if = "Option::is_none")]
    pub entity_ids: Option<Vec<SearchBoostsEntityIdsItem>>,
    #[serde(
        rename = "entityTypes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub entity_types: Option<Vec<SearchBoostsEntityTypesItem>>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SearchRequest {
    #[serde(
        rename = "projection",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub projection: Option<String>,
    #[serde(
        rename = "structuredRead",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub structured_read: Option<StructuredGraphReadRequest>,
    #[serde(
        rename = "seedEntityIds",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub seed_entity_ids: Option<Vec<String>>,
    #[serde(
        rename = "seedNodeIds",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub seed_node_ids: Option<Vec<String>>,
    #[serde(rename = "traversal", default, skip_serializing_if = "Option::is_none")]
    pub traversal: Option<TraversalOptions>,
    #[serde(rename = "filters", default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<SearchFilters>,
    #[serde(rename = "scoring", default, skip_serializing_if = "Option::is_none")]
    pub scoring: Option<TraversalScoringConfig>,
    #[serde(rename = "boosts", default, skip_serializing_if = "Option::is_none")]
    pub boosts: Option<SearchBoosts>,
    #[serde(
        rename = "includeRelationships",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub include_relationships: Option<bool>,
    #[serde(
        rename = "includeSeedEntities",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub include_seed_entities: Option<bool>,
    #[serde(
        rename = "trackPathCount",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub track_path_count: Option<bool>,
    #[serde(
        rename = "groupResultsBySeed",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub group_results_by_seed: Option<bool>,
    #[serde(rename = "page", default, skip_serializing_if = "Option::is_none")]
    pub page: Option<i64>,
    #[serde(rename = "size", default, skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EntityNeighborhoodRequest {
    #[serde(rename = "seedEntityType")]
    pub seed_entity_type: String,
    #[serde(rename = "seedEntityId")]
    pub seed_entity_id: String,
    #[serde(
        rename = "featureIds",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub feature_ids: Option<Vec<String>>,
    #[serde(
        rename = "planPivotEntityIds",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub plan_pivot_entity_ids: Option<Vec<String>>,
    #[serde(rename = "depth", default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<i64>,
    #[serde(
        rename = "relationshipTypes",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub relationship_types: Option<Vec<String>>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct IncidentEdgesRequest {
    #[serde(rename = "seedEntityIds")]
    pub seed_entity_ids: Vec<String>,
    #[serde(rename = "relationshipTypes")]
    pub relationship_types: Vec<String>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RelationshipMetadata {
    #[serde(rename = "reasoning", default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(
        rename = "confidence",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub confidence: Option<f64>,
    #[serde(
        rename = "inferredBy",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub inferred_by: Option<String>,
    #[serde(rename = "createdAt", default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(
        rename = "conversationId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub conversation_id: Option<String>,
    #[serde(rename = "nodeId", default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(rename = "baseType", default, skip_serializing_if = "Option::is_none")]
    pub base_type: Option<String>,
    #[serde(
        rename = "requestorId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub requestor_id: Option<String>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RelationshipDto {
    #[serde(rename = "fromArtifactId")]
    pub from_artifact_id: String,
    #[serde(rename = "toArtifactId")]
    pub to_artifact_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "metadata", default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<RelationshipMetadata>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct BatchRelationshipRequest {
    #[serde(rename = "relationships")]
    pub relationships: Vec<RelationshipDto>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct FeatureProjectConnectionRequest {
    #[serde(rename = "featureIds")]
    pub feature_ids: Vec<String>,
}
pub const REQUEST_SCHEMAS: &str = r###"{"SearchRequest":{"type":"object","properties":{"projection":{"type":"string","enum":["IDENTITIES_BY_SEED","STRUCTURED_READ","COMPACT_RANKED"]},"structuredRead":{"type":"object","required":["root","seeds","directEdgeTypes","expansions"],"properties":{"root":{"type":"object","required":["entityId","entityType"],"properties":{"entityId":{"type":"string","format":"uuid"},"entityType":{"type":"string","enum":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","VALIDATION_SESSION","SERVICE","REPORT","PROPOSAL","IMPLEMENTATION_HINT","USER"]}}},"seeds":{"type":"array","items":{"type":"object","required":["entityId","entityType"],"properties":{"entityId":{"type":"string","format":"uuid"},"entityType":{"type":"string","enum":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","VALIDATION_SESSION","SERVICE","REPORT","PROPOSAL","IMPLEMENTATION_HINT","USER"]}}}},"directEdgeTypes":{"type":"array","items":{"type":"string","enum":["RELATED_TO","DEPENDS_ON","DERIVES_FROM","SUPERSEDES","CONTRADICTS","EVOLVES","TRACKS","PROPOSED_TOGETHER","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]}},"expansions":{"type":"array","items":{"type":"object","required":["key","seeds","path","excludeRoot","limit"],"properties":{"key":{"type":"string"},"seeds":{"type":"array","items":{"type":"object","required":["entityId","entityType"],"properties":{"entityId":{"type":"string","format":"uuid"},"entityType":{"type":"string","enum":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","VALIDATION_SESSION","SERVICE","REPORT","PROPOSAL","IMPLEMENTATION_HINT","USER"]}}}},"path":{"type":"array","minItems":1,"maxItems":5,"items":{"type":"object","required":["relationshipType","direction","entityTypes"],"properties":{"relationshipType":{"type":"string","enum":["SCOPED_TO_PROJECT","SCOPED_TO_ORG","HAS_INITIATIVE","HAS_PLAN_STAGE","HAS_PLAN_STEP","HAS_TASK","HAS_AGENT_SESSION","HAS_IMPLEMENTATION_HINT","HAS_PROMPT","HAS_CATEGORY","HAS_FACET","HAS_KB_ENTRY","HAS_DESIGN_DOC","HAS_SUB_DOC","ABOUT","HAS_MESSAGE","MENTIONS","MESSAGE_FOLLOWS","TRACKS","PLAN_TRACKS","PLAN_STAGE_TRACKS","PLAN_STEP_TRACKS","REPORTS_ON","BLOCKS","CREATED_VIA","DERIVES_FROM","INFLUENCES","RELATED_TO","DEPENDS_ON","SUPERSEDES","CONTRADICTS","EVOLVES","AGENT_LINKED","PROPOSED_TOGETHER","AUTHORED_IN","TARGET_OF","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]},"direction":{"type":"string","enum":["INCOMING","OUTGOING"]},"entityTypes":{"type":"array","minItems":1,"items":{"type":"string","enum":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","VALIDATION_SESSION","SERVICE","REPORT","PROPOSAL","IMPLEMENTATION_HINT","USER"]}},"workItemTypeKeys":{"type":"array","items":{"type":"string"}}}}},"excludeRoot":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":500}}}}}},"seedEntityIds":{"type":"array","items":{"type":"string","format":"uuid"}},"seedNodeIds":{"type":"array","items":{"type":"string"}},"traversal":{"type":"object","properties":{"direction":{"type":"string","enum":["INCOMING","OUTGOING","BOTH"]},"depth":{"type":"integer","minimum":1,"maximum":3},"relationshipTypes":{"type":"array","items":{"type":"string","enum":["SCOPED_TO_PROJECT","SCOPED_TO_ORG","HAS_INITIATIVE","HAS_PLAN_STAGE","HAS_PLAN_STEP","HAS_TASK","HAS_AGENT_SESSION","HAS_IMPLEMENTATION_HINT","HAS_PROMPT","HAS_CATEGORY","HAS_FACET","HAS_KB_ENTRY","HAS_DESIGN_DOC","HAS_SUB_DOC","ABOUT","HAS_MESSAGE","MENTIONS","MESSAGE_FOLLOWS","TRACKS","PLAN_TRACKS","PLAN_STAGE_TRACKS","PLAN_STEP_TRACKS","REPORTS_ON","BLOCKS","CREATED_VIA","DERIVES_FROM","INFLUENCES","RELATED_TO","DEPENDS_ON","SUPERSEDES","CONTRADICTS","EVOLVES","AGENT_LINKED","PROPOSED_TOGETHER","AUTHORED_IN","TARGET_OF","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]}},"excludeRelationshipTypes":{"type":"array","items":{"type":"string","enum":["SCOPED_TO_PROJECT","SCOPED_TO_ORG","HAS_INITIATIVE","HAS_PLAN_STAGE","HAS_PLAN_STEP","HAS_TASK","HAS_AGENT_SESSION","HAS_IMPLEMENTATION_HINT","HAS_PROMPT","HAS_CATEGORY","HAS_FACET","HAS_KB_ENTRY","HAS_DESIGN_DOC","HAS_SUB_DOC","ABOUT","HAS_MESSAGE","MENTIONS","MESSAGE_FOLLOWS","TRACKS","PLAN_TRACKS","PLAN_STAGE_TRACKS","PLAN_STEP_TRACKS","REPORTS_ON","BLOCKS","CREATED_VIA","DERIVES_FROM","INFLUENCES","RELATED_TO","DEPENDS_ON","SUPERSEDES","CONTRADICTS","EVOLVES","AGENT_LINKED","PROPOSED_TOGETHER","AUTHORED_IN","TARGET_OF","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]}},"pathExpansions":{"type":"array","items":{"type":"object","required":["relationshipChain"],"properties":{"seedEntityTypes":{"type":"array","items":{"type":"string","enum":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","VALIDATION_SESSION","SERVICE","REPORT","PROPOSAL","IMPLEMENTATION_HINT","USER"]}},"relationshipChain":{"type":"array","minItems":1,"maxItems":5,"items":{"type":"object","required":["type"],"properties":{"direction":{"type":"string","enum":["INCOMING","OUTGOING","BOTH"]},"type":{"type":"string","enum":["SCOPED_TO_PROJECT","SCOPED_TO_ORG","HAS_INITIATIVE","HAS_PLAN_STAGE","HAS_PLAN_STEP","HAS_TASK","HAS_AGENT_SESSION","HAS_IMPLEMENTATION_HINT","HAS_PROMPT","HAS_CATEGORY","HAS_FACET","HAS_KB_ENTRY","HAS_DESIGN_DOC","HAS_SUB_DOC","ABOUT","HAS_MESSAGE","MENTIONS","MESSAGE_FOLLOWS","TRACKS","PLAN_TRACKS","PLAN_STAGE_TRACKS","PLAN_STEP_TRACKS","REPORTS_ON","BLOCKS","CREATED_VIA","DERIVES_FROM","INFLUENCES","RELATED_TO","DEPENDS_ON","SUPERSEDES","CONTRADICTS","EVOLVES","AGENT_LINKED","PROPOSED_TOGETHER","AUTHORED_IN","TARGET_OF","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]}}}}}}}}},"filters":{"type":"object","properties":{"entityTypes":{"type":"array","items":{"type":"string","enum":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","VALIDATION_SESSION","SERVICE","REPORT","PROPOSAL","IMPLEMENTATION_HINT","USER"]}},"labels":{"type":"array","items":{"type":"string"}},"statuses":{"type":"array","items":{"type":"string"}},"taskTypes":{"type":"array","items":{"type":"string"}},"excludeTaskTypes":{"type":"array","items":{"type":"string"}},"excludeReportTypes":{"type":"array","items":{"type":"string","enum":["PROJECT_REPORT","CODING_RESEARCH","EVIDENCE_PIPELINE","SNAPSHOT","ROLLUP_PROPOSAL","DAILY_SESSION","GOAL_PROGRESS","RISK_ALERT","SESSION_SUMMARY","COMMIT","PLAN","IMPLEMENT","REVIEW","CHANGE_WALKTHROUGH","FEATURE_SYNC","FEATURE_SYNC_HANDOFF","FEATURE_SYNC_DECISION","DECISION_NEEDED","PHASE_GROUNDING","VALIDATION_WALKTHROUGH","FEATURE_TREE_ANALYSIS","COMPETITIVE_ANALYSIS","SESSION_MONITOR_DEFERRAL","EVAL_RUN","EVAL_ATTEMPT","EVAL_HUMAN_REVIEW"]}},"tags":{"type":"array","items":{"type":"string","enum":["product","frontend","backend","infra","design","AI"]}},"dateRange":{"type":"object","properties":{"from":{"type":"string","format":"date-time"},"to":{"type":"string","format":"date-time"}}},"updatedAtRange":{"type":"object","properties":{"from":{"type":"string","format":"date-time"},"to":{"type":"string","format":"date-time"}}}}},"scoring":{"type":"object","properties":{"depthPenalty":{"type":"number","minimum":0,"format":"float"},"relationshipWeights":{"type":"array","items":{"type":"object","required":["type","weight"],"properties":{"type":{"type":"string","enum":["SCOPED_TO_PROJECT","SCOPED_TO_ORG","HAS_INITIATIVE","HAS_PLAN_STAGE","HAS_PLAN_STEP","HAS_TASK","HAS_AGENT_SESSION","HAS_IMPLEMENTATION_HINT","HAS_PROMPT","HAS_CATEGORY","HAS_FACET","HAS_KB_ENTRY","HAS_DESIGN_DOC","HAS_SUB_DOC","ABOUT","HAS_MESSAGE","MENTIONS","MESSAGE_FOLLOWS","TRACKS","PLAN_TRACKS","PLAN_STAGE_TRACKS","PLAN_STEP_TRACKS","REPORTS_ON","BLOCKS","CREATED_VIA","DERIVES_FROM","INFLUENCES","RELATED_TO","DEPENDS_ON","SUPERSEDES","CONTRADICTS","EVOLVES","AGENT_LINKED","PROPOSED_TOGETHER","AUTHORED_IN","TARGET_OF","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]},"weight":{"type":"number","minimum":0,"format":"float"}}}}}},"boosts":{"type":"object","properties":{"entityIds":{"type":"array","items":{"type":"object","required":["id","weight"],"properties":{"id":{"type":"string","format":"uuid"},"weight":{"type":"number","format":"float"}}}},"entityTypes":{"type":"array","items":{"type":"object","required":["type","weight"],"properties":{"type":{"type":"string","enum":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","VALIDATION_SESSION","SERVICE","REPORT","PROPOSAL","IMPLEMENTATION_HINT","USER"]},"weight":{"type":"number","format":"float"}}}}}},"includeRelationships":{"type":"boolean"},"includeSeedEntities":{"type":"boolean"},"trackPathCount":{"type":"boolean"},"groupResultsBySeed":{"type":"boolean"},"page":{"type":"integer","minimum":0},"size":{"type":"integer","minimum":1,"maximum":500}}},"EntityNeighborhoodRequest":{"type":"object","required":["seedEntityType","seedEntityId"],"additionalProperties":false,"properties":{"seedEntityType":{"type":"string","enum":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","VALIDATION_SESSION","SERVICE","REPORT","PROPOSAL","IMPLEMENTATION_HINT","USER"]},"seedEntityId":{"type":"string","format":"uuid"},"featureIds":{"type":"array","items":{"type":"string","format":"uuid"}},"planPivotEntityIds":{"type":"array","items":{"type":"string","format":"uuid"}},"depth":{"type":"integer","minimum":1,"maximum":5},"relationshipTypes":{"type":"array","items":{"type":"string","enum":["SCOPED_TO_PROJECT","SCOPED_TO_ORG","HAS_INITIATIVE","HAS_PLAN_STAGE","HAS_PLAN_STEP","HAS_TASK","HAS_AGENT_SESSION","HAS_IMPLEMENTATION_HINT","HAS_PROMPT","HAS_CATEGORY","HAS_FACET","HAS_KB_ENTRY","HAS_DESIGN_DOC","HAS_SUB_DOC","ABOUT","HAS_MESSAGE","MENTIONS","MESSAGE_FOLLOWS","TRACKS","PLAN_TRACKS","PLAN_STAGE_TRACKS","PLAN_STEP_TRACKS","REPORTS_ON","BLOCKS","CREATED_VIA","DERIVES_FROM","INFLUENCES","RELATED_TO","DEPENDS_ON","SUPERSEDES","CONTRADICTS","EVOLVES","AGENT_LINKED","PROPOSED_TOGETHER","AUTHORED_IN","TARGET_OF","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]}}}},"IncidentEdgesRequest":{"type":"object","required":["seedEntityIds","relationshipTypes"],"properties":{"seedEntityIds":{"type":"array","minItems":1,"items":{"type":"string","format":"uuid"}},"relationshipTypes":{"type":"array","minItems":1,"items":{"type":"string","enum":["SCOPED_TO_PROJECT","SCOPED_TO_ORG","HAS_INITIATIVE","HAS_PLAN_STAGE","HAS_PLAN_STEP","HAS_TASK","HAS_AGENT_SESSION","HAS_IMPLEMENTATION_HINT","HAS_PROMPT","HAS_CATEGORY","HAS_FACET","HAS_KB_ENTRY","HAS_DESIGN_DOC","HAS_SUB_DOC","ABOUT","HAS_MESSAGE","MENTIONS","MESSAGE_FOLLOWS","TRACKS","PLAN_TRACKS","PLAN_STAGE_TRACKS","PLAN_STEP_TRACKS","REPORTS_ON","BLOCKS","CREATED_VIA","DERIVES_FROM","INFLUENCES","RELATED_TO","DEPENDS_ON","SUPERSEDES","CONTRADICTS","EVOLVES","AGENT_LINKED","PROPOSED_TOGETHER","AUTHORED_IN","TARGET_OF","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]}}}},"BatchRelationshipRequest":{"type":"object","required":["relationships"],"properties":{"relationships":{"type":"array","minItems":1,"maxItems":50,"items":{"type":"object","required":["fromArtifactId","toArtifactId","type"],"properties":{"fromArtifactId":{"type":"string","format":"uuid"},"toArtifactId":{"type":"string","format":"uuid"},"type":{"type":"string","enum":["SCOPED_TO_PROJECT","SCOPED_TO_ORG","HAS_INITIATIVE","HAS_PLAN_STAGE","HAS_PLAN_STEP","HAS_TASK","HAS_AGENT_SESSION","HAS_IMPLEMENTATION_HINT","HAS_PROMPT","HAS_CATEGORY","HAS_FACET","HAS_KB_ENTRY","HAS_DESIGN_DOC","HAS_SUB_DOC","ABOUT","HAS_MESSAGE","MENTIONS","MESSAGE_FOLLOWS","TRACKS","PLAN_TRACKS","PLAN_STAGE_TRACKS","PLAN_STEP_TRACKS","REPORTS_ON","BLOCKS","CREATED_VIA","DERIVES_FROM","INFLUENCES","RELATED_TO","DEPENDS_ON","SUPERSEDES","CONTRADICTS","EVOLVES","AGENT_LINKED","PROPOSED_TOGETHER","AUTHORED_IN","TARGET_OF","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]},"metadata":{"type":"object","properties":{"reasoning":{"type":"string"},"confidence":{"type":"number","minimum":0,"maximum":1,"format":"float"},"inferredBy":{"type":"string","enum":["llm","system"]},"createdAt":{"type":"string","format":"date-time"},"conversationId":{"type":"string","format":"uuid"},"nodeId":{"type":"string"},"baseType":{"type":"string","enum":["SCOPED_TO_PROJECT","SCOPED_TO_ORG","HAS_INITIATIVE","HAS_PLAN_STAGE","HAS_PLAN_STEP","HAS_TASK","HAS_AGENT_SESSION","HAS_IMPLEMENTATION_HINT","HAS_PROMPT","HAS_CATEGORY","HAS_FACET","HAS_KB_ENTRY","HAS_DESIGN_DOC","HAS_SUB_DOC","ABOUT","HAS_MESSAGE","MENTIONS","MESSAGE_FOLLOWS","TRACKS","PLAN_TRACKS","PLAN_STAGE_TRACKS","PLAN_STEP_TRACKS","REPORTS_ON","BLOCKS","CREATED_VIA","DERIVES_FROM","INFLUENCES","RELATED_TO","DEPENDS_ON","SUPERSEDES","CONTRADICTS","EVOLVES","AGENT_LINKED","PROPOSED_TOGETHER","AUTHORED_IN","TARGET_OF","FULFILLED_BY","GUARANTEES","IMPLEMENTS","CONSUMES","STANDARD","CONDITIONAL","LOOP"]},"requestorId":{"type":"string","format":"uuid"}}}}}}}},"FeatureProjectConnectionRequest":{"type":"object","required":["featureIds"],"properties":{"featureIds":{"type":"array","minItems":1,"maxItems":5000,"items":{"type":"string","format":"uuid"}}}}}"###;
pub const ENTITY_TYPES: &[&str] = &[
    "ARTIFACT",
    "INITIATIVE",
    "PROJECT",
    "TASK",
    "MESSAGE",
    "CONVERSATION",
    "DESIGN_DOC",
    "AGENT_SESSION",
    "VALIDATION_SESSION",
    "SERVICE",
    "REPORT",
    "PROPOSAL",
    "IMPLEMENTATION_HINT",
    "USER",
];
