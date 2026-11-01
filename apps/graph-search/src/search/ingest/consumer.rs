//! The Redis reader and the per-item lanes behind it.
//!
//! One reader subscribes to the channel of each event type and hands every
//! event to a lane chosen by a stable hash of its aggregate id. A lane applies
//! its events one at a time, so the events of one item apply in the order they
//! were published, while different items proceed independently. Any failure is
//! recorded for the one event and the consumer carries on; nothing here touches
//! the HTTP server.
//!
//! Memory is bounded from the socket to the lane. The reader is a dedicated
//! thread on a blocking Redis connection that reads one message at a time and
//! waits for room in the event's lane before reading the next. Redis's
//! asynchronous Pub/Sub client was not used because it queues incoming
//! messages in an unbounded channel. While a lane is full the reader stops
//! reading, the kernel socket buffers fill, and Redis holds the backlog on its
//! side (or drops the slow subscriber, as Pub/Sub does, which loses events like
//! any other outage). At most `lanes * lane_capacity` events wait in this
//! process, plus the one being routed and one per lane being applied.

use std::{
    panic::AssertUnwindSafe,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use anyhow::{Context, Result};
use futures_util::FutureExt;
use serde_json::Value;
use tokio::{
    sync::{mpsc, watch},
    task::JoinHandle,
};

use super::{
    Ingest,
    config::EventsConfig,
    error::IngestError,
    event::{self, SUBSCRIBED},
};

const FIRST_RETRY: Duration = Duration::from_secs(1);
const LAST_RETRY: Duration = Duration::from_secs(30);
const SHUTDOWN_DRAIN: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const SUBSCRIBE_TIMEOUT: Duration = Duration::from_secs(10);

/// A running consumer: the reader thread and one worker per lane.
pub struct Consumer {
    stop: Arc<AtomicBool>,
    stopping: watch::Sender<bool>,
    workers: Vec<JoinHandle<()>>,
}

/// An event waiting in a lane.
pub struct Job {
    event_type: String,
    event_id: String,
    envelope: Value,
}

/// The lane for an item. The hash is the one the deployed service uses, so
/// both place an item's events the same way.
pub fn lane_for(aggregate_id: &str, lanes: usize) -> usize {
    crc32fast::hash(aggregate_id.as_bytes()) as usize % lanes
}

impl Consumer {
    pub fn start(config: EventsConfig, ingest: Ingest) -> Self {
        let (stopping, _) = watch::channel(false);
        let mut senders = Vec::with_capacity(config.lanes);
        let mut workers = Vec::with_capacity(config.lanes);
        for lane in 0..config.lanes {
            let (sender, receiver) = mpsc::channel(config.lane_capacity);
            senders.push(sender);
            workers.push(tokio::spawn(run_lane(
                lane,
                receiver,
                ingest.clone(),
                stopping.subscribe(),
            )));
        }

        let stop = Arc::new(AtomicBool::new(false));
        spawn_reader(config, senders, stop.clone());
        Self {
            stop,
            stopping,
            workers,
        }
    }

    /// Stops reading, then lets the lanes finish what they already hold. The
    /// reader thread is blocked on the socket until the next message or the
    /// end of the process; it sends nothing further and exits then.
    pub async fn stop(self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.stopping.send(true);

        let drain = futures_util::future::join_all(self.workers);
        if tokio::time::timeout(SHUTDOWN_DRAIN, drain).await.is_err() {
            tracing::warn!("search events still being applied at shutdown were abandoned");
        }
    }
}

async fn run_lane(
    lane: usize,
    mut jobs: mpsc::Receiver<Job>,
    ingest: Ingest,
    mut stopping: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            biased;
            _ = stopping.changed() => break,
            job = jobs.recv() => match job {
                Some(job) => apply(lane, &ingest, job).await,
                None => return,
            },
        }
    }

    // Finish what is already queued; the reader sends nothing more.
    jobs.close();
    while let Ok(job) = jobs.try_recv() {
        apply(lane, &ingest, job).await;
    }
}

async fn apply(lane: usize, ingest: &Ingest, job: Job) {
    // A panic in one event must not end the lane and strand its items.
    let outcome = AssertUnwindSafe(ingest.handle(&job.envelope))
        .catch_unwind()
        .await;
    match outcome {
        Ok(Ok(())) => {
            tracing::debug!(
                lane,
                event_type = job.event_type,
                event_id = job.event_id,
                "search event applied"
            );
        }
        Ok(Err(error)) => record(lane, &job, &error),
        Err(_) => tracing::error!(
            lane,
            event_type = job.event_type,
            event_id = job.event_id,
            "search event handling panicked"
        ),
    }
}

/// Every event that did not apply is recorded with its identity, never its content.
fn record(lane: usize, job: &Job, error: &IngestError) {
    tracing::error!(
        lane,
        event_type = job.event_type,
        event_id = job.event_id,
        outcome = error.kind(),
        reason = %error,
        "search event not applied"
    );
}

/// Starts the reader on its own thread. The lanes are the only place events
/// wait; see the module notes.
pub fn spawn_reader(
    config: EventsConfig,
    lanes: Vec<mpsc::Sender<Job>>,
    stop: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::Builder::new()
        .name("search-events-reader".into())
        .spawn(move || read_forever(&config, &lanes, &stop))
        .expect("the OS can start a thread")
}

/// Reads until stopped. A lost connection is retried; events published while
/// disconnected are not recovered, because Pub/Sub keeps no history.
fn read_forever(config: &EventsConfig, lanes: &[mpsc::Sender<Job>], stop: &AtomicBool) {
    let mut delay = FIRST_RETRY;
    while !stop.load(Ordering::SeqCst) {
        match read(config, lanes, stop) {
            Ok(()) => tracing::warn!("search event subscription ended"),
            Err(error) => {
                tracing::error!(
                    error = format!("{error:#}"),
                    "search event subscription failed"
                );
            }
        }

        wait_unless_stopped(delay, stop);
        delay = (delay * 2).min(LAST_RETRY);
    }
}

fn wait_unless_stopped(delay: Duration, stop: &AtomicBool) {
    let step = Duration::from_millis(200);
    let mut waited = Duration::ZERO;
    while waited < delay && !stop.load(Ordering::SeqCst) {
        thread::sleep(step);
        waited += step;
    }
}

fn read(config: &EventsConfig, lanes: &[mpsc::Sender<Job>], stop: &AtomicBool) -> Result<()> {
    // The URL can carry credentials, so it never appears in an error message.
    let client = redis::Client::open(config.redis_url.as_str())
        .map_err(|_| anyhow::anyhow!("REDIS_URL is not a valid Redis URL"))?;
    let mut connection = client
        .get_connection_with_timeout(CONNECT_TIMEOUT)
        .context("Cannot connect to Redis for search events")?;
    let mut pubsub = connection.as_pubsub();

    // Subscribing waits for the server's answers; waiting for messages must not
    // time out, because a timeout in the middle of a message loses its start.
    pubsub.set_read_timeout(Some(SUBSCRIBE_TIMEOUT))?;
    for event_type in SUBSCRIBED {
        let channel = format!("{}{event_type}", config.channel_prefix);
        pubsub
            .subscribe(&channel)
            .with_context(|| format!("Cannot subscribe to {channel}"))?;
    }
    pubsub.set_read_timeout(None)?;
    tracing::info!(channels = SUBSCRIBED.len(), "search events subscribed");

    loop {
        let message = pubsub
            .get_message()
            .context("The search event subscription was lost")?;
        if stop.load(Ordering::SeqCst) {
            return Ok(());
        }
        if route(message.get_payload_bytes(), lanes).is_err() {
            return Ok(());
        }
    }
}

/// A lane's worker has gone, so nothing more can be applied.
struct LanesClosed;

/// Validates just enough to place the event, then waits for room in its lane.
fn route(payload: &[u8], lanes: &[mpsc::Sender<Job>]) -> Result<(), LanesClosed> {
    let envelope: Value = match serde_json::from_slice(payload) {
        Ok(envelope) => envelope,
        Err(_) => {
            tracing::error!(outcome = "rejected", "search event is not valid JSON");
            return Ok(());
        }
    };
    let event = event::unwrap_envelope(&envelope);
    let placed = event::aggregate_id(event).and_then(|aggregate_id| {
        let event_type = event::event_type(event)?.to_owned();
        let event_id = event["id"].as_str().unwrap_or_default().to_owned();
        Ok((aggregate_id.to_owned(), event_type, event_id))
    });
    let (aggregate_id, event_type, event_id) = match placed {
        Ok(placed) => placed,
        Err(error) => {
            tracing::error!(outcome = error.kind(), reason = %error, "search event cannot be routed");
            return Ok(());
        }
    };

    let lane = &lanes[lane_for(&aggregate_id, lanes.len())];
    let job = Job {
        event_type,
        event_id,
        envelope,
    };
    lane.blocking_send(job).map_err(|_| LanesClosed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items_map_to_the_same_lane_as_the_deployed_service() {
        // zlib.crc32(b"hello") is 0x3610a686, the hash the deployed service takes.
        assert_eq!(crc32fast::hash(b"hello"), 0x3610_a686);
        assert_eq!(lane_for("hello", 4), 0x3610_a686_usize % 4);
        assert_eq!(lane_for("hello", 1), 0);
    }
}
