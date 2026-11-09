use std::{env, process};

use anyhow::{Context, Result, bail};
use hey_hey_graph_search::{
    config::Config,
    graph::{proposed_together, store::Scope},
};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("PROPOSED_TOGETHER backfill failed: {error:#}");
        process::exit(1);
    }
}

async fn run() -> Result<()> {
    let arguments = Arguments::parse(env::args().skip(1))?;
    let config = Config::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .connect_with(config.database)
        .await
        .context("cannot connect to GRAPH_SEARCH_DATABASE_URL")?;
    let (database, version, index_ready): (String, i32, bool) = sqlx::query_as(
        "SELECT current_database(), current_setting('server_version_num')::int, to_regclass('graph.graph_proposal_conversation_create') IS NOT NULL",
    )
        .fetch_one(&pool)
        .await?;
    if database != hey_hey_graph_search::config::DATABASE_NAME {
        bail!("refusing to backfill a database other than heyhey_graph_search");
    }
    if !(170000..180000).contains(&version) {
        bail!("the backfill requires PostgreSQL 17");
    }
    if !index_ready {
        bail!("run the graph-search migrations before starting the backfill");
    }

    let scope = Scope {
        organization: arguments.organization_id,
        project: arguments.project_id,
    };
    let missing = proposed_together::missing_conversations(&pool, &scope).await?;
    println!(
        "{}",
        serde_json::to_string(&json!({"type":"missingConversationDiagnostics","report":missing}))?
    );

    let mut cursor = arguments.after_conversation_id;
    loop {
        let batch =
            proposed_together::run_batch(&pool, &scope, cursor.as_deref(), arguments.batch_size)
                .await?;
        let done = batch.cohorts == 0;
        if let Some(next) = batch.after_conversation_id.clone() {
            cursor = Some(next);
        }
        println!("{}", serde_json::to_string(&batch)?);
        if done {
            break;
        }
    }
    pool.close().await;
    Ok(())
}

struct Arguments {
    organization_id: String,
    project_id: String,
    after_conversation_id: Option<String>,
    batch_size: usize,
}

impl Arguments {
    fn parse(args: impl Iterator<Item = String>) -> Result<Self> {
        let mut organization_id = None;
        let mut project_id = None;
        let mut after_conversation_id = None;
        let mut batch_size = 100usize;
        let mut args = args;
        while let Some(argument) = args.next() {
            let value = args
                .next()
                .with_context(|| format!("missing value after {argument}"))?;
            anyhow::ensure!(!value.starts_with("--"), "missing value after {argument}");
            match argument.as_str() {
                "--organization-id" => organization_id = Some(value),
                "--project-id" => project_id = Some(value),
                "--after-conversation-id" => after_conversation_id = Some(value),
                "--batch-size" => batch_size = value.parse().context("invalid batch size")?,
                _ => bail!("unknown argument {argument}"),
            }
        }
        let organization_id = organization_id.context("--organization-id is required")?;
        let project_id = project_id.context("--project-id is required")?;
        anyhow::ensure!(
            !organization_id.trim().is_empty(),
            "organization ID is blank"
        );
        anyhow::ensure!(!project_id.trim().is_empty(), "project ID is blank");
        anyhow::ensure!(
            valid_uuid(&organization_id),
            "organization ID must be a UUID"
        );
        anyhow::ensure!(valid_uuid(&project_id), "project ID must be a UUID");
        if let Some(cursor) = &after_conversation_id {
            anyhow::ensure!(valid_uuid(cursor), "conversation cursor must be a UUID");
        }
        anyhow::ensure!(
            (1..=500).contains(&batch_size),
            "batch size must be between 1 and 500"
        );
        Ok(Self {
            organization_id,
            project_id,
            after_conversation_id,
            batch_size,
        })
    }
}

fn valid_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}
