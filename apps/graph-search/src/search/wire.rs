//! Request and response shapes of `openapi/specs/embeddings/openapi.yaml`,
//! validated once here so handlers and the store receive checked values.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub const MAX_TEXT_CHARS: usize = 50_000;
pub const MAX_QUERY_CHARS: usize = 1_000;
pub const MAX_RESULTS: u32 = 100;
pub const MAX_BATCH_QUERIES: usize = 25;
const DEFAULT_RESULTS: u32 = 10;
const DEFAULT_THRESHOLD: f64 = 0.15;

/// A request the spec defines as invalid, answered with 400 and `ErrorResponse`.
#[derive(Debug)]
pub struct Invalid {
    pub field: &'static str,
    pub message: String,
}

pub fn invalid(field: &'static str, message: impl Into<String>) -> Invalid {
    Invalid {
        field,
        message: message.into(),
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchType {
    Semantic,
    Keyword,
    #[default]
    Hybrid,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryMode {
    #[default]
    Default,
    TitleFuzzy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchType {
    Semantic,
    Keyword,
    Hybrid,
}

/// A string or a list of strings; the spec accepts both for several filters.
#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum OneOrMany {
    One(String),
    Many(Vec<String>),
}

impl OneOrMany {
    fn into_vec(self) -> Vec<String> {
        match self {
            Self::One(value) => vec![value],
            Self::Many(values) => values,
        }
    }
}

/// ISO-8601 text or epoch milliseconds.
#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum Instant {
    Text(String),
    EpochMillis(f64),
}

impl Instant {
    fn parse(self, field: &'static str) -> Result<OffsetDateTime, Invalid> {
        match self {
            Self::Text(text) => parse_timestamp(&text, field),
            Self::EpochMillis(millis) => {
                let nanos = (millis * 1_000_000.0) as i128;
                OffsetDateTime::from_unix_timestamp_nanos(nanos)
                    .map_err(|_| invalid(field, "must be a valid timestamp"))
            }
        }
    }
}

pub fn parse_timestamp(text: &str, field: &'static str) -> Result<OffsetDateTime, Invalid> {
    OffsetDateTime::parse(text, &Rfc3339)
        .map_err(|_| invalid(field, "must be an RFC 3339 date-time"))
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SearchFilters {
    pub organization_id: Option<String>,
    pub project_id: Option<String>,
    category: Option<String>,
    topology_category: Option<String>,
    topology_subfacets: Option<OneOrMany>,
    id: Option<String>,
    conversation_id: Option<String>,
    parent_id: Option<String>,
    initiative_id: Option<String>,
    service_id: Option<String>,
    service_ids: Option<Vec<String>>,
    target_initiative_id: Option<String>,
    source_id: Option<String>,
    source_type: Option<String>,
    message_type: Option<String>,
    #[serde(rename = "type")]
    kind: Option<OneOrMany>,
    types: Option<OneOrMany>,
    doc_types: Option<OneOrMany>,
    content_type: Option<OneOrMany>,
    content_types: Option<OneOrMany>,
    workflow_id: Option<String>,
    status: Option<String>,
    statuses: Option<OneOrMany>,
    priority: Option<String>,
    tags: Option<OneOrMany>,
    task_types: Option<Vec<String>>,
    exclude_task_types: Option<Vec<String>>,
    #[serde(rename = "created_after")]
    created_after: Option<Instant>,
    #[serde(rename = "created_before")]
    created_before: Option<Instant>,
    #[serde(rename = "updated_after")]
    updated_after: Option<Instant>,
    #[serde(rename = "updated_before")]
    updated_before: Option<Instant>,
}

/// Filters in the form the store queries with. `None` means "no constraint".
#[derive(Clone, Debug, Default)]
pub struct Filter {
    /// Metadata fields that must equal the given values.
    pub equals: Map<String, Value>,
    /// Lowercased entity types, matched against the type or work-item type key.
    pub types: Option<Vec<String>>,
    pub statuses: Option<Vec<String>>,
    /// Exact work-item type keys.
    pub task_types: Option<Vec<String>>,
    pub exclude_task_types: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub topology_subfacets: Option<Vec<String>>,
    pub service_ids: Option<Vec<String>>,
    pub exclude_source_ids: Option<Vec<String>>,
    pub created_after: Option<OffsetDateTime>,
    pub created_before: Option<OffsetDateTime>,
    pub updated_after: Option<OffsetDateTime>,
    pub updated_before: Option<OffsetDateTime>,
    /// Terms or phrases every unit must contain.
    pub must: Vec<String>,
}

fn non_empty(values: Vec<String>) -> Option<Vec<String>> {
    let values: Vec<String> = values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect();
    (!values.is_empty()).then_some(values)
}

impl SearchFilters {
    pub fn into_filter(self) -> Result<Filter, Invalid> {
        let mut equals = Map::new();
        for (key, value) in [
            ("category", self.category),
            ("topologyCategory", self.topology_category),
            ("id", self.id),
            ("conversationId", self.conversation_id),
            ("parentId", self.parent_id),
            ("initiativeId", self.initiative_id),
            ("targetInitiativeId", self.target_initiative_id),
            ("sourceId", self.source_id),
            ("sourceType", self.source_type),
            ("messageType", self.message_type),
            ("workflowId", self.workflow_id),
            ("priority", self.priority),
        ] {
            if let Some(value) = value {
                equals.insert(key.into(), Value::String(value));
            }
        }

        let types = [
            self.kind,
            self.types,
            self.doc_types,
            self.content_type,
            self.content_types,
        ]
        .into_iter()
        .flatten()
        .flat_map(OneOrMany::into_vec)
        .map(|value| value.to_lowercase())
        .collect();

        let statuses = self
            .status
            .into_iter()
            .chain(self.statuses.map(OneOrMany::into_vec).unwrap_or_default())
            .collect();

        let service_ids = self
            .service_id
            .into_iter()
            .chain(self.service_ids.unwrap_or_default())
            .collect();

        let instant = |value: Option<Instant>, field| value.map(|v| v.parse(field)).transpose();

        Ok(Filter {
            equals,
            types: non_empty(types),
            statuses: non_empty(statuses),
            task_types: self.task_types.and_then(non_empty),
            exclude_task_types: self.exclude_task_types.and_then(non_empty),
            tags: self.tags.map(OneOrMany::into_vec).and_then(non_empty),
            topology_subfacets: self
                .topology_subfacets
                .map(OneOrMany::into_vec)
                .and_then(non_empty),
            service_ids: non_empty(service_ids),
            exclude_source_ids: None,
            created_after: instant(self.created_after, "filters.created_after")?,
            created_before: instant(self.created_before, "filters.created_before")?,
            updated_after: instant(self.updated_after, "filters.updated_after")?,
            updated_before: instant(self.updated_before, "filters.updated_before")?,
            must: Vec::new(),
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct TypeBoost {
    #[serde(rename = "type")]
    pub kind: String,
    pub weight: f64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchBoosts {
    #[serde(default)]
    pub entity_types: Vec<TypeBoost>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SearchRequest {
    pub query: Option<String>,
    pub max_results: Option<u32>,
    pub offset: Option<u32>,
    pub similarity_threshold: Option<f64>,
    #[serde(default)]
    pub query_mode: QueryMode,
    pub filters: Option<SearchFilters>,
    pub boosts: Option<SearchBoosts>,
    // Accepted by the deployed service on POST although the schema lists them
    // only for GET and structured search.
    #[serde(default)]
    pub search_type: SearchType,
    #[serde(default)]
    pub boost_recent: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct BatchSearchQuery {
    #[serde(flatten)]
    pub search: SearchRequest,
    pub query_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct BatchSearchRequest {
    pub queries: Vec<BatchSearchQuery>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct StructuredSearchRequest {
    #[serde(default)]
    pub must: Vec<String>,
    #[serde(default)]
    pub should: Vec<String>,
    #[serde(default)]
    pub phrases: Vec<String>,
    pub emb_query: Option<String>,
    pub max_results: Option<u32>,
    pub similarity_threshold: Option<f64>,
    pub filters: Option<SearchFilters>,
    #[serde(default)]
    pub search_type: SearchType,
    #[serde(default)]
    pub boost_recent: bool,
    #[serde(default)]
    pub exclude_source_ids: Vec<String>,
}

/// One validated search, independent of which operation asked for it.
#[derive(Clone, Debug)]
pub struct Search {
    /// The text echoed back as `query`.
    pub query: String,
    /// Text matched lexically (full-text and trigram); `None` skips keyword matching.
    pub keyword_text: Option<String>,
    /// Text encoded for meaning; `None` skips vector retrieval.
    pub semantic_text: Option<String>,
    pub search_type: SearchType,
    pub title_only: bool,
    pub max_results: u32,
    pub offset: u32,
    pub threshold: f64,
    pub boosts: Vec<TypeBoost>,
    pub boost_recent: bool,
    pub filter: Filter,
}

fn checked_limits(max_results: Option<u32>, threshold: Option<f64>) -> Result<(u32, f64), Invalid> {
    let max_results = max_results.unwrap_or(DEFAULT_RESULTS);
    if !(1..=MAX_RESULTS).contains(&max_results) {
        return Err(invalid("max_results", "must be between 1 and 100"));
    }

    let threshold = threshold.unwrap_or(DEFAULT_THRESHOLD);
    if !(0.0..=1.0).contains(&threshold) {
        return Err(invalid("similarity_threshold", "must be between 0 and 1"));
    }
    Ok((max_results, threshold))
}

fn checked_query(query: Option<String>, field: &'static str) -> Result<String, Invalid> {
    let query = query.unwrap_or_default();
    let length = query.chars().count();
    if query.trim().is_empty() {
        return Err(invalid(field, "is required"));
    }
    if length > MAX_QUERY_CHARS {
        return Err(invalid(field, "must be at most 1000 characters"));
    }
    Ok(query)
}

impl SearchRequest {
    /// Returns the validated search and the filters' requested tenant.
    pub fn validate(self) -> Result<(Search, SearchFilters), Invalid> {
        let query = checked_query(self.query, "query")?;
        let (max_results, threshold) = checked_limits(self.max_results, self.similarity_threshold)?;
        let filters = self.filters.unwrap_or_default();
        let title_only = self.query_mode == QueryMode::TitleFuzzy;

        // Title-fuzzy matching is lexical only, as in the deployed service.
        let search_type = if title_only {
            SearchType::Keyword
        } else {
            self.search_type
        };

        let search = Search {
            keyword_text: (search_type != SearchType::Semantic).then(|| query.clone()),
            semantic_text: (search_type != SearchType::Keyword).then(|| query.clone()),
            query,
            search_type,
            title_only,
            max_results,
            offset: self.offset.unwrap_or(0),
            threshold,
            boosts: self.boosts.unwrap_or_default().entity_types,
            boost_recent: self.boost_recent,
            filter: filters.clone().into_filter()?,
        };
        Ok((search, filters))
    }
}

impl StructuredSearchRequest {
    pub fn validate(self) -> Result<(Search, SearchFilters), Invalid> {
        if self.must.len() > 25 || self.should.len() > 25 {
            return Err(invalid("must", "must and should allow at most 25 terms"));
        }
        if self.phrases.len() > 10 {
            return Err(invalid("phrases", "allows at most 10 phrases"));
        }
        if let Some(emb_query) = &self.emb_query
            && (emb_query.trim().is_empty() || emb_query.chars().count() > MAX_QUERY_CHARS)
        {
            return Err(invalid("emb_query", "must be 1 to 1000 characters"));
        }

        let must = non_empty(self.must).unwrap_or_default();
        let should = non_empty(self.should).unwrap_or_default();
        let phrases = non_empty(self.phrases).unwrap_or_default();
        if must.is_empty() && should.is_empty() && phrases.is_empty() && self.emb_query.is_none() {
            return Err(invalid(
                "must",
                "at least one of must, should, phrases or emb_query is required",
            ));
        }

        let (max_results, threshold) = checked_limits(self.max_results, self.similarity_threshold)?;
        let filters = self.filters.unwrap_or_default();
        let mut filter = filters.clone().into_filter()?;
        filter.must = must.clone();
        filter.exclude_source_ids = non_empty(self.exclude_source_ids);

        // Any of the should terms or phrases ranks a unit; must terms are required.
        let quoted_phrases = phrases.iter().map(|phrase| format!("\"{phrase}\""));
        let lexical: Vec<String> = should
            .iter()
            .cloned()
            .chain(quoted_phrases)
            .chain(must.iter().cloned())
            .collect();
        let plain_terms = should
            .iter()
            .chain(&phrases)
            .chain(&must)
            .cloned()
            .collect::<Vec<_>>()
            .join(" ");

        // Each signal falls back to the other's text, so every search type
        // has something to match whichever fields the caller supplied.
        let keyword_source = if lexical.is_empty() {
            self.emb_query.clone()
        } else {
            Some(lexical.join(" or "))
        };
        let semantic_source = self
            .emb_query
            .clone()
            .or_else(|| (!plain_terms.is_empty()).then(|| plain_terms.clone()));
        let keyword_text = keyword_source.filter(|_| self.search_type != SearchType::Semantic);
        let semantic_text = semantic_source.filter(|_| self.search_type != SearchType::Keyword);

        let query = self.emb_query.unwrap_or(plain_terms);
        let search = Search {
            query,
            keyword_text,
            semantic_text,
            search_type: self.search_type,
            title_only: false,
            max_results,
            offset: 0,
            threshold,
            boosts: Vec::new(),
            boost_recent: self.boost_recent,
            filter,
        };
        Ok((search, filters))
    }
}

/// GET search parameters. `entityType` may repeat or be comma-separated, so
/// pairs are read by hand rather than through a typed query extractor.
pub struct GetSearch {
    pub organization_id: Option<String>,
    pub project_id: Option<String>,
    pub search: Search,
}

pub fn parse_get_search(raw_query: Option<&str>) -> Result<GetSearch, Invalid> {
    let pairs: Vec<(String, String)> = serde_urlencoded::from_str(raw_query.unwrap_or(""))
        .map_err(|_| invalid("query", "is not a valid query string"))?;

    let mut request = SearchRequest {
        query: None,
        max_results: None,
        offset: None,
        similarity_threshold: None,
        query_mode: QueryMode::Default,
        filters: None,
        boosts: None,
        search_type: SearchType::Hybrid,
        boost_recent: false,
    };
    let mut organization_id = None;
    let mut project_id = None;
    let mut entity_types = Vec::new();
    let mut statuses = Vec::new();
    let mut initiative_id = None;

    for (key, value) in pairs {
        match key.as_str() {
            "q" => request.query = Some(value),
            "organizationId" => organization_id = Some(value),
            "projectId" => project_id = Some(value),
            "max_results" => {
                let parsed = value
                    .parse()
                    .map_err(|_| invalid("max_results", "must be an integer"))?;
                request.max_results = Some(parsed);
            }
            "threshold" => {
                let parsed = value
                    .parse()
                    .map_err(|_| invalid("threshold", "must be a number"))?;
                request.similarity_threshold = Some(parsed);
            }
            "search_type" => request.search_type = enum_value(&value, "search_type")?,
            "query_mode" => request.query_mode = enum_value(&value, "query_mode")?,
            "boost_recent" => {
                request.boost_recent = value
                    .parse()
                    .map_err(|_| invalid("boost_recent", "must be true or false"))?;
            }
            "entityType" | "entityType[]" => {
                entity_types.extend(value.split(',').map(str::to_owned));
            }
            // Sent by the API's search client alongside the specified parameters.
            "statuses" | "statuses[]" => statuses.extend(value.split(',').map(str::to_owned)),
            "initiativeId" => initiative_id = Some(value),
            _ => {}
        }
    }

    request.query = Some(checked_query(request.query, "q")?);
    let (mut search, _) = request.validate()?;
    search.filter.types = non_empty(entity_types.into_iter().map(|t| t.to_lowercase()).collect());
    search.filter.statuses = non_empty(statuses);
    if let Some(initiative_id) = initiative_id {
        search
            .filter
            .equals
            .insert("initiativeId".into(), Value::String(initiative_id));
    }

    Ok(GetSearch {
        organization_id,
        project_id,
        search,
    })
}

fn enum_value<T: for<'de> Deserialize<'de>>(
    value: &str,
    field: &'static str,
) -> Result<T, Invalid> {
    serde_json::from_value(Value::String(value.to_owned()))
        .map_err(|_| invalid(field, format!("does not accept {value:?}")))
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    #[default]
    Chunk,
    Document,
}

#[derive(Debug, Deserialize)]
pub struct EmbeddingRequest {
    pub text: String,
    pub metadata: Option<Map<String, Value>>,
    #[serde(default)]
    pub level: Level,
}

/// A document ready to be split into units and stored.
#[derive(Debug)]
pub struct Document {
    pub id: String,
    pub organization_id: String,
    pub project_id: Option<String>,
    pub kind: String,
    pub task_type: Option<String>,
    pub title: String,
    pub text: String,
    pub level: Level,
    pub metadata: Map<String, Value>,
    pub created_at: Option<OffsetDateTime>,
    pub updated_at: Option<OffsetDateTime>,
}

fn metadata_text(metadata: &Map<String, Value>, key: &str) -> Option<String> {
    metadata
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

impl EmbeddingRequest {
    pub fn validate(self) -> Result<Document, Invalid> {
        let length = self.text.chars().count();
        if self.text.trim().is_empty() || length > MAX_TEXT_CHARS {
            return Err(invalid("text", "must be 1 to 50000 characters"));
        }

        // Tenancy and identity come from the metadata; without it a unit
        // could not be scoped or replaced.
        let metadata = self
            .metadata
            .ok_or_else(|| invalid("metadata", "is required"))?;
        let required = |key: &'static str| {
            metadata_text(&metadata, key)
                .ok_or_else(|| invalid("metadata", format!("metadata.{key} is required")))
        };
        let id = required("id")?;
        let organization_id = required("organizationId")?;
        let kind = required("type")?;

        let type_requirements: &[&'static str] = match kind.as_str() {
            "task" => &["taskType", "name"],
            "initiative" | "design_doc" | "service" => &["name"],
            "implementation_hint" => &[
                "projectId",
                "serviceId",
                "featureName",
                "description",
                "sourceType",
            ],
            "message" => &["conversationId"],
            "artifact" => &["artifactType"],
            _ => {
                return Err(invalid(
                    "metadata",
                    "metadata.type must be message, initiative, task, design_doc, artifact, service or implementation_hint",
                ));
            }
        };
        for key in type_requirements {
            required(key)?;
        }

        let timestamp = |key: &'static str| {
            metadata_text(&metadata, key)
                .map(|text| parse_timestamp(&text, "metadata"))
                .transpose()
        };
        let created_at = timestamp("createdAt")?;
        let updated_at = timestamp("updatedAt")?;

        let title = metadata_text(&metadata, "title")
            .or_else(|| metadata_text(&metadata, "name"))
            .unwrap_or_default();

        Ok(Document {
            id,
            organization_id,
            project_id: metadata_text(&metadata, "projectId"),
            // Preserved exactly: work-item type keys are opaque.
            task_type: metadata
                .get("taskType")
                .and_then(Value::as_str)
                .map(str::to_owned),
            kind,
            title,
            text: self.text,
            level: self.level,
            metadata,
            created_at,
            updated_at,
        })
    }
}

#[derive(Serialize)]
pub struct EmbeddingResponse {
    pub success: bool,
    pub data: EmbeddingData,
}

#[derive(Serialize)]
pub struct EmbeddingData {
    pub success: bool,
    pub embedding_id: String,
    pub chunks_created: usize,
    pub chunk_ids: Vec<String>,
    pub total_word_count: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct SearchResult {
    pub id: String,
    pub text: String,
    pub similarity: f64,
    pub metadata: Value,
    #[serde(rename = "chunkIndex")]
    pub chunk_index: i32,
    #[serde(rename = "matchType")]
    pub match_type: MatchType,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub success: bool,
    pub query: String,
    pub results: usize,
    pub data: Vec<SearchResult>,
}

#[derive(Serialize)]
pub struct BatchSearchResult {
    pub query: String,
    pub query_id: Option<String>,
    pub results: usize,
    pub data: Vec<SearchResult>,
}

#[derive(Serialize)]
pub struct BatchSearchResponse {
    pub success: bool,
    pub results: Vec<BatchSearchResult>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProjectionDeletionCommand {
    pub organization_id: String,
    pub marker_id: String,
    pub irreversible_closure_at: String,
    pub deletion_deadline: String,
}

/// A validated deletion identity; equal identities are the same command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeletionIdentity {
    pub organization_id: String,
    pub marker_id: String,
    pub irreversible_closure_at: OffsetDateTime,
    pub deletion_deadline: OffsetDateTime,
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

impl ProjectionDeletionCommand {
    pub fn validate(self) -> Result<DeletionIdentity, Invalid> {
        if !is_uuid(&self.organization_id) {
            return Err(invalid("organizationId", "must be a UUID"));
        }
        if !is_uuid(&self.marker_id) {
            return Err(invalid("markerId", "must be a UUID"));
        }
        // PostgreSQL keeps microseconds; an identical retry must compare equal.
        let instant = |text: &str, field| {
            let parsed = parse_timestamp(text, field)?;
            let micros = parsed.nanosecond() / 1000 * 1000;
            Ok::<_, Invalid>(
                parsed
                    .replace_nanosecond(micros)
                    .expect("truncated nanoseconds stay in range"),
            )
        };
        Ok(DeletionIdentity {
            organization_id: self.organization_id,
            marker_id: self.marker_id.to_lowercase(),
            irreversible_closure_at: instant(
                &self.irreversible_closure_at,
                "irreversibleClosureAt",
            )?,
            deletion_deadline: instant(&self.deletion_deadline, "deletionDeadline")?,
        })
    }
}

impl DeletionIdentity {
    pub fn to_json(&self) -> Value {
        let format = |instant: OffsetDateTime| {
            instant
                .format(&Rfc3339)
                .expect("stored instants format as RFC 3339")
        };
        serde_json::json!({
            "organizationId": self.organization_id,
            "markerId": self.marker_id,
            "irreversibleClosureAt": format(self.irreversible_closure_at),
            "deletionDeadline": format(self.deletion_deadline),
        })
    }
}
