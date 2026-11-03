//! Shared API-issued JWT verification. There is no unauthenticated data route constructor.
use anyhow::{Context, Result, bail};
use axum::{
    body::{Body, to_bytes},
    extract::{OriginalUri, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::MethodRouter,
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::Deserialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Clone, Copy)]
pub enum Surface {
    Graph,
    Search,
}
#[derive(Clone, Copy)]
pub enum Policy {
    User,
    Read,
    Deletion(Surface),
    Template,
    Debug,
}

pub struct TrustConfig {
    pub jwks_url: String,
    pub issuer: Option<String>,
    pub user_audience: Option<String>,
    pub graph_audience: String,
    pub search_audience: String,
}
impl TrustConfig {
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let required = |name| {
            lookup(name)
                .filter(|v| !v.trim().is_empty())
                .with_context(|| format!("Set {name} to the API signing trust configuration"))
        };
        let jwks_url = required("GRAPH_SEARCH_JWKS_URL")?;
        let url = reqwest::Url::parse(&jwks_url)
            .context("GRAPH_SEARCH_JWKS_URL must be an HTTP(S) URL")?;
        if !matches!(url.scheme(), "http" | "https") {
            bail!("GRAPH_SEARCH_JWKS_URL must be an HTTP(S) URL");
        }
        let graph_audience = required("GRAPH_SEARCH_GRAPH_AUDIENCE")?;
        let search_audience = required("GRAPH_SEARCH_SEARCH_AUDIENCE")?;
        if graph_audience == search_audience {
            bail!(
                "GRAPH_SEARCH_GRAPH_AUDIENCE and GRAPH_SEARCH_SEARCH_AUDIENCE must remain distinct"
            );
        }
        Ok(Self {
            jwks_url,
            issuer: lookup("GRAPH_SEARCH_JWT_ISSUER").filter(|v| !v.is_empty()),
            user_audience: lookup("GRAPH_SEARCH_USER_AUDIENCE").filter(|v| !v.is_empty()),
            graph_audience,
            search_audience,
        })
    }
}
struct KeyCache {
    keys: JwkSet,
    loaded: Instant,
}
struct Inner {
    config: TrustConfig,
    client: reqwest::Client,
    keys: Mutex<KeyCache>,
}
#[derive(Clone)]
pub struct Authenticator(Arc<Inner>);
impl Authenticator {
    pub async fn from_env() -> Result<Self> {
        Self::load(TrustConfig::from_lookup(|name| std::env::var(name).ok())?).await
    }
    pub async fn load(config: TrustConfig) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;
        let keys = fetch_keys(&client, &config.jwks_url).await.context(
            "Cannot load GRAPH_SEARCH_JWKS_URL; verify API connectivity and its RSA signing keys",
        )?;
        Ok(Self(Arc::new(Inner {
            config,
            client,
            keys: Mutex::new(KeyCache {
                keys,
                loaded: Instant::now(),
            }),
        })))
    }
    pub fn from_jwks(config: TrustConfig, keys: JwkSet) -> Result<Self> {
        validate_keys(&keys)?;
        Ok(Self(Arc::new(Inner {
            config,
            client: reqwest::Client::new(),
            keys: Mutex::new(KeyCache {
                keys,
                loaded: Instant::now(),
            }),
        })))
    }
    async fn verify(&self, token: &str) -> Result<Principal, StatusCode> {
        let header = decode_header(token).map_err(|_| StatusCode::UNAUTHORIZED)?;
        if header.alg != Algorithm::RS256 {
            return Err(StatusCode::UNAUTHORIZED);
        }
        let kid = header
            .kid
            .filter(|s| !s.is_empty())
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let mut cache = self.0.keys.lock().await;
        // Refresh on expiry or an unknown kid (rotation), rate limited to avoid fetch storms.
        if cache.loaded.elapsed() >= Duration::from_secs(300)
            || (cache.keys.find(&kid).is_none() && cache.loaded.elapsed() >= Duration::from_secs(5))
        {
            cache.keys = fetch_keys(&self.0.client, &self.0.config.jwks_url)
                .await
                .map_err(|_| StatusCode::UNAUTHORIZED)?;
            cache.loaded = Instant::now();
        }
        let jwk = cache.keys.find(&kid).ok_or(StatusCode::UNAUTHORIZED)?;
        let key = DecodingKey::from_jwk(jwk).map_err(|_| StatusCode::UNAUTHORIZED)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.leeway = 0;
        validation.validate_nbf = true;
        validation.validate_aud = false;
        if let Some(issuer) = &self.0.config.issuer {
            validation.set_issuer(&[issuer]);
            validation.required_spec_claims.insert("iss".into());
        }
        let claims = decode::<Principal>(token, &key, &validation)
            .map_err(|_| StatusCode::UNAUTHORIZED)?
            .claims;
        if claims.sub.is_empty() {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(claims)
    }
}
async fn fetch_keys(client: &reqwest::Client, url: &str) -> Result<JwkSet> {
    let keys: JwkSet = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    validate_keys(&keys)?;
    Ok(keys)
}
fn validate_keys(keys: &JwkSet) -> Result<()> {
    if keys.keys.is_empty() {
        bail!("API JWKS must contain an RSA verification key");
    }
    let mut identifiers = std::collections::HashSet::new();
    for key in &keys.keys {
        if key.common.key_id.as_deref().is_none_or(str::is_empty)
            || !matches!(
                key.algorithm,
                jsonwebtoken::jwk::AlgorithmParameters::RSA(_)
            )
        {
            bail!("API JWKS requires RSA keys with kid");
        }
        if !identifiers.insert(key.common.key_id.as_deref())
            || key
                .common
                .key_algorithm
                .is_some_and(|algorithm| algorithm != jsonwebtoken::jwk::KeyAlgorithm::RS256)
            || key
                .common
                .public_key_use
                .as_ref()
                .is_some_and(|usage| *usage != jsonwebtoken::jwk::PublicKeyUse::Signature)
        {
            bail!("API JWKS must contain unique signing key IDs for RS256");
        }
        if let jsonwebtoken::jwk::AlgorithmParameters::RSA(rsa) = &key.algorithm
            && (rsa.n.len() < 342 || rsa.e.is_empty())
        {
            bail!("API JWKS requires an RSA modulus of at least 2048 bits and an exponent");
        }
        DecodingKey::from_jwk(key).context("Invalid API JWKS RSA key")?;
    }
    Ok(())
}

/// Verified identity passed to handlers. Stores must use authorized organization/project IDs.
#[derive(Clone, Deserialize)]
pub struct Principal {
    pub sub: String,
    #[serde(default, rename = "currentOrgId", alias = "organization_id")]
    pub current_org: Option<String>,
    #[serde(default, rename = "orgMemberships")]
    pub memberships: Vec<Membership>,
    #[serde(default)]
    pub project_ids: Vec<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default, rename = "isDevAdmin")]
    pub dev_admin: bool,
    #[serde(default)]
    pub aud: Option<Audience>,
    #[serde(default, rename = "organizationId")]
    pub organization_id: Option<String>,
    #[serde(default, rename = "projectId")]
    pub project_id: Option<String>,
    #[serde(default, rename = "markerId")]
    pub marker_id: Option<String>,
}
#[derive(Clone, Deserialize)]
pub struct Membership {
    #[serde(rename = "orgId")]
    pub org_id: String,
    pub role: String,
}
#[derive(Clone, Deserialize)]
#[serde(untagged)]
pub enum Audience {
    One(String),
    Many(Vec<String>),
}
impl Principal {
    fn exact_audience(&self, expected: &str) -> bool {
        match &self.aud {
            Some(Audience::One(v)) => v == expected,
            Some(Audience::Many(v)) => v == &[expected],
            None => false,
        }
    }
    pub fn authorize_tenant(
        &self,
        organization: &str,
        project: Option<&str>,
    ) -> Result<(), StatusCode> {
        let allowed = self.dev_admin
            || self.scopes.iter().any(|s| s == "admin")
            || self.current_org.as_deref() == Some(organization)
            || self.memberships.iter().any(|m| m.org_id == organization);
        if !allowed
            || project.is_some_and(|p| {
                !self.project_ids.is_empty() && !self.project_ids.iter().any(|id| id == p)
            })
        {
            return Err(StatusCode::FORBIDDEN);
        }
        Ok(())
    }
}
#[derive(Default, Deserialize)]
struct Scope {
    #[serde(rename = "organizationId")]
    organization: Option<String>,
    #[serde(rename = "projectId")]
    project: Option<String>,
    #[serde(rename = "markerId")]
    marker: Option<String>,
}
#[derive(Clone)]
struct Requirement {
    auth: Authenticator,
    policy: Policy,
    surface: Surface,
}
/// Route groups declare a policy for every method when registering it.
pub struct AuthenticatedRouter {
    router: axum::Router,
    auth: Authenticator,
    surface: Surface,
}
impl AuthenticatedRouter {
    pub fn new(auth: Authenticator, surface: Surface) -> Self {
        Self {
            router: axum::Router::new(),
            auth,
            surface,
        }
    }
    pub fn route(mut self, path: &str, method: MethodRouter, policy: Policy) -> Self {
        let requirement = Requirement {
            auth: self.auth.clone(),
            policy,
            surface: self.surface,
        };
        self.router = self.router.route(
            path,
            method.layer(middleware::from_fn_with_state(requirement, authenticate)),
        );
        self
    }
    pub fn finish(self) -> axum::Router {
        self.router
    }
}

async fn authenticate(
    State(requirement): State<Requirement>,
    request: Request,
    next: Next,
) -> Response {
    let uri = request
        .extensions()
        .get::<OriginalUri>()
        .map(|original| &original.0)
        .unwrap_or_else(|| request.uri());
    let path = uri.path().to_owned();
    match authorize(&requirement, request).await {
        Ok(request) => next.run(request).await,
        Err(status) => rejection(&requirement, status, &path),
    }
}

fn rejection(requirement: &Requirement, status: StatusCode, path: &str) -> Response {
    let deletion = matches!(requirement.policy, Policy::Deletion(_));
    let body = match requirement.surface {
        Surface::Graph => {
            let timestamp = time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .expect("UTC timestamp formats as RFC3339");
            let mut body = serde_json::json!({
                "timestamp": timestamp,
                "status": status.as_u16(),
                "error": status.canonical_reason().unwrap_or("Error"),
                "path": path,
            });
            // Ordinary Graph errors use Spring's default fields. Projection deletion
            // publishes the additional message field in its ErrorResponse contract.
            if deletion {
                body["message"] = serde_json::json!(if status == StatusCode::UNAUTHORIZED {
                    "Authentication is required"
                } else {
                    "The credential is not authorized for this operation"
                });
            }
            body
        }
        Surface::Search => serde_json::json!({"detail": if status == StatusCode::UNAUTHORIZED {
            "Authentication required"
        } else {
            "Access denied"
        }}),
    };
    let mut response = (status, axum::Json(body)).into_response();
    if matches!(requirement.surface, Surface::Search)
        || (deletion && status == StatusCode::UNAUTHORIZED)
    {
        response.headers_mut().insert(
            "www-authenticate",
            axum::http::HeaderValue::from_static("Bearer"),
        );
    }
    response
}

fn body_scopes(bytes: &[u8]) -> Result<Vec<Scope>, StatusCode> {
    if bytes.is_empty() {
        return Ok(vec![Scope::default()]);
    }
    let scope = serde_json::from_slice(bytes).map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(vec![scope])
}

async fn authorize(requirement: &Requirement, request: Request) -> Result<Request, StatusCode> {
    let token = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let principal = requirement.auth.verify(token).await?;
    let segments: Vec<_> = request.uri().path().split('/').collect();
    let path_org = segments
        .windows(2)
        .find(|s| matches!(s[0], "organizations" | "orgs"))
        .map(|s| s[1]);
    let path_project = segments
        .windows(2)
        .find(|s| s[0] == "projects")
        .map(|s| s[1]);
    let query: Scope = serde_urlencoded::from_str(request.uri().query().unwrap_or(""))
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let path = Scope {
        organization: path_org.map(str::to_owned),
        project: path_project.map(str::to_owned),
        marker: None,
    };
    let (mut parts, body) = request.into_parts();
    let bytes = to_bytes(body, 2 * 1024 * 1024)
        .await
        .map_err(|_| StatusCode::PAYLOAD_TOO_LARGE)?;
    let body_scopes = body_scopes(&bytes)?;
    let body = &body_scopes[0];
    let mut scopes = vec![&path, &query];
    scopes.extend(body_scopes.iter());
    let requested_org = scopes
        .iter()
        .find_map(|scope| scope.organization.as_deref());
    let requested_project = scopes.iter().find_map(|scope| scope.project.as_deref());
    for scope in &scopes {
        if scope
            .organization
            .as_deref()
            .zip(requested_org)
            .is_some_and(|(left, right)| left != right)
            || scope
                .project
                .as_deref()
                .zip(requested_project)
                .is_some_and(|(left, right)| left != right)
        {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let config = &requirement.auth.0.config;
    match requirement.policy {
        Policy::Deletion(surface) => {
            let audience = match surface {
                Surface::Graph => &config.graph_audience,
                Surface::Search => &config.search_audience,
            };
            if principal.scopes != ["organization:projection:delete"]
                || !principal.exact_audience(audience)
                || path.organization.is_none()
                || principal.organization_id != path.organization
                || body.organization != path.organization
                || principal.marker_id.is_none()
                || principal.marker_id != body.marker
            {
                return Err(StatusCode::FORBIDDEN);
            }
        }
        Policy::Debug => {
            // Only the API-issued, Embeddings-targeted debug credential; ordinary
            // read/write/admin credentials never reach stored documents.
            if principal.scopes != ["embeddings:debug:read"]
                || !principal.exact_audience(&config.search_audience)
            {
                return Err(StatusCode::FORBIDDEN);
            }
        }
        Policy::Template => {
            if principal.scopes != ["project:template:copy"]
                || !principal.exact_audience(&config.graph_audience)
                || principal.organization_id != path.organization
                || principal.project_id != path.project
                || path.organization.is_none()
                || path.project.is_none()
                || principal.sub
                    != format!(
                        "system:template-copy:{}",
                        path.organization.as_deref().unwrap_or_default()
                    )
            {
                return Err(StatusCode::FORBIDDEN);
            }
        }
        policy => {
            if principal.scopes.iter().any(|s| {
                s == "organization:projection:delete"
                    || s == "project:template:copy"
                    || s == "embeddings:debug:read"
            }) {
                return Err(StatusCode::FORBIDDEN);
            }
            if config
                .user_audience
                .as_ref()
                .is_some_and(|aud| !principal.exact_audience(aud))
            {
                return Err(StatusCode::FORBIDDEN);
            }
            for scope in &scopes {
                if let Some(org) = scope
                    .organization
                    .as_deref()
                    .or(requested_org)
                    .or(principal.current_org.as_deref())
                {
                    principal.authorize_tenant(org, scope.project.as_deref())?;
                } else if !principal.dev_admin {
                    return Err(StatusCode::FORBIDDEN);
                }
            }
            let permission = match policy {
                Policy::Read => Some("read"),
                _ => None,
            };
            if let Some(permission) = permission {
                let org = requested_org.or(principal.current_org.as_deref());
                let role = principal
                    .memberships
                    .iter()
                    .find(|m| Some(m.org_id.as_str()) == org)
                    .map(|m| m.role.as_str());
                let role_allows = matches!(role, Some("OWNER" | "ADMIN" | "MEMBER"))
                    || (permission == "read" && role == Some("VIEWER"));
                if !principal.dev_admin
                    && !principal.scopes.iter().any(|s| s == permission)
                    && !role_allows
                {
                    return Err(StatusCode::FORBIDDEN);
                }
            }
        }
    }
    parts.extensions.insert(principal);
    Ok(Request::from_parts(parts, Body::from(bytes)))
}
