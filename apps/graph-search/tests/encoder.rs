use std::path::PathBuf;

use hey_hey_graph_search::{config::Config, search::encoder::Encoder};

const URL: &str = "postgres://graph_search:secret@localhost/heyhey_graph_search";

fn config(overrides: &[(&str, &str)]) -> Config {
    Config::from_lookup(|key| {
        Ok(std::iter::once(("GRAPH_SEARCH_DATABASE_URL", URL))
            .chain(overrides.iter().copied())
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value.to_string()))
    })
    .unwrap()
}

#[test]
fn defaults_to_arctic_embed_s_encoding_one_text_at_a_time() {
    let encoder = config(&[]).search.encoder;
    assert_eq!(encoder.model, "snowflake-arctic-embed-s");
    assert_eq!(encoder.dimension, 384);
    assert_eq!(encoder.max_batch, 1);
    assert_eq!(
        encoder.model_dir,
        PathBuf::from("models/snowflake-arctic-embed-s")
    );
}

#[test]
fn missing_model_files_say_what_to_download_and_where() {
    let dir = std::env::temp_dir().join(format!("graph-search-no-model-{}", std::process::id()));
    let config = config(&[("SEARCH_EMBEDDING_MODEL_DIR", dir.to_str().unwrap())]);

    let error = Encoder::load(&config.search.encoder)
        .err()
        .unwrap()
        .to_string();

    for expected in [
        dir.to_str().unwrap(),
        "model_quantized.onnx",
        "tokenizer.json",
        "https://huggingface.co/Snowflake/snowflake-arctic-embed-s",
        "scripts/fetch-model.sh",
    ] {
        assert!(error.contains(expected), "{expected} missing from: {error}");
    }
}

fn model_encoder(max_batch: &str) -> Encoder {
    let dir = std::env::var("GRAPH_SEARCH_TEST_MODEL_DIR").unwrap();
    let config = config(&[
        ("SEARCH_EMBEDDING_MODEL_DIR", &dir),
        ("SEARCH_EMBEDDING_MAX_BATCH", max_batch),
    ]);
    Encoder::load(&config.search.encoder).unwrap()
}

#[tokio::test]
#[ignore = "requires the model files; run scripts/fetch-model.sh and set GRAPH_SEARCH_TEST_MODEL_DIR"]
async fn the_same_text_always_produces_the_same_vector_through_one_interface() {
    let encoder = model_encoder("1");
    let texts = [
        "Keep searchable text current from work-item events",
        "Benchmark candidate embedding models",
        "Authenticate graph and search requests",
    ];

    let first = encoder.encode(texts[0]).await.unwrap();
    let again = encoder.encode(texts[0]).await.unwrap();
    let batch = encoder.encode_batch(&texts).await.unwrap();

    assert_eq!(first.len(), 384);
    assert_eq!(first, again);
    assert_eq!(batch.len(), texts.len());
    assert_eq!(batch[0], first);
    let norm: f32 = first.iter().map(|value| value * value).sum::<f32>().sqrt();
    assert!((norm - 1.0).abs() < 1e-4);

    // Related texts land closer together than unrelated ones.
    let query = encoder.encode("embedding model benchmark").await.unwrap();
    let similarity =
        |vector: &[f32]| -> f32 { vector.iter().zip(&query).map(|(a, b)| a * b).sum() };
    assert!(similarity(&batch[1]) > similarity(&batch[2]));
}

#[tokio::test]
#[ignore = "requires the model files; run scripts/fetch-model.sh and set GRAPH_SEARCH_TEST_MODEL_DIR"]
async fn at_the_default_cap_a_vector_does_not_depend_on_the_texts_around_it() {
    // The INT8 model quantizes each batch as a whole, so only one-text batches
    // keep a document's stored vector equal to its later query-time vector.
    let encoder = model_encoder("1");
    let text = "one searchable unit";

    let alone = encoder.encode(text).await.unwrap();
    let in_a_list = encoder
        .encode_batch(&[
            "a much longer neighbouring text about graph traversal",
            text,
        ])
        .await
        .unwrap();

    assert_eq!(in_a_list[1], alone);
}
