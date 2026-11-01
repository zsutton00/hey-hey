//! A publisher that is far faster than the lanes cannot make the consumer
//! buffer without bound: once the lane is full the reader stops reading the
//! socket, so the backlog stays with Redis. No database or model is needed; a
//! minimal in-process Redis on a Unix socket speaks just enough Pub/Sub for the
//! reader.

use std::{
    io::{BufRead, BufReader, Read, Write},
    os::unix::net::{UnixListener, UnixStream},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use hey_hey_graph_search::search::ingest::{
    config::EventsConfig,
    consumer::{Job, spawn_reader},
    event::SUBSCRIBED,
};
use tokio::sync::mpsc;

const PREFIX: &str = "backpressure:";
const MESSAGES: usize = 600;
const MESSAGE_BYTES: usize = 256 * 1024;
const LANE_CAPACITY: usize = 2;

/// Reads one `*N` command of `$len` bulk strings.
fn read_command(reader: &mut BufReader<UnixStream>) -> Option<Vec<String>> {
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let count: usize = line.trim().strip_prefix('*')?.parse().ok()?;
    let mut parts = Vec::with_capacity(count);
    for _ in 0..count {
        line.clear();
        reader.read_line(&mut line).ok()?;
        let length: usize = line.trim().strip_prefix('$')?.parse().ok()?;
        let mut bytes = vec![0; length + 2];
        reader.read_exact(&mut bytes).ok()?;
        parts.push(String::from_utf8_lossy(&bytes[..length]).into_owned());
    }
    Some(parts)
}

/// A publisher: confirms the subscriptions, then writes as fast as the
/// socket accepts, counting the messages it managed to hand over.
fn fake_redis(listener: UnixListener, written: Arc<AtomicUsize>) {
    let (stream, _) = listener.accept().unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut stream = stream;

    let mut subscribed = 0;
    while subscribed < SUBSCRIBED.len() {
        let Some(command) = read_command(&mut reader) else {
            return;
        };
        if command[0].eq_ignore_ascii_case("subscribe") {
            subscribed += 1;
            let channel = &command[1];
            let reply = format!(
                "*3\r\n$9\r\nsubscribe\r\n${}\r\n{channel}\r\n:{subscribed}\r\n",
                channel.len()
            );
            stream.write_all(reply.as_bytes()).unwrap();
        } else {
            stream.write_all(b"+OK\r\n").unwrap();
        }
    }

    let channel = format!("{PREFIX}task.created");
    let event = format!(
        r#"{{"event":{{"id":"e","type":"task.created","aggregateId":"item","payload":{{"pad":"{}"}}}}}}"#,
        "x".repeat(MESSAGE_BYTES)
    );
    let frame = format!(
        "*3\r\n$7\r\nmessage\r\n${}\r\n{channel}\r\n${}\r\n{event}\r\n",
        channel.len(),
        event.len()
    );
    for _ in 0..MESSAGES {
        if stream.write_all(frame.as_bytes()).is_err() {
            return;
        }
        written.fetch_add(1, Ordering::SeqCst);
    }
}

#[test]
fn a_fast_publisher_waits_instead_of_filling_memory() {
    let directory = std::env::temp_dir().join(format!("backpressure-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let socket = directory.join("redis.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let written = Arc::new(AtomicUsize::new(0));
    let publisher = {
        let written = written.clone();
        thread::spawn(move || fake_redis(listener, written))
    };

    // One lane that nothing drains, like an encoder far slower than the bus.
    let (sender, mut receiver) = mpsc::channel::<Job>(LANE_CAPACITY);
    let stop = Arc::new(AtomicBool::new(false));
    let _reader = spawn_reader(
        EventsConfig {
            redis_url: format!("redis+unix://{}", socket.display()),
            channel_prefix: PREFIX.into(),
            lanes: 1,
            lane_capacity: LANE_CAPACITY,
        },
        vec![sender],
        stop.clone(),
    );

    // Wait until the publisher stops making progress.
    let mut last = 0;
    let mut steady_since = Instant::now();
    let deadline = Instant::now() + Duration::from_secs(30);
    while steady_since.elapsed() < Duration::from_secs(1) {
        assert!(Instant::now() < deadline, "the publisher never stalled");
        thread::sleep(Duration::from_millis(100));
        let now = written.load(Ordering::SeqCst);
        if now != last {
            last = now;
            steady_since = Instant::now();
        }
    }

    // The reader took what the lane holds, one more in hand, and no more. The
    // rest is held back in socket buffers, far below what was sent.
    assert_eq!(receiver.len(), LANE_CAPACITY);
    let held_back = written.load(Ordering::SeqCst);
    assert!(
        held_back < MESSAGES / 4,
        "{held_back} of {MESSAGES} messages were accepted without being applied"
    );

    // Applying events lets the publisher continue.
    let drained = Instant::now();
    let mut received = 0;
    while received < MESSAGES && drained.elapsed() < Duration::from_secs(60) {
        if receiver.try_recv().is_ok() {
            received += 1;
        } else {
            thread::sleep(Duration::from_millis(1));
        }
    }
    assert_eq!(received, MESSAGES);

    stop.store(true, Ordering::SeqCst);
    publisher.join().unwrap();
    std::fs::remove_dir_all(&directory).unwrap();
}
