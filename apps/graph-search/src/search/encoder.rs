use std::{sync::OnceLock, thread};

use anyhow::{Context, Result, anyhow, ensure};
use ort::{
    environment::Environment,
    session::{Session, builder::AutoDevicePolicy},
    value::Tensor,
};
use tokenizers::Tokenizer;
use tokio::sync::{mpsc, oneshot};

use super::config::EncoderConfig;

pub const MODEL_FILE: &str = "model_quantized.onnx";
pub const TOKENIZER_FILE: &str = "tokenizer.json";

// Few waiting batches: callers wait for the worker instead of piling texts into memory.
const QUEUE_DEPTH: usize = 4;

type Reply = oneshot::Sender<Result<Vec<Vec<f32>>>>;

/// Turns text into vectors. Document and query encoding both go through here,
/// so the stores never see the model.
#[derive(Clone)]
pub struct Encoder {
    jobs: mpsc::Sender<(Vec<String>, Reply)>,
    max_batch: usize,
}

impl Encoder {
    /// Loads the model from local files only; the service never downloads it.
    pub fn load(config: &EncoderConfig) -> Result<Self> {
        let mut model = Model::load(config)?;

        let (jobs, mut queue) = mpsc::channel::<(Vec<String>, Reply)>(QUEUE_DEPTH);
        // One dedicated thread keeps inference off the async runtime and holds
        // at most one batch in memory.
        thread::Builder::new()
            .name("search-encoder".into())
            .spawn(move || {
                while let Some((texts, reply)) = queue.blocking_recv() {
                    // A caller that gave up no longer needs the result.
                    let _ = reply.send(model.encode(&texts));
                }
            })
            .context("Cannot start the search encoder thread")?;

        Ok(Self {
            jobs,
            max_batch: config.max_batch,
        })
    }

    pub async fn encode(&self, text: &str) -> Result<Vec<f32>> {
        let mut vectors = self.encode_batch(&[text]).await?;
        Ok(vectors.remove(0))
    }

    /// Encodes in batches of at most the configured size.
    pub async fn encode_batch(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        let mut vectors = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(self.max_batch) {
            let (reply, result) = oneshot::channel();
            let batch = chunk.iter().map(|text| text.to_string()).collect();
            self.jobs
                .send((batch, reply))
                .await
                .map_err(|_| anyhow!("The search encoder has stopped"))?;
            vectors.extend(result.await.context("The search encoder has stopped")??);
        }
        Ok(vectors)
    }
}

struct Model {
    session: Session,
    tokenizer: Tokenizer,
    dimension: usize,
}

impl Model {
    fn load(config: &EncoderConfig) -> Result<Self> {
        let dir = &config.model_dir;
        let missing: Vec<&str> = [MODEL_FILE, TOKENIZER_FILE]
            .into_iter()
            .filter(|file| !dir.join(file).is_file())
            .collect();
        ensure!(missing.is_empty(), missing_files_message(config, &missing));

        // tokenizer.json carries the model's 512-token truncation and batch padding.
        let tokenizer = Tokenizer::from_file(dir.join(TOKENIZER_FILE)).map_err(|error| {
            anyhow!("Cannot read {TOKENIZER_FILE} in {}: {error}", dir.display())
        })?;

        // Plain CPU inference: otherwise ONNX Runtime picks CoreML on macOS.
        let session = Session::builder(environment()?)?
            .with_auto_device(AutoDevicePolicy::PreferCPU)
            .map_err(|error| anyhow!("{error}"))?
            .commit_from_file(dir.join(MODEL_FILE))
            .with_context(|| format!("Cannot load {MODEL_FILE} from {}", dir.display()))?;

        Ok(Self {
            session,
            tokenizer,
            dimension: config.dimension,
        })
    }

    fn encode(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let encodings = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|error| anyhow!("Cannot tokenize text for encoding: {error}"))?;
        let length = encodings[0].len();
        let shape = [texts.len(), length];
        let column = |pick: fn(&tokenizers::Encoding) -> &[u32]| -> Vec<i64> {
            encodings
                .iter()
                .flat_map(|encoding| pick(encoding).iter().map(|&id| i64::from(id)))
                .collect()
        };

        let outputs = self.session.run(ort::inputs![
            "input_ids" => Tensor::from_array((shape, column(|e| e.get_ids())))?,
            "attention_mask" => Tensor::from_array((shape, column(|e| e.get_attention_mask())))?,
            "token_type_ids" => Tensor::from_array((shape, column(|e| e.get_type_ids())))?,
        ])?;
        let (hidden_shape, hidden) = outputs["last_hidden_state"].try_extract_tensor::<f32>()?;

        let width = usize::try_from(hidden_shape[2])?;
        ensure!(
            width == self.dimension,
            "The model produces {width}-dimension vectors but SEARCH_EMBEDDING_DIMENSION is {}",
            self.dimension
        );

        // Arctic Embed pools the first ([CLS]) token and compares by cosine.
        let vectors = hidden
            .chunks(length * width)
            .map(|tokens| normalize(&tokens[..width]))
            .collect();
        Ok(vectors)
    }
}

/// ONNX Runtime allows one environment per process.
fn environment() -> Result<&'static Environment> {
    static ENVIRONMENT: OnceLock<Environment> = OnceLock::new();
    if let Some(environment) = ENVIRONMENT.get() {
        return Ok(environment);
    }
    let environment = ort::init().build()?;
    Ok(ENVIRONMENT.get_or_init(|| environment))
}

fn normalize(vector: &[f32]) -> Vec<f32> {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    vector.iter().map(|value| value / norm).collect()
}

fn missing_files_message(config: &EncoderConfig, missing: &[&str]) -> String {
    let source = format!("https://huggingface.co/Snowflake/{}", config.model);
    format!(
        "Search embedding model files are missing from {dir}: {files}. \
         Run scripts/fetch-model.sh {dir}, or download onnx/{MODEL_FILE} and {TOKENIZER_FILE} from {source} \
         into that folder. Set SEARCH_EMBEDDING_MODEL_DIR to use a different folder, or SEARCH_ENABLED=false to run without search.",
        dir = config.model_dir.display(),
        files = missing.join(", "),
    )
}
