use hey_hey_graph_search::auth::{Authenticator, TrustConfig};
pub fn auth() -> Authenticator {
    Authenticator::from_jwks(
        TrustConfig {
            jwks_url: "http://127.0.0.1:1/jwks".into(),
            issuer: None,
            user_audience: None,
            graph_audience: "graph-service".into(),
            search_audience: "embeddings-service".into(),
        },
        serde_json::from_str(include_str!("../fixtures/jwks.json")).unwrap(),
    )
    .unwrap()
}
