//! Downloading a Whisper model so that an interrupted download costs nothing.
//!
//! The file is written to `<name>.downloading` and renamed when complete and
//! verified. A partial file is kept (also across app launches) and continued
//! with an HTTP `Range` request. A connection that stops sending is noticed
//! (it used to hang forever, and "cancel" could not interrupt it), the disk
//! is checked for room first, and nothing that is not a complete Whisper
//! model is ever given the final name.

use futures::StreamExt;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

/// The Hugging Face repository the models come from.
pub const MODEL_REPO: &str = "ggerganov/whisper.cpp";

/// The repository revision downloads resolve against.
///
/// This should be a commit id, with a SHA-256 per model in the catalogue, so
/// that what is downloaded cannot change under the app. Neither could be
/// obtained and checked when this was written (no access to the repository),
/// and an unverified id or hash would break every download. Until someone
/// fills them in from the repository itself, the branch is used and the
/// checks that need no outside knowledge are enforced: the byte count the
/// server announced, and the file's own magic number.
pub const MODEL_REVISION: &str = "main";

/// The first four bytes of every ggml model file (`0x67676d6c`, stored
/// little-endian).
const GGML_MAGIC: [u8; 4] = *b"lmgg";

/// Free space required beyond the bytes still to download.
const FREE_SPACE_MARGIN: u64 = 64 * 1024 * 1024;

pub const CANCELLED: &str = "Download cancelled";

pub fn model_file_name(model: &str) -> String {
    format!("ggml-{model}.bin")
}

pub fn model_url(model: &str) -> String {
    format!(
        "https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{}",
        model_file_name(model)
    )
}

/// The partial file for `model`. The revision is part of the name, so a
/// partial download of one revision is never continued with another's bytes.
pub fn temp_file_name(model: &str) -> String {
    if MODEL_REVISION == "main" {
        format!("{}.downloading", model_file_name(model))
    } else {
        let short: String = MODEL_REVISION.chars().take(12).collect();
        format!("{}.{short}.downloading", model_file_name(model))
    }
}

/// Delete `.downloading` files in `dir` that no current model can resume
/// (retired models, older revisions). Resumable ones are kept: that is the
/// point of them. Returns the names removed.
pub fn remove_unresumable_temp_files(dir: &Path, models: &[&str]) -> Vec<String> {
    let keep: Vec<String> = models.iter().map(|m| temp_file_name(m)).collect();
    let mut removed = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return removed };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".downloading") && !keep.contains(&name) && std::fs::remove_file(entry.path()).is_ok() {
            removed.push(name);
        }
    }
    removed.sort();
    removed
}

/// Bytes available to this user on the volume holding `path`.
pub fn free_space(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
        let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        // SAFETY: `c_path` is a valid NUL-terminated string and `stat` is a
        // properly sized out-parameter that statvfs fills on success.
        let rc = unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) };
        if rc != 0 {
            return None;
        }
        // SAFETY: statvfs returned 0, so it initialised `stat`.
        let stat = unsafe { stat.assume_init() };
        Some((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

/// `Err` with the user-facing message when `free` cannot hold `needed` more
/// bytes plus the margin. Unknown free space passes.
pub fn check_free_space(needed: u64, free: Option<u64>) -> Result<(), String> {
    let Some(free) = free else { return Ok(()) };
    let required = needed.saturating_add(FREE_SPACE_MARGIN);
    if free < required {
        const MB: u64 = 1024 * 1024;
        return Err(format!(
            "Not enough free disk space: need {} MB, {} MB available",
            required.div_ceil(MB),
            free / MB
        ));
    }
    Ok(())
}

/// What the server's answer means for a download that already has `have`
/// bytes on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    /// Append the body to the partial file. `total` 0 = unknown.
    Append { total: u64 },
    /// Discard the partial file and write the body from the start.
    Restart { total: u64 },
    /// The partial file already holds everything.
    AlreadyComplete,
    /// The partial file cannot be continued; delete it and ask again without
    /// a range.
    DiscardAndRetry,
}

/// Parse `Content-Range: bytes <start>-<end>/<total>` or `bytes */<total>`.
/// Returns `(start, total)`; unknown parts are `None`.
pub fn parse_content_range(value: &str) -> (Option<u64>, Option<u64>) {
    let rest = value.trim().strip_prefix("bytes").map(str::trim).unwrap_or("");
    let (range, total) = match rest.split_once('/') {
        Some((r, t)) => (r.trim(), t.trim().parse::<u64>().ok()),
        None => (rest, None),
    };
    let start = range.split_once('-').and_then(|(s, _)| s.trim().parse::<u64>().ok());
    (start, total)
}

/// Decide how to use a response. `status` is the HTTP status, `have` the
/// size of the partial file that the request's `Range` asked to continue.
pub fn plan_for_response(
    status: u16,
    have: u64,
    content_range: Option<&str>,
    content_length: Option<u64>,
) -> Result<Plan, String> {
    let (start, range_total) = content_range.map(parse_content_range).unwrap_or((None, None));
    match status {
        206 => {
            if start == Some(have) {
                let total = range_total.or(content_length.map(|l| have + l)).unwrap_or(0);
                Ok(Plan::Append { total })
            } else {
                // A range we did not ask for: appending it would corrupt.
                Ok(Plan::DiscardAndRetry)
            }
        }
        // The server ignored the range and is sending the whole file.
        200 => Ok(Plan::Restart { total: content_length.unwrap_or(0) }),
        416 if have > 0 => {
            if range_total == Some(have) {
                Ok(Plan::AlreadyComplete)
            } else {
                Ok(Plan::DiscardAndRetry)
            }
        }
        other => Err(format!("Download failed with status: {other}")),
    }
}

pub struct DownloadSpec {
    pub url: String,
    pub final_path: PathBuf,
    pub temp_path: PathBuf,
    /// Size from the catalogue. Sizes the free-space check; enforced exactly
    /// only together with a hash (see [`MODEL_REVISION`]).
    pub catalogue_size: Option<u64>,
    /// Lowercase hex SHA-256 the finished file must have.
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct Tuning {
    /// Give up when no bytes arrive for this long.
    pub stall_timeout: Duration,
    /// How often the cancel flag and the stall clock are looked at.
    pub poll: Duration,
    /// Minimum time between progress callbacks.
    pub progress_interval: Duration,
}

impl Default for Tuning {
    fn default() -> Self {
        Self {
            stall_timeout: Duration::from_secs(30),
            poll: Duration::from_millis(200),
            progress_interval: Duration::from_millis(100),
        }
    }
}

fn stalled(timeout: Duration) -> String {
    format!("Download stalled: no data received for {} seconds", timeout.as_secs())
}

fn failed_verification(detail: &str) -> String {
    format!("Downloaded file failed verification ({detail}). It was removed; try again.")
}

/// Check a finished file. Blocking (reads the whole file when hashing).
pub fn verify_model_file(
    path: &Path,
    catalogue_size: Option<u64>,
    sha256: Option<&str>,
) -> Result<(), String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| format!("cannot open it: {e}"))?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut magic = [0u8; 4];
    if file.read_exact(&mut magic).is_err() || magic != GGML_MAGIC {
        return Err("not a Whisper model file".into());
    }
    let Some(expected) = sha256 else {
        if let Some(size) = catalogue_size {
            if size != len {
                // Not enforced without a hash: the catalogue number is the
                // only thing saying so. Recorded, so a real change is seen.
                log::warn!(
                    target: "notesage::transcription",
                    "{} is {len} bytes; the catalogue says {size}",
                    path.display()
                );
            }
        }
        return Ok(());
    };
    if let Some(size) = catalogue_size {
        if size != len {
            return Err(format!("size {len}, expected {size}"));
        }
    }
    let mut hasher = Sha256::new();
    hasher.update(magic);
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| format!("cannot read it: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if actual != expected.to_ascii_lowercase() {
        return Err("checksum mismatch".into());
    }
    Ok(())
}

/// Download `spec.url` to `spec.final_path`, continuing `spec.temp_path` if
/// it exists. `on_progress(downloaded, total)`; `total` is 0 when unknown.
///
/// On `Err` the partial file is kept, except when it failed verification.
/// The error for a cancel is exactly [`CANCELLED`]; the caller decides
/// whether to keep the partial file then.
pub async fn download_with_resume(
    client: &reqwest::Client,
    spec: &DownloadSpec,
    cancel: &AtomicBool,
    tuning: Tuning,
    on_progress: &mut (dyn FnMut(u64, u64) + Send),
) -> Result<u64, String> {
    let dir = spec.final_path.parent().unwrap_or_else(|| Path::new("."));
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| format!("Failed to create models directory: {e}"))?;

    let mut retried = false;
    let downloaded = loop {
        let mut have = tokio::fs::metadata(&spec.temp_path).await.map(|m| m.len()).unwrap_or(0);
        if let Some(size) = spec.catalogue_size {
            if spec.sha256.is_some() && have > size {
                let _ = tokio::fs::remove_file(&spec.temp_path).await;
                have = 0;
            }
        }
        let needed = spec.catalogue_size.unwrap_or(0).saturating_sub(have);
        check_free_space(needed, free_space(dir))?;

        let mut request = client.get(&spec.url);
        if have > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let response = wait_for(request.send(), cancel, tuning)
            .await?
            .map_err(|e| format!("Download failed: {e}"))?;

        let content_range = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let plan = plan_for_response(
            response.status().as_u16(),
            have,
            content_range.as_deref(),
            response.content_length(),
        )?;

        let (append, total) = match plan {
            Plan::AlreadyComplete => break have,
            Plan::DiscardAndRetry => {
                drop(response);
                let _ = tokio::fs::remove_file(&spec.temp_path).await;
                if retried {
                    return Err("Download failed: the server keeps refusing the request".into());
                }
                retried = true;
                continue;
            }
            Plan::Append { total } => (true, total),
            Plan::Restart { total } => (false, total),
        };
        let start = if append { have } else { 0 };
        if !append && have > 0 {
            check_free_space(spec.catalogue_size.unwrap_or(total), free_space(dir))?;
        }

        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&spec.temp_path)
            .await
            .map_err(|e| format!("Failed to create temp file: {e}"))?;
        let mut out = tokio::io::BufWriter::with_capacity(1024 * 1024, file);

        let mut downloaded = start;
        let mut stream = response.bytes_stream();
        let mut last_data = Instant::now();
        let mut last_progress: Option<Instant> = None;
        let mut ticker = tokio::time::interval(tuning.poll);
        on_progress(downloaded, total);

        let outcome: Result<(), String> = loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if cancel.load(Ordering::Relaxed) {
                        break Err(CANCELLED.to_string());
                    }
                    if last_data.elapsed() >= tuning.stall_timeout {
                        break Err(stalled(tuning.stall_timeout));
                    }
                }
                chunk = stream.next() => {
                    match chunk {
                        None => break Ok(()),
                        Some(Err(e)) => break Err(format!("Download error: {e}")),
                        Some(Ok(bytes)) => {
                            if let Err(e) = out.write_all(&bytes).await {
                                break Err(format!("Write error: {e}"));
                            }
                            downloaded += bytes.len() as u64;
                            last_data = Instant::now();
                            let due = last_progress
                                .map(|t| t.elapsed() >= tuning.progress_interval)
                                .unwrap_or(true);
                            if due {
                                last_progress = Some(Instant::now());
                                on_progress(downloaded, total);
                            }
                        }
                    }
                }
            }
        };
        // Whatever happened, what arrived is kept on disk for the next try.
        let flushed = out.flush().await.map_err(|e| format!("Write error: {e}"));
        let synced = out.get_ref().sync_all().await.map_err(|e| format!("Write error: {e}"));
        drop(out);
        outcome?;
        flushed?;
        synced?;
        on_progress(downloaded, total);

        if total > 0 && downloaded != total {
            return Err(format!(
                "Download incomplete: received {downloaded} of {total} bytes. Try again to continue."
            ));
        }
        break downloaded;
    };

    // Verify before the file gets the name the app loads models by.
    let temp = spec.temp_path.clone();
    let (size, sha) = (spec.catalogue_size, spec.sha256.clone());
    let verdict = tokio::task::spawn_blocking(move || verify_model_file(&temp, size, sha.as_deref()))
        .await
        .map_err(|e| format!("Verification task failed: {e}"))?;
    if let Err(detail) = verdict {
        let _ = tokio::fs::remove_file(&spec.temp_path).await;
        return Err(failed_verification(&detail));
    }

    tokio::fs::rename(&spec.temp_path, &spec.final_path)
        .await
        .map_err(|e| format!("Failed to finalize download: {e}"))?;
    Ok(downloaded)
}

/// Await `future`, giving up on cancel or when it takes longer than the
/// stall timeout (connecting and waiting for the response headers).
async fn wait_for<T>(
    future: impl std::future::Future<Output = T>,
    cancel: &AtomicBool,
    tuning: Tuning,
) -> Result<T, String> {
    tokio::pin!(future);
    let started = Instant::now();
    let mut ticker = tokio::time::interval(tuning.poll);
    loop {
        tokio::select! {
            value = &mut future => return Ok(value),
            _ = ticker.tick() => {
                if cancel.load(Ordering::Relaxed) {
                    return Err(CANCELLED.to_string());
                }
                if started.elapsed() >= tuning.stall_timeout {
                    return Err(stalled(tuning.stall_timeout));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex};

    // --- a small HTTP server ------------------------------------------------

    #[derive(Clone, Copy, PartialEq)]
    enum Mode {
        /// Honours `Range`.
        Normal,
        /// Ignores `Range`: always 200 with the whole body.
        IgnoreRange,
        /// Announces the whole body, sends this many bytes, closes.
        CutAfter(usize),
        /// Sends this many bytes, then goes silent with the socket open.
        StallAfter(usize),
        /// Any status with an empty body.
        Status(u16),
        /// Answers a range with one starting somewhere else.
        WrongRange,
    }

    struct Server {
        url: String,
        mode: Arc<Mutex<Mode>>,
        /// The `Range` header of each request, in order ("" when absent).
        ranges: Arc<Mutex<Vec<String>>>,
    }

    fn serve(body: Vec<u8>, mode: Mode) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/ggml-test.bin", listener.local_addr().unwrap());
        let mode = Arc::new(Mutex::new(mode));
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let (mode_t, ranges_t) = (mode.clone(), ranges.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (body, mode, ranges) = (body.clone(), *mode_t.lock().unwrap(), ranges_t.clone());
                std::thread::spawn(move || handle(stream, &body, mode, &ranges));
            }
        });
        Server { url, mode, ranges }
    }

    fn handle(mut stream: TcpStream, body: &[u8], mode: Mode, ranges: &Mutex<Vec<String>>) {
        let mut request = Vec::new();
        let mut byte = [0u8; 1];
        while !request.ends_with(b"\r\n\r\n") {
            match stream.read(&mut byte) {
                Ok(1) => request.push(byte[0]),
                _ => return,
            }
        }
        let request = String::from_utf8_lossy(&request).to_string();
        let range = request
            .lines()
            .find_map(|l| l.to_ascii_lowercase().strip_prefix("range:").map(|v| v.trim().to_string()))
            .unwrap_or_default();
        ranges.lock().unwrap().push(range.clone());
        let from = range
            .strip_prefix("bytes=")
            .and_then(|r| r.split('-').next())
            .and_then(|s| s.parse::<usize>().ok());
        let total = body.len();

        let head = |status: &str, extra: String, len: usize| {
            format!("HTTP/1.1 {status}\r\nContent-Length: {len}\r\nConnection: close\r\n{extra}\r\n")
        };
        match (mode, from) {
            (Mode::Status(code), _) => {
                let _ = stream.write_all(head(&format!("{code} Nope"), String::new(), 0).as_bytes());
            }
            (Mode::WrongRange, Some(_)) => {
                let extra = format!("Content-Range: bytes 0-{}/{total}\r\n", total - 1);
                let _ = stream.write_all(head("206 Partial Content", extra, total).as_bytes());
                let _ = stream.write_all(body);
            }
            (Mode::Normal, Some(from)) | (Mode::CutAfter(_), Some(from)) | (Mode::StallAfter(_), Some(from))
                if from >= total =>
            {
                let extra = format!("Content-Range: bytes */{total}\r\n");
                let _ = stream.write_all(head("416 Range Not Satisfiable", extra, 0).as_bytes());
            }
            (Mode::IgnoreRange, _) | (_, None) => {
                let _ = stream.write_all(head("200 OK", String::new(), total).as_bytes());
                send_body(&mut stream, body, mode);
            }
            (_, Some(from)) => {
                let extra = format!("Content-Range: bytes {from}-{}/{total}\r\n", total - 1);
                let _ = stream.write_all(head("206 Partial Content", extra, total - from).as_bytes());
                send_body(&mut stream, &body[from..], mode);
            }
        }
    }

    fn send_body(stream: &mut TcpStream, body: &[u8], mode: Mode) {
        match mode {
            Mode::CutAfter(n) => {
                let _ = stream.write_all(&body[..n.min(body.len())]);
            }
            Mode::StallAfter(n) => {
                let _ = stream.write_all(&body[..n.min(body.len())]);
                let _ = stream.flush();
                std::thread::sleep(Duration::from_secs(20));
            }
            _ => {
                let _ = stream.write_all(body);
            }
        }
    }

    // --- helpers --------------------------------------------------------------

    fn model_bytes(len: usize) -> Vec<u8> {
        let mut body: Vec<u8> = (0..len).map(|i| (i * 31 % 251) as u8).collect();
        body[..4].copy_from_slice(&GGML_MAGIC);
        body
    }

    fn sha_hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    fn client() -> reqwest::Client {
        // No proxy: the test server is on loopback.
        reqwest::Client::builder().no_proxy().build().unwrap()
    }

    fn quick() -> Tuning {
        Tuning {
            stall_timeout: Duration::from_millis(600),
            poll: Duration::from_millis(20),
            progress_interval: Duration::ZERO,
        }
    }

    fn spec(dir: &Path, url: &str, body: &[u8], with_hash: bool) -> DownloadSpec {
        DownloadSpec {
            url: url.to_string(),
            final_path: dir.join("ggml-test.bin"),
            temp_path: dir.join("ggml-test.bin.downloading"),
            catalogue_size: Some(body.len() as u64),
            sha256: with_hash.then(|| sha_hex(body)),
        }
    }

    async fn run(spec: &DownloadSpec, tuning: Tuning) -> (Result<u64, String>, Vec<(u64, u64)>) {
        let cancel = AtomicBool::new(false);
        let mut seen = Vec::new();
        let r = download_with_resume(&client(), spec, &cancel, tuning, &mut |d, t| seen.push((d, t))).await;
        (r, seen)
    }

    // --- tests ----------------------------------------------------------------

    #[tokio::test]
    async fn a_fresh_download_is_verified_and_renamed() {
        let body = model_bytes(300_000);
        let server = serve(body.clone(), Mode::Normal);
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path(), &server.url, &body, true);

        let (result, seen) = run(&spec, quick()).await;
        assert_eq!(result.unwrap(), 300_000);
        assert_eq!(std::fs::read(&spec.final_path).unwrap(), body);
        assert!(!spec.temp_path.exists());
        assert_eq!(*server.ranges.lock().unwrap(), vec![""], "a fresh download sends no Range");
        // Progress: total known from the start, ends complete, never falls.
        assert_eq!(seen.first(), Some(&(0, 300_000)));
        assert_eq!(seen.last(), Some(&(300_000, 300_000)));
        assert!(seen.windows(2).all(|w| w[0].0 <= w[1].0));
    }

    /// The connection dies part-way; the next attempt asks only for the rest.
    #[tokio::test]
    async fn an_interrupted_download_is_resumed_from_where_it_stopped() {
        let body = model_bytes(400_000);
        let server = serve(body.clone(), Mode::CutAfter(150_000));
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path(), &server.url, &body, true);

        let (first, _) = run(&spec, quick()).await;
        let err = first.unwrap_err();
        assert!(err.starts_with("Download") , "{err}");
        assert!(!spec.final_path.exists(), "an incomplete file must not get the final name");
        let kept = std::fs::metadata(&spec.temp_path).unwrap().len();
        assert!(kept > 0 && kept <= 150_000, "partial file holds {kept} bytes");
        assert_eq!(std::fs::read(&spec.temp_path).unwrap(), body[..kept as usize]);

        *server.mode.lock().unwrap() = Mode::Normal;
        let (second, seen) = run(&spec, quick()).await;
        assert_eq!(second.unwrap(), 400_000);
        assert_eq!(std::fs::read(&spec.final_path).unwrap(), body);
        assert_eq!(server.ranges.lock().unwrap().last().unwrap(), &format!("bytes={kept}-"));
        // Progress resumes at what was already there, with the full total.
        assert_eq!(seen.first(), Some(&(kept, 400_000)));
    }

    /// A partial file from a previous launch is picked up, not thrown away.
    #[tokio::test]
    async fn a_partial_file_left_by_an_earlier_launch_is_continued() {
        let body = model_bytes(200_000);
        let server = serve(body.clone(), Mode::Normal);
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path(), &server.url, &body, true);
        std::fs::write(&spec.temp_path, &body[..120_000]).unwrap();

        let (result, _) = run(&spec, quick()).await;
        assert_eq!(result.unwrap(), 200_000);
        assert_eq!(*server.ranges.lock().unwrap(), vec!["bytes=120000-"]);
        assert_eq!(std::fs::read(&spec.final_path).unwrap(), body);
    }

    #[tokio::test]
    async fn a_server_that_ignores_range_restarts_cleanly() {
        let body = model_bytes(100_000);
        let server = serve(body.clone(), Mode::IgnoreRange);
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path(), &server.url, &body, true);
        std::fs::write(&spec.temp_path, &body[..40_000]).unwrap();

        let (result, _) = run(&spec, quick()).await;
        assert_eq!(result.unwrap(), 100_000);
        assert_eq!(std::fs::read(&spec.final_path).unwrap(), body, "the body must not be appended twice");
    }

    #[tokio::test]
    async fn a_complete_partial_file_is_verified_without_downloading_again() {
        let body = model_bytes(50_000);
        let server = serve(body.clone(), Mode::Normal);
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path(), &server.url, &body, true);
        std::fs::write(&spec.temp_path, &body).unwrap();

        let (result, _) = run(&spec, quick()).await;
        assert_eq!(result.unwrap(), 50_000);
        assert_eq!(std::fs::read(&spec.final_path).unwrap(), body);
    }

    #[tokio::test]
    async fn a_range_answer_for_the_wrong_offset_is_not_appended() {
        let body = model_bytes(60_000);
        let server = serve(body.clone(), Mode::WrongRange);
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path(), &server.url, &body, true);
        std::fs::write(&spec.temp_path, &body[..10_000]).unwrap();

        let (result, _) = run(&spec, quick()).await;
        assert_eq!(result.unwrap(), 60_000);
        assert_eq!(std::fs::read(&spec.final_path).unwrap(), body);
        // First with a range, then (partial discarded) without.
        assert_eq!(*server.ranges.lock().unwrap(), vec!["bytes=10000-", ""]);
    }

    #[tokio::test]
    async fn a_wrong_checksum_is_rejected_and_removed() {
        let body = model_bytes(80_000);
        let server = serve(body.clone(), Mode::Normal);
        let dir = tempfile::tempdir().unwrap();
        let mut spec = spec(dir.path(), &server.url, &body, true);
        spec.sha256 = Some("00".repeat(32));

        let (result, _) = run(&spec, quick()).await;
        assert_eq!(
            result.unwrap_err(),
            "Downloaded file failed verification (checksum mismatch). It was removed; try again."
        );
        assert!(!spec.final_path.exists() && !spec.temp_path.exists());
    }

    #[tokio::test]
    async fn a_wrong_size_is_rejected_when_a_hash_pins_the_file() {
        let body = model_bytes(80_000);
        let server = serve(body.clone(), Mode::Normal);
        let dir = tempfile::tempdir().unwrap();
        let mut spec = spec(dir.path(), &server.url, &body, true);
        spec.catalogue_size = Some(80_001);

        let (result, _) = run(&spec, quick()).await;
        let err = result.unwrap_err();
        assert!(err.contains("size 80000, expected 80001"), "{err}");
        assert!(!spec.final_path.exists());
    }

    /// What a captive portal or an error page looks like: 200, but not a
    /// model. It must never be installed, hash or no hash.
    #[tokio::test]
    async fn something_that_is_not_a_model_is_rejected_even_without_a_hash() {
        let page = b"<html><body>Sign in to the hotel Wi-Fi</body></html>".to_vec();
        let server = serve(page.clone(), Mode::Normal);
        let dir = tempfile::tempdir().unwrap();
        let mut spec = spec(dir.path(), &server.url, &page, false);
        spec.catalogue_size = Some(574_041_195);

        let cancel = AtomicBool::new(false);
        // Free space is not the subject here; the check uses the real disk.
        let result = download_with_resume(&client(), &spec, &cancel, quick(), &mut |_, _| {}).await;
        if let Err(err) = &result {
            if err.starts_with("Not enough free disk space") {
                return;
            }
        }
        assert_eq!(
            result.unwrap_err(),
            "Downloaded file failed verification (not a Whisper model file). It was removed; try again."
        );
        assert!(!spec.final_path.exists() && !spec.temp_path.exists());
    }

    #[tokio::test]
    async fn without_a_hash_the_announced_length_and_the_magic_still_gate() {
        let body = model_bytes(70_000);
        let server = serve(body.clone(), Mode::Normal);
        let dir = tempfile::tempdir().unwrap();
        let mut spec = spec(dir.path(), &server.url, &body, false);
        // A catalogue size that is slightly off does not block (it is only a
        // number in the source; see MODEL_REVISION).
        spec.catalogue_size = Some(70_123);
        let (result, _) = run(&spec, quick()).await;
        assert_eq!(result.unwrap(), 70_000);
        assert_eq!(std::fs::read(&spec.final_path).unwrap(), body);
    }

    #[tokio::test]
    async fn a_stalled_connection_times_out_and_keeps_what_arrived() {
        let body = model_bytes(200_000);
        let server = serve(body.clone(), Mode::StallAfter(50_000));
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path(), &server.url, &body, true);

        let started = Instant::now();
        let (result, _) = run(&spec, quick()).await;
        assert_eq!(result.unwrap_err(), "Download stalled: no data received for 0 seconds");
        assert!(started.elapsed() < Duration::from_secs(8), "the stall was not noticed");
        let kept = std::fs::read(&spec.temp_path).unwrap();
        assert!(!kept.is_empty() && kept.len() <= 50_000);
        assert_eq!(kept, body[..kept.len()]);
        assert_eq!(stalled(Tuning::default().stall_timeout), "Download stalled: no data received for 30 seconds");
    }

    #[tokio::test]
    async fn cancel_interrupts_a_stalled_download() {
        let body = model_bytes(200_000);
        let server = serve(body.clone(), Mode::StallAfter(50_000));
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path(), &server.url, &body, true);
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            flag.store(true, Ordering::Relaxed);
        });
        let tuning = Tuning { stall_timeout: Duration::from_secs(15), ..quick() };
        let started = Instant::now();
        let result = download_with_resume(&client(), &spec, &cancel, tuning, &mut |_, _| {}).await;
        assert_eq!(result.unwrap_err(), "Download cancelled");
        assert!(started.elapsed() < Duration::from_secs(5), "cancel waited for the stalled read");
    }

    #[tokio::test]
    async fn an_error_status_is_reported_and_the_partial_file_kept() {
        let body = model_bytes(10_000);
        let server = serve(body.clone(), Mode::Status(503));
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path(), &server.url, &body, true);
        std::fs::write(&spec.temp_path, &body[..4_000]).unwrap();
        let (result, _) = run(&spec, quick()).await;
        assert_eq!(result.unwrap_err(), "Download failed with status: 503");
        assert_eq!(std::fs::metadata(&spec.temp_path).unwrap().len(), 4_000);
    }

    #[test]
    fn responses_are_planned_correctly() {
        use Plan::*;
        assert_eq!(plan_for_response(200, 0, None, Some(500)), Ok(Restart { total: 500 }));
        assert_eq!(plan_for_response(200, 0, None, None), Ok(Restart { total: 0 }));
        assert_eq!(plan_for_response(200, 300, None, Some(500)), Ok(Restart { total: 500 }));
        assert_eq!(
            plan_for_response(206, 300, Some("bytes 300-499/500"), Some(200)),
            Ok(Append { total: 500 })
        );
        // Total unknown in the header: derived from the remaining length.
        assert_eq!(plan_for_response(206, 300, Some("bytes 300-499/*"), Some(200)), Ok(Append { total: 500 }));
        assert_eq!(plan_for_response(206, 300, Some("bytes 0-499/500"), Some(500)), Ok(DiscardAndRetry));
        assert_eq!(plan_for_response(206, 300, None, Some(200)), Ok(DiscardAndRetry));
        assert_eq!(plan_for_response(416, 500, Some("bytes */500"), Some(0)), Ok(AlreadyComplete));
        assert_eq!(plan_for_response(416, 700, Some("bytes */500"), Some(0)), Ok(DiscardAndRetry));
        assert_eq!(plan_for_response(416, 0, None, None), Err("Download failed with status: 416".into()));
        assert_eq!(plan_for_response(404, 0, None, None), Err("Download failed with status: 404".into()));

        assert_eq!(parse_content_range("bytes 10-19/100"), (Some(10), Some(100)));
        assert_eq!(parse_content_range("bytes */100"), (None, Some(100)));
        assert_eq!(parse_content_range("bytes 10-19/*"), (Some(10), None));
        assert_eq!(parse_content_range("nonsense"), (None, None));
    }

    #[test]
    fn free_space_is_checked_with_a_margin() {
        const MB: u64 = 1024 * 1024;
        assert_eq!(check_free_space(500 * MB, Some(600 * MB)), Ok(()));
        assert_eq!(
            check_free_space(500 * MB, Some(520 * MB)),
            Err("Not enough free disk space: need 564 MB, 520 MB available".into())
        );
        // Nothing left to fetch still needs the margin, unknown space passes.
        assert!(check_free_space(0, Some(10 * MB)).is_err());
        assert_eq!(check_free_space(u64::MAX, None), Ok(()));
        // The real call answers on this platform's temp dir.
        if cfg!(unix) {
            assert!(free_space(&std::env::temp_dir()).unwrap() > 0);
        }
        assert_eq!(free_space(Path::new("/definitely/not/a/real/path")), None);
    }

    #[test]
    fn only_temp_files_nothing_can_resume_are_removed_at_startup() {
        let dir = tempfile::tempdir().unwrap();
        let keep = temp_file_name("small");
        for name in [keep.as_str(), "ggml-medium.bin.downloading", "ggml-small.bin.abc.downloading", "ggml-small.bin"] {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        let removed = remove_unresumable_temp_files(dir.path(), &["small", "large-v3-turbo-q5_0"]);
        assert_eq!(removed, vec!["ggml-medium.bin.downloading", "ggml-small.bin.abc.downloading"]);
        assert!(dir.path().join(&keep).exists(), "a resumable partial download must survive a restart");
        assert!(dir.path().join("ggml-small.bin").exists());
    }

    #[test]
    fn urls_and_names_follow_the_revision() {
        assert_eq!(
            model_url("small"),
            format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/{MODEL_REVISION}/ggml-small.bin")
        );
        assert_eq!(model_file_name("large-v3-turbo-q5_0"), "ggml-large-v3-turbo-q5_0.bin");
        assert!(temp_file_name("small").starts_with("ggml-small.bin."));
        assert!(temp_file_name("small").ends_with(".downloading"));
    }

    #[test]
    fn verification_reads_the_file_itself() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("good.bin");
        let body = model_bytes(3_000_000); // more than one hashing block
        std::fs::write(&good, &body).unwrap();
        assert_eq!(verify_model_file(&good, Some(3_000_000), Some(&sha_hex(&body))), Ok(()));
        assert_eq!(verify_model_file(&good, Some(3_000_000), Some(&sha_hex(&body).to_uppercase())), Ok(()));
        assert_eq!(verify_model_file(&good, None, None), Ok(()));
        assert_eq!(
            verify_model_file(&good, Some(3_000_000), Some(&"ab".repeat(32))),
            Err("checksum mismatch".into())
        );
        let short = dir.path().join("short.bin");
        std::fs::write(&short, b"lm").unwrap();
        assert_eq!(verify_model_file(&short, None, None), Err("not a Whisper model file".into()));
        assert!(verify_model_file(&dir.path().join("none.bin"), None, None).is_err());
    }
}
