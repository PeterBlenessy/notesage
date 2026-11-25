//! Drains a long-lived stdio MCP server's stderr.
//!
//! MCP servers log to stderr (the spec tells them to; many log every request).
//! A piped stderr that nobody reads fills the OS pipe buffer (~64 KB on macOS),
//! after which the server's next log write blocks forever and it stops
//! answering JSON-RPC. So the pipe is read for the life of the process: each
//! line goes to the log, and the last few are kept for error messages.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};

/// Lines of stderr retained per server.
const STDERR_TAIL_LINES: usize = 40;

/// Longest line read in one piece. A server that writes without newlines must
/// not grow the buffer without bound; longer lines are logged in pieces.
const STDERR_MAX_LINE_BYTES: u64 = 8 * 1024;

/// The most recent stderr lines of one MCP server, oldest first.
#[derive(Clone, Default)]
pub(crate) struct StderrTail(Arc<Mutex<VecDeque<String>>>);

impl StderrTail {
    /// Keep `line` as the newest retained line. Also used for stray
    /// non-protocol lines a server prints on stdout, which are as much "what
    /// the server said" as its stderr.
    pub(crate) fn push(&self, line: String) {
        if let Ok(mut tail) = self.0.lock() {
            if tail.len() >= STDERR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line);
        }
    }

    /// The retained lines joined with newlines, or `None` when there are none.
    pub(crate) fn snapshot(&self) -> Option<String> {
        let tail = self.0.lock().ok()?;
        if tail.is_empty() {
            return None;
        }
        Some(tail.iter().map(String::as_str).collect::<Vec<_>>().join("\n"))
    }

    /// The snapshot, taken after giving the drain task a moment to read what
    /// a process wrote just before it died. Without the pause, an error
    /// raised the instant stdout closes would usually miss the very lines
    /// that explain it. Waits at most `patience`, returning as soon as the
    /// tail has stopped growing.
    pub(crate) async fn settled_snapshot(&self, patience: std::time::Duration) -> Option<String> {
        let step = std::time::Duration::from_millis(25);
        let mut waited = std::time::Duration::ZERO;
        let mut last = self.snapshot();
        while waited < patience {
            tokio::time::sleep(step).await;
            waited += step;
            let now = self.snapshot();
            if now == last && now.is_some() {
                break;
            }
            last = now;
        }
        last
    }
}

/// Append what the server printed to an error message, the way every MCP
/// start/validation failure presents it.
pub(crate) fn with_server_output(message: String, tail: Option<&str>) -> String {
    match tail {
        Some(tail) if !tail.trim().is_empty() => {
            format!("{}\n\nServer output:\n{}", message, tail)
        }
        _ => message,
    }
}

/// Read `reader` until it closes, logging each line and keeping it in `tail`.
///
/// Separate from [`spawn_stderr_drain`] so tests can await it directly.
async fn drain_stderr<R>(reader: R, server_id: &str, tail: &StderrTail)
where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        // `take` caps how much one "line" may buffer; the remainder of an
        // over-long line is picked up by the next iteration.
        match (&mut reader)
            .take(STDERR_MAX_LINE_BYTES)
            .read_until(b'\n', &mut buf)
            .await
        {
            Ok(0) => break,
            Ok(_) => {}
            Err(e) => {
                log::debug!(target: "notesage::mcp", "[{}] stderr read error: {}", server_id, e);
                break;
            }
        }
        let text = String::from_utf8_lossy(&buf);
        let line = text.trim_end_matches(['\n', '\r']);
        if line.trim().is_empty() {
            continue;
        }
        // Debug, not warn: servers log routine per-request lines here.
        log::debug!(target: "notesage::mcp", "[{}] stderr: {}", server_id, line);
        tail.push(line.to_string());
    }
}

/// Drain `reader` for the life of the process on a background task.
/// Ends when the pipe closes (i.e. the server exits). Returns the bounded tail.
pub(crate) fn spawn_stderr_drain<R>(reader: R, server_id: String) -> StderrTail
where
    R: AsyncRead + Unpin + Send + 'static,
{
    let tail = StderrTail::default();
    let task_tail = tail.clone();
    tokio::spawn(async move {
        drain_stderr(reader, &server_id, &task_tail).await;
    });
    tail
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn keeps_lines_and_skips_blank_ones() {
        let tail = StderrTail::default();
        drain_stderr(&b"first\n\n  \nsecond\r\nno newline at end"[..], "s", &tail).await;
        assert_eq!(
            tail.snapshot().as_deref(),
            Some("first\nsecond\nno newline at end")
        );
    }

    #[tokio::test]
    async fn settled_snapshot_waits_for_lines_written_just_before_exit() {
        // The drain is still reading when the caller asks: a plain snapshot
        // taken now would be empty.
        let (mut writer, reader) = tokio::io::duplex(1024);
        let tail = spawn_stderr_drain(reader, "s".to_string());
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(60)).await;
            writer.write_all(b"Error: GITHUB_TOKEN is not set\n").await.unwrap();
            writer.shutdown().await.unwrap();
        });
        let snapshot = tail.settled_snapshot(std::time::Duration::from_secs(2)).await;
        assert_eq!(snapshot.as_deref(), Some("Error: GITHUB_TOKEN is not set"));
    }

    #[tokio::test]
    async fn settled_snapshot_gives_up_when_there_is_nothing() {
        let tail = StderrTail::default();
        let started = std::time::Instant::now();
        assert_eq!(tail.settled_snapshot(std::time::Duration::from_millis(100)).await, None);
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }

    #[test]
    fn server_output_is_appended_only_when_there_is_some() {
        assert_eq!(with_server_output("failed".to_string(), None), "failed");
        assert_eq!(with_server_output("failed".to_string(), Some("  \n")), "failed");
        assert_eq!(
            with_server_output("failed".to_string(), Some("boom")),
            "failed\n\nServer output:\nboom"
        );
    }

    #[tokio::test]
    async fn empty_stderr_has_no_snapshot() {
        let tail = StderrTail::default();
        drain_stderr(&b""[..], "s", &tail).await;
        assert_eq!(tail.snapshot(), None);
    }

    #[tokio::test]
    async fn tail_is_bounded_to_the_most_recent_lines() {
        let mut input = String::new();
        for i in 0..(STDERR_TAIL_LINES + 25) {
            input.push_str(&format!("line {}\n", i));
        }
        let tail = StderrTail::default();
        drain_stderr(input.as_bytes(), "s", &tail).await;
        let snapshot = tail.snapshot().unwrap();
        let lines: Vec<&str> = snapshot.lines().collect();
        assert_eq!(lines.len(), STDERR_TAIL_LINES);
        assert_eq!(lines[0], "line 25");
        assert_eq!(lines[STDERR_TAIL_LINES - 1], format!("line {}", STDERR_TAIL_LINES + 24));
    }

    #[tokio::test]
    async fn a_line_without_newline_cannot_grow_without_bound() {
        let input = vec![b'x'; (STDERR_MAX_LINE_BYTES as usize) * 3 + 10];
        let tail = StderrTail::default();
        drain_stderr(&input[..], "s", &tail).await;
        let snapshot = tail.snapshot().unwrap();
        let lines: Vec<&str> = snapshot.lines().collect();
        assert_eq!(lines.len(), 4);
        assert!(lines.iter().all(|l| l.len() <= STDERR_MAX_LINE_BYTES as usize));
    }

    /// The regression itself: a writer that produces far more than a pipe
    /// buffer must never block, because the drain keeps reading.
    #[tokio::test]
    async fn writer_is_never_blocked_by_a_full_pipe() {
        // 1 KB of buffer stands in for the OS pipe; 512 KB is written to it.
        let (mut writer, reader) = tokio::io::duplex(1024);
        let tail = spawn_stderr_drain(reader, "s".to_string());

        let write_all = async {
            let line = format!("{}\n", "y".repeat(127));
            for _ in 0..4096 {
                writer.write_all(line.as_bytes()).await.unwrap();
            }
            writer.shutdown().await.unwrap();
        };
        tokio::time::timeout(std::time::Duration::from_secs(10), write_all)
            .await
            .expect("an undrained pipe would block the writer here");

        // Give the drain a moment to consume what is still buffered.
        for _ in 0..100 {
            if tail.snapshot().map(|s| s.lines().count()) == Some(STDERR_TAIL_LINES) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(
            tail.snapshot().map(|s| s.lines().count()),
            Some(STDERR_TAIL_LINES)
        );
    }
}
