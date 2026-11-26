//! Import a video or audio file as a recording: extract its audio into a new
//! bundle in the library's Recordings folder. The original is not copied (a
//! meeting video can be gigabytes); only its sound is kept.
//!
//! The audio is produced in a local staging folder and moved into the library
//! when complete, so iCloud never sees a half-written file and a failed or
//! cancelled import leaves nothing behind.
//!
//! Output: on macOS `audio.m4a` (AAC, mono, 64 kbit/s, about 29 MB per hour)
//! made by the system's `afconvert`, which reads the source directly and is
//! verified afterwards. Everywhere else, and whenever that fails, a 16 kHz
//! mono `audio.wav` (115 MB per hour) decoded by the same streaming decoder
//! transcription uses.

use super::local_file::{ensure_local, EnsureError, FileProbe, DOWNLOAD_POLL};
use super::resample::TARGET_RATE;
use crate::commands::audio_decode::{decode_stream_16k, probe_audio, NO_AUDIO_TRACK};
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// The rejection for an import the user cancelled. The frontend matches it.
pub const IMPORT_CANCELLED: &str = "Import cancelled";

/// The system encoder used on macOS.
pub const AFCONVERT: &str = "/usr/bin/afconvert";

/// Bitrate of the AAC `afconvert` writes, in bits per second.
const AAC_BITRATE: u32 = 64_000;
/// Longest stem kept from the original file name.
const MAX_STEM_CHARS: usize = 80;
/// Staging folders older than this are leftovers from a crash.
const STALE_STAGING: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ImportResult {
    pub bundle_dir: String,
    pub audio_path: String,
    pub duration_secs: f64,
    /// The source's file name, with extension.
    pub original_name: String,
}

/// Where imports are staged: local, never in iCloud.
pub fn default_staging_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".notesage")
        .join("import-staging")
}

/// `afconvert`, when this system has it.
pub fn system_afconvert() -> Option<PathBuf> {
    if cfg!(target_os = "macos") && Path::new(AFCONVERT).exists() {
        Some(PathBuf::from(AFCONVERT))
    } else {
        None
    }
}

/// A file stem made safe as part of a folder name on macOS, iCloud and
/// Windows: no separators, no control characters, no leading dot.
pub fn sanitise_stem(stem: &str) -> String {
    let mut out = String::with_capacity(stem.len());
    let mut last_space = true;
    for c in stem.chars() {
        let c = match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        };
        if c.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
        } else {
            out.push(c);
            last_space = false;
        }
    }
    let trimmed = out.trim_matches(|c: char| c == ' ' || c == '.');
    let short: String = trimmed.chars().take(MAX_STEM_CHARS).collect();
    let short = short.trim_end_matches(|c: char| c == ' ' || c == '.');
    if short.is_empty() {
        "Media".to_string()
    } else {
        short.to_string()
    }
}

/// `Import <stem> <YYYY-MM-DD HHMMSS>`.
pub fn bundle_name(source: &Path, stamp: &str) -> String {
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    format!("Import {} {}", sanitise_stem(stem), stamp)
}

/// The timestamp part of a bundle name, local time.
pub fn now_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H%M%S").to_string()
}

/// `dir/name`, or `dir/name 2`, `dir/name 3`… when taken.
pub fn free_bundle_dir(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{name} {n}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

fn restrict(path: &Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
    }
}

/// Create a directory only its owner can enter.
fn create_private_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir(path)?;
    restrict(path, 0o700);
    Ok(())
}

// ---------------------------------------------------------------------------
// 16 kHz mono WAV, written as it arrives
// ---------------------------------------------------------------------------

/// Streaming writer for 16-bit PCM, 16 kHz, mono. The sizes in the header are
/// filled in by `finalize`.
pub struct Wav16Writer {
    out: BufWriter<std::fs::File>,
    samples: u64,
}

impl Wav16Writer {
    pub fn create(path: &Path) -> Result<Self, String> {
        let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
        restrict(path, 0o600);
        let mut out = BufWriter::with_capacity(256 * 1024, file);
        out.write_all(&wav16_header(0)).map_err(|e| e.to_string())?;
        Ok(Self { out, samples: 0 })
    }

    pub fn write(&mut self, samples: &[f32]) -> Result<(), String> {
        for s in samples {
            let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            self.out.write_all(&v.to_le_bytes()).map_err(|e| e.to_string())?;
        }
        self.samples += samples.len() as u64;
        Ok(())
    }

    /// Patch the header and flush. Returns the duration in seconds.
    pub fn finalize(mut self) -> Result<f64, String> {
        let data_bytes = self.samples * 2;
        let data_bytes = u32::try_from(data_bytes)
            .ok()
            .filter(|b| *b <= u32::MAX - 36)
            .ok_or("The audio is too long for a WAV file")?;
        self.out.flush().map_err(|e| e.to_string())?;
        let mut file = self.out.into_inner().map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        file.write_all(&wav16_header(data_bytes)).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        Ok(self.samples as f64 / TARGET_RATE as f64)
    }
}

fn wav16_header(data_bytes: u32) -> [u8; 44] {
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_bytes).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&1u16.to_le_bytes()); // mono
    h[24..28].copy_from_slice(&TARGET_RATE.to_le_bytes());
    h[28..32].copy_from_slice(&(TARGET_RATE * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    h
}

/// Decode `source` into a 16 kHz mono WAV at `out`. Returns its duration.
fn extract_to_wav(
    source: &Path,
    out: &Path,
    cancel: &AtomicBool,
    on_fraction: &mut dyn FnMut(f64),
) -> Result<f64, String> {
    let mut writer = Wav16Writer::create(out).map_err(|e| format!("Cannot write the audio file: {e}"))?;
    decode_stream_16k(source, &mut |samples, fraction| {
        if cancel.load(Ordering::Relaxed) {
            return Err(IMPORT_CANCELLED.to_string());
        }
        writer.write(samples).map_err(|e| format!("Cannot write the audio file: {e}"))?;
        on_fraction(fraction);
        Ok(())
    })?;
    writer.finalize().map_err(|e| format!("Cannot write the audio file: {e}"))
}

// ---------------------------------------------------------------------------
// afconvert
// ---------------------------------------------------------------------------

/// Arguments for encoding `source` to mono AAC in an `.m4a`. `mix` asks for
/// a proper downmix of multi-channel sources (without it extra channels are
/// dropped rather than mixed).
pub fn afconvert_args(source: &Path, out: &Path, mix: bool) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> =
        ["-f", "m4af", "-d", "aac", "-b"].iter().map(|s| s.into()).collect();
    args.push(AAC_BITRATE.to_string().into());
    args.push("-c".into());
    args.push("1".into());
    if mix {
        args.push("--mix".into());
    }
    args.push(source.into());
    args.push(out.into());
    args
}

enum Encode {
    Done,
    Cancelled,
    Failed(String),
}

/// Run the encoder to completion, killing it (only it) on cancel.
fn run_encoder(
    program: &Path,
    args: &[std::ffi::OsString],
    out: &Path,
    expected_secs: Option<f64>,
    cancel: &AtomicBool,
    on_fraction: &mut dyn FnMut(f64),
) -> Encode {
    let mut child = match std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return Encode::Failed(format!("could not start the encoder: {e}")),
    };
    let expected_bytes = expected_secs.map(|s| (s * AAC_BITRATE as f64 / 8.0).max(1.0));
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Encode::Done,
            Ok(Some(status)) => return Encode::Failed(format!("the encoder exited with {status}")),
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Encode::Failed(format!("lost track of the encoder: {e}"));
            }
        }
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Encode::Cancelled;
        }
        if let Some(expected) = expected_bytes {
            let written = std::fs::metadata(out).map(|m| m.len()).unwrap_or(0) as f64;
            on_fraction((written / expected).min(1.0));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Check an encoded file really holds the audio: it must open, have a
/// duration, and not be shorter than the source when that is known. Returns
/// the duration.
pub fn verify_encoded(path: &Path, expected_secs: Option<f64>) -> Result<f64, String> {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        return Err("the encoder wrote nothing".into());
    }
    let probe = probe_audio(path).map_err(|e| format!("the encoded file does not open: {e}"))?;
    let secs = probe
        .duration_secs
        .filter(|s| *s > 0.0)
        .ok_or("the encoded file has no duration")?;
    if let Some(expected) = expected_secs {
        // Only SHORTER is a failure: that is audio lost. A container can
        // understate its own length (fragmented MP4 reports the first
        // fragment), and then a longer result is the correct one.
        let tolerance = (expected * 0.02).max(2.0);
        if secs + tolerance < expected {
            return Err(format!("the encoded file is {secs:.1}s long, the source {expected:.1}s"));
        }
    }
    Ok(secs)
}

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

/// Everything `import_media` needs from outside, so tests can stand in for
/// the encoder, the clock and iCloud.
pub struct ImportEnv<'a> {
    pub staging_root: &'a Path,
    /// The AAC encoder to try first; `None` goes straight to WAV.
    pub encoder: Option<&'a Path>,
    pub probe: &'a dyn FileProbe,
    /// Timestamp for the bundle name.
    pub stamp: String,
    pub download_timeout: Duration,
}

fn display_name(source: &Path) -> String {
    source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| source.display().to_string())
}

fn remove_stale_staging(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|age| age > STALE_STAGING)
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Move `from` to `to`: a rename when both are on one volume, otherwise a
/// copy that is checked before the original is removed.
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    let copied = std::fs::copy(from, to)?;
    let expected = std::fs::metadata(from)?.len();
    if copied != expected || std::fs::metadata(to)?.len() != expected {
        let _ = std::fs::remove_file(to);
        return Err(std::io::Error::other("the copy is incomplete"));
    }
    let _ = std::fs::remove_file(from);
    Ok(())
}

/// Blocking: call from a blocking task. `on_percent` receives 0..=100,
/// rising, each value once.
pub fn import_media_blocking(
    source: &Path,
    dest_recordings_dir: &Path,
    env: &ImportEnv<'_>,
    cancel: &AtomicBool,
    on_percent: &mut dyn FnMut(u8),
) -> Result<ImportResult, String> {
    let name = display_name(source);
    let mut last_percent: Option<u8> = None;
    let mut report = |percent: u8| {
        let percent = percent.min(100).max(last_percent.unwrap_or(0));
        if last_percent != Some(percent) {
            last_percent = Some(percent);
            on_percent(percent);
        }
    };
    report(0);

    // The path is handed to an external program as an argument; an absolute
    // path can never be mistaken for one of its options.
    if !source.is_absolute() {
        return Err(format!("Source file not found: {} (the path must be absolute)", source.display()));
    }

    // 1. The source: there, and on this machine.
    match ensure_local(env.probe, source, env.download_timeout, DOWNLOAD_POLL, cancel) {
        Ok(()) => {}
        Err(EnsureError::Missing) => return Err(format!("Source file not found: {}", source.display())),
        Err(EnsureError::Cancelled) => return Err(IMPORT_CANCELLED.to_string()),
        Err(EnsureError::Download(detail)) => {
            return Err(format!("The file is still in iCloud and could not be downloaded: {detail}"))
        }
    }
    if !source.is_file() {
        return Err(format!("Source file not found: {}", source.display()));
    }

    // 2. Does it have audio we can get at? Decided before anything is created.
    let expected_secs = match probe_audio(source) {
        Ok(probe) => probe.duration_secs,
        Err(e) if e.contains(NO_AUDIO_TRACK) => return Err(format!("No audio track found in {name}")),
        Err(e) if e.starts_with("Cannot read") => return Err(e),
        // Not readable by the built-in decoder. The system encoder (and the
        // CoreAudio fallback behind the WAV path) may still read it.
        Err(e) if env.encoder.is_some() || cfg!(target_os = "macos") => {
            log::info!(target: "notesage::transcription", "import: built-in decoder declined {name}: {e}");
            None
        }
        Err(e) => return Err(format!("Unsupported media format: {name} ({e})")),
    };

    // 3. The destination must be writable before minutes are spent extracting.
    std::fs::create_dir_all(dest_recordings_dir)
        .map_err(|e| format!("Cannot write to {}: {e}", dest_recordings_dir.display()))?;

    // 4. Extract into local staging.
    std::fs::create_dir_all(env.staging_root)
        .map_err(|e| format!("Cannot write to {}: {e}", env.staging_root.display()))?;
    restrict(env.staging_root, 0o700);
    remove_stale_staging(env.staging_root);
    let staging = env.staging_root.join(uuid::Uuid::new_v4().to_string());
    create_private_dir(&staging).map_err(|e| format!("Cannot write to {}: {e}", staging.display()))?;

    let extracted = extract(source, &name, &staging, expected_secs, env, cancel, &mut report);

    // 5. Move the finished audio into a new bundle in the library.
    let result = extracted.and_then(|(audio, duration_secs)| {
        if cancel.load(Ordering::Relaxed) {
            return Err(IMPORT_CANCELLED.to_string());
        }
        let bundle = free_bundle_dir(dest_recordings_dir, &bundle_name(source, &env.stamp));
        create_private_dir(&bundle)
            .map_err(|e| format!("Cannot write to {}: {e}", dest_recordings_dir.display()))?;
        let file_name = audio.file_name().unwrap_or_default().to_os_string();
        let final_audio = bundle.join(&file_name);
        if let Err(e) = move_file(&audio, &final_audio) {
            let _ = std::fs::remove_dir_all(&bundle);
            return Err(format!("Cannot write to {}: {e}", dest_recordings_dir.display()));
        }
        restrict(&final_audio, 0o600);
        Ok(ImportResult {
            bundle_dir: bundle.to_string_lossy().to_string(),
            audio_path: final_audio.to_string_lossy().to_string(),
            duration_secs,
            original_name: name.clone(),
        })
    });

    let _ = std::fs::remove_dir_all(&staging);
    if result.is_ok() {
        report(100);
    }
    result
}

/// Produce `audio.m4a` or `audio.wav` in `staging`. Returns its path and
/// duration.
fn extract(
    source: &Path,
    name: &str,
    staging: &Path,
    expected_secs: Option<f64>,
    env: &ImportEnv<'_>,
    cancel: &AtomicBool,
    report: &mut dyn FnMut(u8),
) -> Result<(PathBuf, f64), String> {
    // Extraction is 0..95; the move into the library is the rest.
    let mut on_fraction = |f: f64| report((f.clamp(0.0, 1.0) * 95.0) as u8);

    if let Some(encoder) = env.encoder {
        let m4a = staging.join("audio.m4a");
        let started = Instant::now();
        // With downmixing first; an encoder that does not know the option
        // fails at once and is asked again without it.
        for mix in [true, false] {
            let _ = std::fs::remove_file(&m4a);
            let args = afconvert_args(source, &m4a, mix);
            match run_encoder(encoder, &args, &m4a, expected_secs, cancel, &mut on_fraction) {
                Encode::Cancelled => return Err(IMPORT_CANCELLED.to_string()),
                Encode::Done => match verify_encoded(&m4a, expected_secs) {
                    Ok(duration_secs) => {
                        restrict(&m4a, 0o600);
                        log::info!(
                            target: "notesage::transcription",
                            "import: encoded {name} to AAC in {:.1}s ({duration_secs:.0}s of audio)",
                            started.elapsed().as_secs_f64()
                        );
                        return Ok((m4a, duration_secs));
                    }
                    Err(e) => {
                        log::warn!(target: "notesage::transcription", "import: AAC of {name} rejected: {e}");
                        break;
                    }
                },
                Encode::Failed(e) => {
                    log::warn!(target: "notesage::transcription", "import: encoding {name} failed (mix={mix}): {e}");
                }
            }
        }
        let _ = std::fs::remove_file(&m4a);
    }

    let wav = staging.join("audio.wav");
    match extract_to_wav(source, &wav, cancel, &mut on_fraction) {
        Ok(duration_secs) => Ok((wav, duration_secs)),
        Err(e) if e == IMPORT_CANCELLED => Err(e),
        Err(e) if e.contains(NO_AUDIO_TRACK) => Err(format!("No audio track found in {name}")),
        Err(e) if e.starts_with("Cannot write") || e.starts_with("Cannot read") => Err(e),
        Err(e) => Err(format!("Unsupported media format: {name} ({e})")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::audio_decode::decode_audio_f32;
    use crate::commands::transcribe::local_file::{Meta, RealProbe};

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio").join(name)
    }

    struct Dirs {
        _tmp: tempfile::TempDir,
        staging: PathBuf,
        dest: PathBuf,
        work: PathBuf,
    }

    fn dirs() -> Dirs {
        let tmp = tempfile::tempdir().unwrap();
        let staging = tmp.path().join("staging");
        let dest = tmp.path().join("Library").join("Recordings");
        let work = tmp.path().join("work");
        std::fs::create_dir_all(&work).unwrap();
        Dirs { _tmp: tmp, staging, dest, work }
    }

    fn env<'a>(d: &'a Dirs, encoder: Option<&'a Path>) -> ImportEnv<'a> {
        ImportEnv {
            staging_root: &d.staging,
            encoder,
            probe: &RealProbe,
            stamp: "2026-11-25 141500".to_string(),
            download_timeout: Duration::from_secs(1),
        }
    }

    fn run(source: &Path, d: &Dirs, encoder: Option<&Path>) -> (Result<ImportResult, String>, Vec<u8>) {
        let mut percents = Vec::new();
        let cancel = AtomicBool::new(false);
        let r = import_media_blocking(source, &d.dest, &env(d, encoder), &cancel, &mut |p| percents.push(p));
        (r, percents)
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect())
            .unwrap_or_default();
        names.sort();
        names
    }

    #[cfg(unix)]
    fn script(d: &Dirs, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = d.work.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn names_are_sanitised_and_stamped() {
        assert_eq!(sanitise_stem("Weekly sync: Q4/plan"), "Weekly sync Q4 plan");
        assert_eq!(sanitise_stem("  ..hidden.. "), "hidden");
        assert_eq!(sanitise_stem("a\tb\nc"), "a b c");
        assert_eq!(sanitise_stem("Möte med Åsa (2)"), "Möte med Åsa (2)");
        assert_eq!(sanitise_stem("???"), "Media");
        assert_eq!(sanitise_stem(""), "Media");
        assert_eq!(sanitise_stem(&"x".repeat(300)).chars().count(), MAX_STEM_CHARS);

        assert_eq!(
            bundle_name(Path::new("/Users/p/Downloads/Team meeting-20261124_100233-Meeting Recording.mp4"), "2026-11-25 141500"),
            "Import Team meeting-20261124_100233-Meeting Recording 2026-11-25 141500"
        );
        assert_eq!(bundle_name(Path::new("/x/.mp4"), "S"), "Import mp4 S");
        // The stamp has the shape the contract gives.
        let stamp = now_stamp();
        assert_eq!(stamp.len(), 17, "{stamp}");
        assert_eq!(stamp.as_bytes()[10], b' ');
    }

    #[test]
    fn a_taken_bundle_name_gets_a_number() {
        let d = dirs();
        std::fs::create_dir_all(d.dest.join("Import a S")).unwrap();
        assert_eq!(free_bundle_dir(&d.dest, "Import a S"), d.dest.join("Import a S 2"));
        std::fs::create_dir_all(d.dest.join("Import a S 2")).unwrap();
        assert_eq!(free_bundle_dir(&d.dest, "Import a S"), d.dest.join("Import a S 3"));
        assert_eq!(free_bundle_dir(&d.dest, "Import b S"), d.dest.join("Import b S"));
    }

    /// Without an encoder (any non-macOS system): 16 kHz mono WAV.
    #[test]
    fn an_m4a_becomes_a_16k_mono_wav_bundle() {
        let d = dirs();
        let source = d.work.join("Standup 48k.m4a");
        std::fs::copy(fixture("tone-phone-48k-mono-64k.m4a"), &source).unwrap();

        let (result, percents) = run(&source, &d, None);
        let result = result.expect("import");

        let bundle = d.dest.join("Import Standup 48k 2026-11-25 141500");
        assert_eq!(result.bundle_dir, bundle.to_string_lossy());
        assert_eq!(result.audio_path, bundle.join("audio.wav").to_string_lossy());
        assert_eq!(result.original_name, "Standup 48k.m4a");
        assert!((result.duration_secs - 0.4).abs() < 0.1, "duration {}", result.duration_secs);
        // The bundle holds the audio and nothing else: not the source.
        assert_eq!(entries(&bundle), vec!["audio.wav"]);
        assert!(source.exists(), "the original must be left where it was");

        let audio = decode_audio_f32(&bundle.join("audio.wav")).expect("the wav must decode");
        assert_eq!((audio.sample_rate, audio.channels), (16_000, 1));
        assert!((audio.samples.len() as f64 / 16_000.0 - result.duration_secs).abs() < 1e-6);
        let peak = audio.samples.iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((0.2..0.6).contains(&peak), "peak {peak}");

        // Progress: starts at 0, ends at 100, never repeats or falls.
        assert_eq!(percents.first(), Some(&0));
        assert_eq!(percents.last(), Some(&100));
        assert!(percents.windows(2).all(|w| w[0] < w[1]), "{percents:?}");
        // Staging is cleaned up.
        assert!(entries(&d.staging).is_empty());
    }

    /// What a Teams or Zoom recording is: H.264 video with 48 kHz stereo AAC
    /// in an MP4. Only the sound ends up in the bundle.
    #[test]
    fn the_audio_of_a_meeting_video_is_extracted_and_the_video_left_behind() {
        let d = dirs();
        let source = d.work.join("Weekly sync-20261124_100233-Meeting Recording.mp4");
        std::fs::copy(fixture("meeting-video-aac-48k-stereo.mp4"), &source).unwrap();
        let source_bytes = std::fs::metadata(&source).unwrap().len();

        let (result, percents) = run(&source, &d, None);
        let result = result.expect("import of a video");
        assert!(
            result.bundle_dir.ends_with("Import Weekly sync-20261124_100233-Meeting Recording 2026-11-25 141500"),
            "{}",
            result.bundle_dir
        );
        assert_eq!(result.original_name, "Weekly sync-20261124_100233-Meeting Recording.mp4");
        assert!((result.duration_secs - 2.0).abs() < 0.1, "duration {}", result.duration_secs);
        assert_eq!(entries(Path::new(&result.bundle_dir)), vec!["audio.wav"]);
        assert_eq!(std::fs::metadata(&source).unwrap().len(), source_bytes);

        let audio = decode_audio_f32(Path::new(&result.audio_path)).unwrap();
        assert_eq!((audio.sample_rate, audio.channels), (16_000, 1));
        let peak = audio.samples.iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((0.3..0.7).contains(&peak), "peak {peak}");
        assert_eq!(percents.last(), Some(&100));
    }

    /// A screen recording with no sound: said plainly, and nothing created.
    #[test]
    fn a_video_without_sound_is_refused_and_creates_nothing() {
        let d = dirs();
        let (result, _) = run(&fixture("video-without-audio.mp4"), &d, None);
        assert_eq!(result.unwrap_err(), "No audio track found in video-without-audio.mp4");
        assert!(!d.dest.exists(), "not even the Recordings folder");
        assert!(!d.staging.exists());
    }

    /// WebM/Opus is not something the built-in decoder reads. Off macOS that
    /// is the end of it; on macOS the system decoders get to try.
    #[test]
    fn webm_opus_is_reported_as_unsupported_where_nothing_can_read_it() {
        let d = dirs();
        let (result, _) = run(&fixture("tone-opus.webm"), &d, None);
        if !cfg!(target_os = "macos") {
            let err = result.unwrap_err();
            assert!(err.starts_with("Unsupported media format: tone-opus.webm ("), "{err}");
            assert!(!d.dest.exists());
        }
        assert!(entries(&d.staging).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn the_bundle_and_its_audio_are_private_to_the_owner() {
        use std::os::unix::fs::PermissionsExt;
        let d = dirs();
        let (result, _) = run(&fixture("tone.wav"), &d, None);
        let result = result.unwrap();
        let mode = |p: &str| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&result.bundle_dir), 0o700);
        assert_eq!(mode(&result.audio_path), 0o600);
    }

    #[test]
    fn two_imports_of_the_same_file_in_one_second_do_not_collide() {
        let d = dirs();
        let a = run(&fixture("tone.wav"), &d, None).0.unwrap();
        let b = run(&fixture("tone.wav"), &d, None).0.unwrap();
        assert_ne!(a.bundle_dir, b.bundle_dir);
        assert!(b.bundle_dir.ends_with("Import tone 2026-11-25 141500 2"));
        assert!(Path::new(&a.audio_path).exists() && Path::new(&b.audio_path).exists());
    }

    #[test]
    fn a_file_that_is_not_media_fails_clearly_and_creates_nothing() {
        let d = dirs();
        let source = d.work.join("notes.mp4");
        std::fs::write(&source, b"this is not a video, it is prose about one").unwrap();
        let (result, _) = run(&source, &d, None);
        let err = result.unwrap_err();
        // On macOS the system decoders get a try first, so the wording is
        // checked where the outcome is certain.
        if !cfg!(target_os = "macos") {
            assert!(err.starts_with("Unsupported media format: notes.mp4 ("), "{err}");
            assert!(!d.dest.exists(), "nothing may be created for an unsupported file");
        }
        assert!(entries(&d.dest).is_empty());
        assert!(entries(&d.staging).is_empty());
    }

    #[test]
    fn a_missing_source_is_reported_as_such() {
        let d = dirs();
        let (result, _) = run(&d.work.join("gone.mp4"), &d, None);
        assert!(result.unwrap_err().starts_with("Source file not found: "));
        assert!(!d.dest.exists());
        // A relative path (which an encoder could read as an option) is
        // refused before anything looks at it.
        let (result, _) = run(Path::new("-relative.mp4"), &d, None);
        assert!(result.unwrap_err().starts_with("Source file not found: -relative.mp4"));
    }

    #[test]
    fn an_evicted_source_that_never_arrives_says_so() {
        struct Evicted;
        impl FileProbe for Evicted {
            fn meta(&self, _p: &Path) -> Option<Meta> {
                Some(Meta { is_file: true, size: 10, dataless: true })
            }
            fn placeholder_exists(&self, _p: &Path) -> bool {
                false
            }
            fn request_download(&self, _p: &Path) -> Result<(), String> {
                Ok(())
            }
            fn sleep(&self, _d: Duration) {}
        }
        let d = dirs();
        let mut e = env(&d, None);
        e.probe = &Evicted;
        let cancel = AtomicBool::new(false);
        let err = import_media_blocking(&fixture("tone.wav"), &d.dest, &e, &cancel, &mut |_| {}).unwrap_err();
        assert!(
            err.starts_with("The file is still in iCloud and could not be downloaded: "),
            "{err}"
        );
        assert!(!d.dest.exists());
    }

    #[cfg(unix)]
    #[test]
    fn an_unwritable_destination_is_reported_before_extracting() {
        let d = dirs();
        // A FILE where the Recordings folder should be.
        std::fs::create_dir_all(d.dest.parent().unwrap()).unwrap();
        std::fs::write(&d.dest, b"in the way").unwrap();
        let (result, _) = run(&fixture("tone.wav"), &d, None);
        let err = result.unwrap_err();
        assert!(err.starts_with(&format!("Cannot write to {}", d.dest.display())), "{err}");
        assert!(!d.staging.exists(), "extraction must not have started");
    }

    #[test]
    fn a_cancel_stops_the_import_and_leaves_nothing() {
        let d = dirs();
        let cancel = AtomicBool::new(true);
        let err = import_media_blocking(&fixture("tone.wav"), &d.dest, &env(&d, None), &cancel, &mut |_| {})
            .unwrap_err();
        assert_eq!(err, "Import cancelled");
        assert!(entries(&d.dest).is_empty());
        assert!(entries(&d.staging).is_empty());
    }

    #[test]
    fn the_wav_writer_round_trips() {
        let d = dirs();
        let path = d.work.join("out.wav");
        let input: Vec<f32> = (0..16_000).map(|i| (i as f32 * 0.01).sin() * 0.5).collect();
        let mut w = Wav16Writer::create(&path).unwrap();
        w.write(&input[..5000]).unwrap();
        w.write(&input[5000..]).unwrap();
        w.write(&[2.0, -2.0]).unwrap(); // clamped, not wrapped
        assert_eq!(w.finalize().unwrap(), 16_002.0 / 16_000.0);

        assert_eq!(std::fs::metadata(&path).unwrap().len(), 44 + 16_002 * 2);
        let back = decode_audio_f32(&path).unwrap();
        assert_eq!((back.sample_rate, back.channels, back.samples.len()), (16_000, 1, 16_002));
        for (a, b) in input.iter().zip(back.samples.iter()) {
            assert!((a - b).abs() < 1e-3);
        }
        assert!(back.samples[16_000] > 0.99 && back.samples[16_001] < -0.99);
    }

    #[test]
    fn the_encoder_is_asked_for_mono_aac_from_the_source_itself() {
        let args = afconvert_args(Path::new("/in/meeting.mp4"), Path::new("/out/audio.m4a"), true);
        let args: Vec<String> = args.iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(
            args,
            ["-f", "m4af", "-d", "aac", "-b", "64000", "-c", "1", "--mix", "/in/meeting.mp4", "/out/audio.m4a"]
        );
        let plain = afconvert_args(Path::new("a"), Path::new("b"), false);
        assert!(!plain.iter().any(|a| a == "--mix"));
    }

    #[test]
    fn an_encoded_file_is_only_accepted_when_it_matches_the_source() {
        let m4a = fixture("tone.m4a");
        let secs = verify_encoded(&m4a, Some(0.4)).expect("matches");
        assert!((secs - 0.4).abs() < 0.2);
        assert!(verify_encoded(&m4a, None).is_ok());
        // The encoder "succeeded" but dropped most of an hour.
        let err = verify_encoded(&m4a, Some(3600.0)).unwrap_err();
        assert!(err.contains("the source 3600.0s"), "{err}");
        // A source that understated its length is no reason to reject.
        assert!(verify_encoded(&fixture("meeting-video-aac-48k-stereo.mp4"), Some(0.1)).is_ok());

        let d = dirs();
        let empty = d.work.join("empty.m4a");
        std::fs::write(&empty, b"").unwrap();
        assert_eq!(verify_encoded(&empty, None).unwrap_err(), "the encoder wrote nothing");
        let junk = d.work.join("junk.m4a");
        std::fs::write(&junk, b"not an m4a at all, just bytes").unwrap();
        assert!(verify_encoded(&junk, None).unwrap_err().starts_with("the encoded file does not open"));
    }

    /// The macOS path, with a stand-in encoder that writes a real AAC file.
    #[cfg(unix)]
    #[test]
    fn with_an_encoder_the_bundle_gets_a_verified_m4a() {
        let d = dirs();
        // Writes the fixture to the last argument, like `afconvert in out`.
        let encoder = script(
            &d,
            "afconvert",
            &format!("for last; do :; done\ncp '{}' \"$last\"", fixture("tone.m4a").display()),
        );
        let (result, percents) = run(&fixture("tone.wav"), &d, Some(&encoder));
        let result = result.expect("import");
        assert!(result.audio_path.ends_with("/audio.m4a"), "{}", result.audio_path);
        assert_eq!(entries(Path::new(&result.bundle_dir)), vec!["audio.m4a"]);
        assert!((result.duration_secs - 0.4).abs() < 0.2);
        assert_eq!(percents.last(), Some(&100));
        assert!(entries(&d.staging).is_empty());
    }

    /// An encoder that fails, or that writes something that is not the audio,
    /// must never cost the import: it falls back to the WAV.
    #[cfg(unix)]
    #[test]
    fn a_failing_or_lying_encoder_falls_back_to_wav() {
        let d = dirs();
        let failing = script(&d, "fails", "exit 3");
        let (result, _) = run(&fixture("tone.wav"), &d, Some(&failing));
        assert!(result.unwrap().audio_path.ends_with("/audio.wav"));

        let lying = script(&d, "lies", "for last; do :; done\nprintf 'garbage' > \"$last\"");
        let (result, _) = run(&fixture("tone.m4a"), &d, Some(&lying));
        let result = result.unwrap();
        assert!(result.audio_path.ends_with("/audio.wav"));
        assert_eq!(entries(Path::new(&result.bundle_dir)), vec!["audio.wav"]);

        let absent = d.work.join("no-such-encoder");
        let (result, _) = run(&fixture("tone.wav"), &d, Some(&absent));
        assert!(result.unwrap().audio_path.ends_with("/audio.wav"));
    }

    /// The downmix option is tried first; an encoder that rejects it is run
    /// again without it rather than abandoned.
    #[cfg(unix)]
    #[test]
    fn an_encoder_without_the_mix_option_is_retried_without_it() {
        let d = dirs();
        let encoder = script(
            &d,
            "picky",
            &format!(
                "for a; do [ \"$a\" = \"--mix\" ] && exit 2; done\nfor last; do :; done\ncp '{}' \"$last\"",
                fixture("tone.m4a").display()
            ),
        );
        let (result, _) = run(&fixture("tone.wav"), &d, Some(&encoder));
        assert!(result.unwrap().audio_path.ends_with("/audio.m4a"));
    }

    #[cfg(unix)]
    #[test]
    fn cancelling_kills_the_encoder_and_leaves_nothing() {
        let d = dirs();
        let slow = script(&d, "slow", "exec sleep 30");
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            flag.store(true, Ordering::Relaxed);
        });
        let started = Instant::now();
        let err = import_media_blocking(&fixture("tone.wav"), &d.dest, &env(&d, Some(&slow)), &cancel, &mut |_| {})
            .unwrap_err();
        canceller.join().unwrap();
        assert_eq!(err, "Import cancelled");
        assert!(started.elapsed() < Duration::from_secs(10), "the encoder was waited for, not killed");
        assert!(entries(&d.dest).is_empty());
        assert!(entries(&d.staging).is_empty());
    }
}
