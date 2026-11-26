//! Where a recording lives before it is in the library, and how it gets there.
//!
//! A recording is captured into a LOCAL staging bundle
//! (`~/.notesage/recordings-staging/<Bundle name>/`), never into iCloud: the
//! file is appended to for an hour, and a sync daemon watching that is at best
//! wasteful. Once capture has stopped and the frontend has written
//! `recording.json` into the bundle, [`finalize_bundle`] moves the whole
//! folder into the library's `Recordings` folder in one step (S1), so a bundle
//! never appears there half-written or without a manifest.
//!
//! Anything still in staging when the app starts was left by a crash or a
//! quit; [`recover_orphans`] repairs and reports it (C3).
//!
//! Staging folders are created `0700` and files `0600` (S5).

use super::mix::mix_tracks;
use super::types::{FinalizedBundle, OrphanRecording, TrackRef};
use super::wav::repair_wav_header;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Written by the recorder at start; private to the backend and removed when
/// the bundle is finalised.
pub const MARKER_FILE: &str = ".capture.json";
/// Written by the frontend after stop.
pub const MANIFEST_FILE: &str = "recording.json";
/// Staging folders that were copied into the library but could not be
/// deleted are renamed with this prefix so they are not offered again.
const DONE_PREFIX: &str = ".done-";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CaptureMarker {
    pub version: u32,
    /// RFC 3339 with offset.
    pub started_at: String,
    /// `"microphone" | "system" | "both"`.
    pub source: String,
}

/// `~/.notesage/recordings-staging`.
pub fn staging_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".notesage")
        .join("recordings-staging")
}

/// `Recording <YYYY-MM-DD HH-MM-SS>`: the bundle name the app has always
/// used, so the Recordings list sorts and reads the same as before.
pub fn bundle_name(now: chrono::NaiveDateTime) -> String {
    format!("Recording {}", now.format("%Y-%m-%d %H-%M-%S"))
}

/// `parent/name`, or `parent/name (2)`, `(3)`, … if that is taken.
pub fn unique_child(parent: &Path, name: &str) -> PathBuf {
    let first = parent.join(name);
    if !first.exists() {
        return first;
    }
    let mut n = 2u32;
    loop {
        let candidate = parent.join(format!("{} ({})", name, n));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// `create_dir_all`, with every folder it creates readable by the owner only.
pub fn create_private_dir_all(path: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

/// Create a new, empty, owner-only bundle folder under `root` and return it.
/// Two recordings started within the same second get distinct folders.
pub fn create_staging_bundle(root: &Path, name: &str) -> Result<PathBuf, String> {
    create_private_dir_all(root)
        .map_err(|e| format!("Failed to create recording directory: {}", e))?;
    for _ in 0..50 {
        let dir = unique_child(root, name);
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(&dir) {
            Ok(()) => return Ok(dir),
            // Someone took the name between the check and the create.
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Failed to create recording directory: {}", e)),
        }
    }
    Err("Failed to create recording directory: no free name".into())
}

pub fn write_marker(bundle: &Path, marker: &CaptureMarker) -> Result<(), String> {
    use std::io::Write;
    let json = serde_json::to_vec_pretty(marker).map_err(|e| e.to_string())?;
    let mut file = super::wav::create_private_file(&bundle.join(MARKER_FILE))
        .map_err(|e| format!("Failed to write recording marker: {}", e))?;
    file.write_all(&json)
        .map_err(|e| format!("Failed to write recording marker: {}", e))
}

pub fn read_marker(bundle: &Path) -> Option<CaptureMarker> {
    let bytes = std::fs::read(bundle.join(MARKER_FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Check that `dir` is an existing folder directly inside the staging root,
/// and return its canonical path. The commands that move or delete a bundle
/// take a path from the frontend; this is what stops them from being pointed
/// at an arbitrary folder.
pub fn staging_child(root: &Path, dir: &Path) -> Result<PathBuf, String> {
    let not_staging = || format!("Not a staging recording: {}", dir.display());
    let canon_root = root.canonicalize().map_err(|_| not_staging())?;
    let canon_dir = dir.canonicalize().map_err(|_| not_staging())?;
    if !canon_dir.is_dir() || canon_dir.parent() != Some(canon_root.as_path()) {
        return Err(not_staging());
    }
    Ok(canon_dir)
}

/// The audio files of a bundle folder.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BundleAudio {
    pub audio: Option<PathBuf>,
    pub mic: Option<PathBuf>,
    pub system: Option<PathBuf>,
}

impl BundleAudio {
    /// The separate tracks, reported only when both exist: one track alone
    /// would label a whole meeting as a single speaker.
    pub fn track_refs(&self) -> Vec<TrackRef> {
        match (&self.mic, &self.system) {
            (Some(mic), Some(system)) => vec![
                TrackRef { role: "mic".into(), path: mic.to_string_lossy().into_owned() },
                TrackRef { role: "system".into(), path: system.to_string_lossy().into_owned() },
            ],
            _ => Vec::new(),
        }
    }
}

/// `<stem>.wav` if present, else `<stem>.m4a`. The WAV wins when both exist:
/// it is deleted only after its encode was verified, so a WAV that is still
/// there is the authoritative copy.
fn find_audio(dir: &Path, stem: &str) -> Option<PathBuf> {
    ["wav", "m4a"]
        .iter()
        .map(|ext| dir.join(format!("{}.{}", stem, ext)))
        .find(|p| p.is_file())
}

pub fn scan_bundle_audio(dir: &Path) -> BundleAudio {
    BundleAudio {
        audio: find_audio(dir, "audio"),
        mic: find_audio(dir, "mic"),
        system: find_audio(dir, "system"),
    }
}

/// The cross-folder move, injectable so the copy fallback can be exercised
/// without a second volume.
pub trait Mover {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()>;
}

pub struct FsMover;

impl Mover for FsMover {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        std::fs::rename(from, to)
    }
}

fn copy_dir_private(from: &Path, to: &Path) -> std::io::Result<()> {
    create_private_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_private(&entry.path(), &target)?;
        } else {
            // `fs::copy` carries the source's permission bits (0600) over.
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Every file under `from` exists under `to` with the same length.
fn verify_copy(from: &Path, to: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            verify_copy(&entry.path(), &target)?;
        } else {
            let want = entry.metadata()?.len();
            let got = std::fs::metadata(&target)?.len();
            if want != got {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("{} copied {} of {} bytes", target.display(), got, want),
                ));
            }
        }
    }
    Ok(())
}

/// Move a staging bundle into `dest_dir` (the library's `Recordings` folder,
/// possibly in iCloud) under a name that does not collide.
///
/// A rename is tried first: atomic, and the usual case, since staging and the
/// library are normally on the same volume. If it fails for any reason the
/// bundle is copied to a dot-prefixed temporary folder inside the
/// destination (hidden from the Recordings list, and not uploaded by iCloud),
/// every file's size is verified, and only then is it renamed into place and
/// the staging copy deleted. At no point is there a half-moved bundle under
/// its final name, and a failure leaves the staging bundle intact.
pub fn finalize_bundle(
    root: &Path,
    staging_dir: &Path,
    dest_dir: &Path,
    mover: &dyn Mover,
) -> Result<FinalizedBundle, String> {
    let staging = staging_child(root, staging_dir)?;
    if scan_bundle_audio(&staging).audio.is_none() {
        return Err(format!("Recording has no audio: {}", staging.display()));
    }
    let name = staging
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Not a staging recording: {}", staging.display()))?
        .to_string();
    let fail = |detail: String| format!("Failed to move recording: {}", detail);

    create_private_dir_all(dest_dir).map_err(|e| fail(format!("{}: {}", dest_dir.display(), e)))?;
    let mut final_dir = unique_child(dest_dir, &name);
    if let Err(rename_err) = mover.rename(&staging, &final_dir) {
        log::info!(
            target: "notesage::recording",
            "Rename into the library failed ({}); copying instead", rename_err
        );
        let temp = dest_dir.join(format!(".{}.partial-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        let copied = copy_dir_private(&staging, &temp).and_then(|()| verify_copy(&staging, &temp));
        if let Err(e) = copied {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(fail(e.to_string()));
        }
        final_dir = unique_child(dest_dir, &name);
        if let Err(e) = std::fs::rename(&temp, &final_dir) {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(fail(e.to_string()));
        }
        // The library copy is complete and verified. If the staging copy
        // cannot be deleted, hide it so it is not offered as an orphan (which
        // would import the same recording twice).
        if let Err(e) = std::fs::remove_dir_all(&staging) {
            log::warn!(
                target: "notesage::recording",
                "Could not delete staging bundle {}: {}", staging.display(), e
            );
            if let Some(parent) = staging.parent() {
                let _ = std::fs::rename(&staging, parent.join(format!("{}{}", DONE_PREFIX, name)));
            }
        }
    }

    // The marker is the backend's own bookkeeping; it has no place in the
    // library. Removed only now, so a failed move keeps it for recovery.
    let _ = std::fs::remove_file(final_dir.join(MARKER_FILE));

    let audio = scan_bundle_audio(&final_dir);
    let audio_path = audio
        .audio
        .as_ref()
        .ok_or_else(|| fail("the audio file is missing after the move".into()))?
        .to_string_lossy()
        .into_owned();
    Ok(FinalizedBundle {
        bundle_dir: final_dir.to_string_lossy().into_owned(),
        audio_path,
        tracks: audio.track_refs(),
    })
}

/// Delete a staging bundle.
pub fn remove_staging_bundle(root: &Path, dir: &Path) -> Result<(), String> {
    let staging = staging_child(root, dir)?;
    std::fs::remove_dir_all(&staging)
        .map_err(|e| format!("Failed to delete recording {}: {}", staging.display(), e))
}

/// Start time from a `Recording YYYY-MM-DD HH-MM-SS` folder name, as RFC 3339
/// in the local zone.
fn started_at_from_name(name: &str) -> Option<String> {
    use chrono::TimeZone;
    let stamp = name.strip_prefix("Recording ")?.get(..19)?;
    let naive = chrono::NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d %H-%M-%S").ok()?;
    chrono::Local.from_local_datetime(&naive).single().map(|dt| dt.to_rfc3339())
}

enum Prepared {
    /// A usable recording.
    Ready(BundleAudio, f64),
    /// Nothing worth keeping: the bundle may be deleted.
    Empty,
    /// Something is there that could not be read. Left untouched.
    Unreadable,
}

/// Bring one orphaned bundle's audio into a consistent state.
fn prepare_orphan(dir: &Path, probe: &dyn Fn(&Path) -> Option<f64>) -> Prepared {
    let mut unreadable = false;
    let mut wav_secs: Vec<(&str, f64)> = Vec::new();
    for stem in ["audio", "mic", "system"] {
        // An encode that was in flight when the app died.
        let _ = std::fs::remove_file(dir.join(format!("{}.encoding.m4a", stem)));
        let wav = dir.join(format!("{}.wav", stem));
        if !wav.is_file() {
            continue;
        }
        // The WAV is deleted only after its encode was verified, so an .m4a
        // beside a WAV is unverified.
        let _ = std::fs::remove_file(dir.join(format!("{}.m4a", stem)));
        match repair_wav_header(&wav) {
            Ok(info) if info.data_bytes == 0 => {
                let _ = std::fs::remove_file(&wav);
            }
            Ok(info) => wav_secs.push((stem, info.duration_secs())),
            Err(e) => {
                log::warn!(target: "notesage::recording", "Orphan {}: {}", wav.display(), e);
                unreadable = true;
            }
        }
    }
    if unreadable {
        return Prepared::Unreadable;
    }

    let mut audio = scan_bundle_audio(dir);
    if audio.audio.is_none() {
        match (audio.mic.clone(), audio.system.clone()) {
            (Some(mic), Some(system))
                if mic.extension().is_some_and(|e| e == "wav")
                    && system.extension().is_some_and(|e| e == "wav") =>
            {
                // Crashed before stop: the mix was never made.
                let out = dir.join("audio.wav");
                match mix_tracks(&mic, &system, &out) {
                    Ok(info) => {
                        wav_secs.push(("audio", info.frames as f64 / info.sample_rate.max(1) as f64))
                    }
                    Err(e) => {
                        log::warn!(target: "notesage::recording", "Orphan mix failed: {}", e);
                        let _ = std::fs::remove_file(&out);
                    }
                }
            }
            (Some(only), None) | (None, Some(only)) => {
                // One source never delivered anything; the other is the recording.
                let ext = only.extension().and_then(|e| e.to_str()).unwrap_or("wav").to_string();
                let target = dir.join(format!("audio.{}", ext));
                if std::fs::rename(&only, &target).is_ok() {
                    let stem = only.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                    if let Some(entry) = wav_secs.iter_mut().find(|(s, _)| *s == stem) {
                        entry.0 = "audio";
                    }
                }
            }
            _ => {}
        }
        audio = scan_bundle_audio(dir);
    }

    let primary = match audio.audio.clone().or_else(|| audio.mic.clone()).or_else(|| audio.system.clone()) {
        Some(p) => p,
        None => return Prepared::Empty,
    };
    if audio.audio.is_none() {
        // Tracks exist but no mix could be produced: offer the first track.
        audio.audio = Some(primary.clone());
    }
    let stem = primary.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let duration = if primary.extension().is_some_and(|e| e == "wav") {
        wav_secs.iter().find(|(s, _)| *s == stem).map(|(_, d)| *d).unwrap_or(0.0)
    } else {
        probe(&primary).unwrap_or(0.0)
    };
    Prepared::Ready(audio, duration)
}

/// Find the bundles a crash or quit left in staging (C3).
///
/// For each: WAV headers are repaired from the file length, zero-data files
/// are removed, a missing mix is produced from the two tracks. Bundles with
/// no audio at all are deleted. Nothing is encoded or moved: the caller
/// writes a manifest and calls `finalize_recording_bundle`.
///
/// `skip`: bundles that belong to the running session (being recorded, or
/// stopped and not yet finalised). `probe`: duration of a non-WAV file.
pub fn recover_orphans(
    root: &Path,
    skip: &HashSet<PathBuf>,
    probe: &dyn Fn(&Path) -> Option<f64>,
) -> Vec<OrphanRecording> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !dir.is_dir() {
            continue;
        }
        if name.starts_with(DONE_PREFIX) {
            let _ = std::fs::remove_dir_all(&dir);
            continue;
        }
        if name.starts_with('.') || skip.contains(&dir) {
            continue;
        }
        match prepare_orphan(&dir, probe) {
            Prepared::Unreadable => {}
            Prepared::Empty => {
                log::info!(target: "notesage::recording", "Removing empty staging bundle {}", dir.display());
                let _ = std::fs::remove_dir_all(&dir);
            }
            Prepared::Ready(audio, duration_secs) => {
                let marker = read_marker(&dir);
                let Some(audio_path) = audio.audio.as_ref() else { continue };
                found.push(OrphanRecording {
                    bundle_dir: dir.to_string_lossy().into_owned(),
                    audio_path: audio_path.to_string_lossy().into_owned(),
                    tracks: audio.track_refs(),
                    duration_secs,
                    started_at: marker
                        .as_ref()
                        .map(|m| m.started_at.clone())
                        .or_else(|| started_at_from_name(&name)),
                    source: marker.map(|m| m.source),
                    has_manifest: dir.join(MANIFEST_FILE).is_file(),
                });
            }
        }
    }
    found.sort_by(|a, b| a.bundle_dir.cmp(&b.bundle_dir));
    found
}

#[cfg(test)]
mod tests {
    use super::super::wav::{wav_header, WavReader, WavWriter};
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "notesage-staging-{}-{}-{:?}",
            tag,
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn no_probe(_: &Path) -> Option<f64> {
        None
    }

    fn write_wav(path: &Path, rate: u32, frames: usize, value: f32) {
        let mut w = WavWriter::create(path, rate, 1).unwrap();
        w.write_f32(&vec![value; frames]).unwrap();
        w.finalize().unwrap();
    }

    /// A WAV as a crash leaves it: data present, header sizes zero.
    fn write_crashed_wav(path: &Path, rate: u32, frames: usize) {
        let mut bytes = wav_header(rate, 1, 0).to_vec();
        bytes.extend(std::iter::repeat([0x00u8, 0x20]).take(frames).flatten());
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn bundle_names_match_the_existing_scheme_and_collisions_get_a_suffix() {
        let when = chrono::NaiveDate::from_ymd_opt(2026, 11, 25)
            .unwrap()
            .and_hms_opt(9, 5, 7)
            .unwrap();
        assert_eq!(bundle_name(when), "Recording 2026-11-25 09-05-07");

        let root = temp_root("names").join("staging");
        let name = bundle_name(when);
        let a = create_staging_bundle(&root, &name).unwrap();
        let b = create_staging_bundle(&root, &name).unwrap();
        let c = create_staging_bundle(&root, &name).unwrap();
        assert_eq!(a, root.join("Recording 2026-11-25 09-05-07"));
        assert_eq!(b, root.join("Recording 2026-11-25 09-05-07 (2)"));
        assert_eq!(c, root.join("Recording 2026-11-25 09-05-07 (3)"));
        assert!(a.is_dir() && b.is_dir() && c.is_dir());
        // The suffix does not confuse the start-time fallback.
        let from_name = started_at_from_name("Recording 2026-11-25 09-05-07 (2)").unwrap();
        assert!(from_name.starts_with("2026-11-25T09:05:07"), "{from_name}");
        assert_eq!(started_at_from_name("Meeting notes"), None);
        assert_eq!(started_at_from_name("Recording soon"), None);
    }

    /// S5: other local accounts cannot read a recording.
    #[cfg(unix)]
    #[test]
    fn staging_folders_and_files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("perm").join("deep").join("staging");
        let bundle = create_staging_bundle(&root, "Recording 2026-01-01 00-00-00").unwrap();
        write_marker(
            &bundle,
            &CaptureMarker { version: 1, started_at: "2026-01-01T00:00:00+01:00".into(), source: "both".into() },
        )
        .unwrap();
        write_wav(&bundle.join("audio.wav"), 48_000, 10, 0.1);
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&root), 0o700);
        assert_eq!(mode(&bundle), 0o700);
        assert_eq!(mode(&bundle.join(MARKER_FILE)), 0o600);
        assert_eq!(mode(&bundle.join("audio.wav")), 0o600);
        assert_eq!(read_marker(&bundle).unwrap().source, "both");
    }

    #[test]
    fn only_direct_children_of_the_staging_root_are_accepted() {
        let base = temp_root("child");
        let root = base.join("staging");
        let bundle = create_staging_bundle(&root, "Recording A").unwrap();
        assert_eq!(staging_child(&root, &bundle).unwrap(), bundle);

        let outside = base.join("Documents");
        std::fs::create_dir_all(&outside).unwrap();
        for bad in [outside.clone(), root.clone(), bundle.join("nested"), root.join("missing"), root.join("..").join("Documents")] {
            let err = staging_child(&root, &bad).unwrap_err();
            assert!(err.starts_with("Not a staging recording: "), "{err}");
        }
        std::fs::create_dir_all(bundle.join("nested")).unwrap();
        assert!(staging_child(&root, &bundle.join("nested")).is_err());
        // Deleting through the command path is held to the same rule.
        assert!(remove_staging_bundle(&root, &outside).is_err());
        assert!(outside.is_dir());
        remove_staging_bundle(&root, &bundle).unwrap();
        assert!(!bundle.exists());
    }

    fn staged_bundle(root: &Path, name: &str) -> PathBuf {
        let bundle = create_staging_bundle(root, name).unwrap();
        write_marker(
            &bundle,
            &CaptureMarker { version: 1, started_at: "2026-11-25T10:00:00+01:00".into(), source: "both".into() },
        )
        .unwrap();
        write_wav(&bundle.join("audio.wav"), 48_000, 4800, 0.2);
        write_wav(&bundle.join("mic.wav"), 48_000, 4800, 0.1);
        write_wav(&bundle.join("system.wav"), 44_100, 4410, 0.1);
        std::fs::write(bundle.join(MANIFEST_FILE), b"{\"version\":1}").unwrap();
        bundle
    }

    /// S1, same volume: one rename; manifest and tracks travel together; the
    /// private marker does not.
    #[test]
    fn finalize_renames_into_the_library_and_reports_the_new_paths() {
        let base = temp_root("fin-same");
        let root = base.join("staging");
        let dest = base.join("Library").join("Recordings");
        let bundle = staged_bundle(&root, "Recording 2026-11-25 10-00-00");

        let done = finalize_bundle(&root, &bundle, &dest, &FsMover).unwrap();
        let final_dir = dest.join("Recording 2026-11-25 10-00-00");
        assert_eq!(done.bundle_dir, final_dir.to_string_lossy());
        assert_eq!(done.audio_path, final_dir.join("audio.wav").to_string_lossy());
        assert_eq!(
            done.tracks,
            vec![
                TrackRef { role: "mic".into(), path: final_dir.join("mic.wav").to_string_lossy().into_owned() },
                TrackRef { role: "system".into(), path: final_dir.join("system.wav").to_string_lossy().into_owned() },
            ]
        );
        assert!(!bundle.exists(), "staging copy is gone");
        assert!(final_dir.join(MANIFEST_FILE).is_file());
        assert!(!final_dir.join(MARKER_FILE).exists());
        // Finalising it again is refused: it is no longer in staging.
        assert!(finalize_bundle(&root, &bundle, &dest, &FsMover).is_err());
        assert!(finalize_bundle(&root, &final_dir, &dest, &FsMover).is_err());
    }

    struct CrossDevice;
    impl Mover for CrossDevice {
        fn rename(&self, _: &Path, _: &Path) -> std::io::Result<()> {
            Err(std::io::Error::new(std::io::ErrorKind::Other, "Cross-device link (os error 18)"))
        }
    }

    /// S1, other volume: copy, verify, rename into place, then delete staging.
    #[test]
    fn finalize_falls_back_to_copy_when_rename_is_refused() {
        let base = temp_root("fin-cross");
        let root = base.join("staging");
        let dest = base.join("Recordings");
        let bundle = staged_bundle(&root, "Recording 2026-11-25 11-00-00");
        let audio_len = std::fs::metadata(bundle.join("audio.wav")).unwrap().len();

        let done = finalize_bundle(&root, &bundle, &dest, &CrossDevice).unwrap();
        let final_dir = PathBuf::from(&done.bundle_dir);
        assert_eq!(final_dir, dest.join("Recording 2026-11-25 11-00-00"));
        assert_eq!(std::fs::metadata(final_dir.join("audio.wav")).unwrap().len(), audio_len);
        assert!(final_dir.join("mic.wav").is_file() && final_dir.join("system.wav").is_file());
        assert!(final_dir.join(MANIFEST_FILE).is_file());
        assert!(!bundle.exists(), "staging copy deleted after a verified copy");
        // No temporary folder is left behind, under any name.
        let leftovers: Vec<_> = std::fs::read_dir(&dest).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers.len(), 1, "{leftovers:?}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&final_dir), 0o700);
            assert_eq!(mode(&final_dir.join("audio.wav")), 0o600);
        }
    }

    /// A failed copy must leave the recording where it was and nothing
    /// visible in the library.
    #[cfg(unix)]
    #[test]
    fn a_failed_copy_leaves_staging_intact_and_the_library_clean() {
        use std::os::unix::fs::PermissionsExt;
        let base = temp_root("fin-fail");
        let root = base.join("staging");
        let dest = base.join("Recordings");
        let bundle = staged_bundle(&root, "Recording 2026-11-25 12-00-00");
        // An unreadable file makes the copy fail part-way.
        let locked = bundle.join("mic.wav");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::File::open(&locked).is_ok() {
            // Running as root: permissions do not bite, nothing to assert.
            return;
        }
        let err = finalize_bundle(&root, &bundle, &dest, &CrossDevice).unwrap_err();
        assert!(err.starts_with("Failed to move recording: "), "{err}");
        assert!(bundle.join("audio.wav").is_file(), "staging untouched");
        assert!(bundle.join(MANIFEST_FILE).is_file());
        assert_eq!(std::fs::read_dir(&dest).unwrap().count(), 0, "nothing left in the library");
    }

    #[test]
    fn finalize_picks_a_free_name_and_refuses_bundles_without_audio() {
        let base = temp_root("fin-collide");
        let root = base.join("staging");
        let dest = base.join("Recordings");
        let name = "Recording 2026-11-25 13-00-00";
        std::fs::create_dir_all(dest.join(name)).unwrap();
        std::fs::write(dest.join(name).join("audio.m4a"), b"existing").unwrap();

        for mover in [&FsMover as &dyn Mover, &CrossDevice as &dyn Mover] {
            let bundle = staged_bundle(&root, name);
            let done = finalize_bundle(&root, &bundle, &dest, mover).unwrap();
            assert_ne!(done.bundle_dir, dest.join(name).to_string_lossy());
            assert!(done.bundle_dir.starts_with(&*dest.join(name).to_string_lossy()));
        }
        assert!(dest.join(format!("{name} (2)")).join("audio.wav").is_file());
        assert!(dest.join(format!("{name} (3)")).join("audio.wav").is_file());
        assert_eq!(std::fs::read(dest.join(name).join("audio.m4a")).unwrap(), b"existing", "never overwritten");

        let empty = create_staging_bundle(&root, "Recording empty").unwrap();
        std::fs::write(empty.join(MANIFEST_FILE), b"{}").unwrap();
        let err = finalize_bundle(&root, &empty, &dest, &FsMover).unwrap_err();
        assert!(err.starts_with("Recording has no audio: "), "{err}");
        assert!(empty.is_dir());
    }

    /// C3: a crash mid-recording leaves a WAV with a stale header. Recovery
    /// repairs it and reports the real duration.
    #[test]
    fn recovery_repairs_a_crashed_recording_and_reports_it() {
        let base = temp_root("rec-valid");
        let root = base.join("staging");
        let bundle = create_staging_bundle(&root, "Recording 2026-11-25 14-00-00").unwrap();
        write_marker(
            &bundle,
            &CaptureMarker { version: 1, started_at: "2026-11-25T14:00:00+01:00".into(), source: "microphone".into() },
        )
        .unwrap();
        write_crashed_wav(&bundle.join("audio.wav"), 48_000, 96_000);

        let found = recover_orphans(&root, &HashSet::new(), &no_probe);
        assert_eq!(found.len(), 1);
        let o = &found[0];
        assert_eq!(o.bundle_dir, bundle.to_string_lossy());
        assert_eq!(o.audio_path, bundle.join("audio.wav").to_string_lossy());
        assert!(o.tracks.is_empty());
        assert!((o.duration_secs - 2.0).abs() < 1e-9, "{}", o.duration_secs);
        assert_eq!(o.started_at.as_deref(), Some("2026-11-25T14:00:00+01:00"));
        assert_eq!(o.source.as_deref(), Some("microphone"));
        assert!(!o.has_manifest);
        // The file on disk is now a valid WAV of the full length.
        let r = WavReader::open(&bundle.join("audio.wav")).unwrap();
        assert_eq!(r.frames_left(), 96_000);
        let raw = std::fs::read(bundle.join("audio.wav")).unwrap();
        assert_eq!(u32::from_le_bytes([raw[40], raw[41], raw[42], raw[43]]), 192_000);

        // Recovery is repeatable, and the live session's bundles are skipped.
        assert_eq!(recover_orphans(&root, &HashSet::new(), &no_probe).len(), 1);
        let skip: HashSet<PathBuf> = [bundle.clone()].into_iter().collect();
        assert!(recover_orphans(&root, &skip, &no_probe).is_empty());
        assert!(bundle.is_dir());
    }

    #[test]
    fn recovery_deletes_bundles_without_audio_data() {
        let base = temp_root("rec-empty");
        let root = base.join("staging");
        // Header only: the app died before the first samples were flushed.
        let header_only = create_staging_bundle(&root, "Recording 2026-11-25 15-00-00").unwrap();
        std::fs::write(header_only.join("audio.wav"), wav_header(48_000, 1, 0)).unwrap();
        // No audio file at all.
        let bare = create_staging_bundle(&root, "Recording 2026-11-25 15-00-01").unwrap();
        std::fs::write(bare.join(MARKER_FILE), b"{}").unwrap();
        // "both" where neither stream delivered anything.
        let both_empty = create_staging_bundle(&root, "Recording 2026-11-25 15-00-02").unwrap();
        std::fs::write(both_empty.join("mic.wav"), wav_header(48_000, 1, 0)).unwrap();
        std::fs::write(both_empty.join("system.wav"), wav_header(48_000, 1, 0)).unwrap();

        assert!(recover_orphans(&root, &HashSet::new(), &no_probe).is_empty());
        assert!(!header_only.exists() && !bare.exists() && !both_empty.exists());
        // A missing staging root is simply "nothing to recover".
        assert!(recover_orphans(&base.join("nope"), &HashSet::new(), &no_probe).is_empty());
    }

    /// A bundle whose stop completed (finalised WAV, or already encoded, plus
    /// a manifest) but that never reached the library is returned untouched.
    #[test]
    fn recovery_returns_already_final_bundles_untouched() {
        let base = temp_root("rec-final");
        let root = base.join("staging");
        let wav_bundle = create_staging_bundle(&root, "Recording 2026-11-25 16-00-00").unwrap();
        write_wav(&wav_bundle.join("audio.wav"), 48_000, 48_000, 0.3);
        std::fs::write(wav_bundle.join(MANIFEST_FILE), b"{}").unwrap();
        let before = std::fs::read(wav_bundle.join("audio.wav")).unwrap();

        let m4a_bundle = create_staging_bundle(&root, "Recording 2026-11-25 16-00-01").unwrap();
        std::fs::write(m4a_bundle.join("audio.m4a"), b"not really aac").unwrap();

        let probe = |p: &Path| p.extension().is_some_and(|e| e == "m4a").then_some(61.5);
        let found = recover_orphans(&root, &HashSet::new(), &probe);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].audio_path, wav_bundle.join("audio.wav").to_string_lossy());
        assert!(found[0].has_manifest);
        assert!((found[0].duration_secs - 1.0).abs() < 1e-9);
        assert_eq!(found[0].source, None);
        assert!(found[0].started_at.as_deref().unwrap().starts_with("2026-11-25T16:00:00"));
        assert_eq!(std::fs::read(wav_bundle.join("audio.wav")).unwrap(), before, "not rewritten");

        assert_eq!(found[1].audio_path, m4a_bundle.join("audio.m4a").to_string_lossy());
        assert_eq!(found[1].duration_secs, 61.5);
        assert_eq!(std::fs::read(m4a_bundle.join("audio.m4a")).unwrap(), b"not really aac");
    }

    /// Crash during a "both" recording: two tracks, no mix. Recovery makes
    /// the mix so there is an `audio_path` to play and transcribe.
    #[test]
    fn recovery_mixes_orphaned_tracks_and_drops_an_unverified_encode() {
        let base = temp_root("rec-both");
        let root = base.join("staging");
        let bundle = create_staging_bundle(&root, "Recording 2026-11-25 17-00-00").unwrap();
        write_crashed_wav(&bundle.join("mic.wav"), 48_000, 48_000);
        write_crashed_wav(&bundle.join("system.wav"), 48_000, 24_000);
        // Leftovers of an encode that never finished.
        std::fs::write(bundle.join("mic.m4a"), b"partial").unwrap();
        std::fs::write(bundle.join("mic.encoding.m4a"), b"partial").unwrap();

        let found = recover_orphans(&root, &HashSet::new(), &no_probe);
        assert_eq!(found.len(), 1);
        let o = &found[0];
        assert_eq!(o.audio_path, bundle.join("audio.wav").to_string_lossy());
        assert_eq!(o.tracks.len(), 2);
        assert_eq!(o.tracks[0].role, "mic");
        assert_eq!(o.tracks[0].path, bundle.join("mic.wav").to_string_lossy());
        assert_eq!(o.tracks[1].role, "system");
        assert!((o.duration_secs - 1.0).abs() < 1e-6, "the longer track: {}", o.duration_secs);
        assert!(!bundle.join("mic.m4a").exists() && !bundle.join("mic.encoding.m4a").exists());
        assert_eq!(WavReader::open(&bundle.join("audio.wav")).unwrap().frames_left(), 48_000);

        // One source silent from the start (zero data): the other becomes the recording.
        let lone = create_staging_bundle(&root, "Recording 2026-11-25 17-00-01").unwrap();
        write_crashed_wav(&lone.join("mic.wav"), 48_000, 4800);
        std::fs::write(lone.join("system.wav"), wav_header(48_000, 1, 0)).unwrap();
        let found = recover_orphans(&root, &HashSet::new(), &no_probe);
        let o = found.iter().find(|o| o.bundle_dir == lone.to_string_lossy()).unwrap();
        assert_eq!(o.audio_path, lone.join("audio.wav").to_string_lossy());
        assert!(o.tracks.is_empty());
        assert!((o.duration_secs - 0.1).abs() < 1e-9);
        assert!(!lone.join("mic.wav").exists() && !lone.join("system.wav").exists());
    }

    /// Never delete what cannot be understood.
    #[test]
    fn recovery_leaves_unreadable_audio_alone() {
        let base = temp_root("rec-unreadable");
        let root = base.join("staging");
        let bundle = create_staging_bundle(&root, "Recording 2026-11-25 18-00-00").unwrap();
        std::fs::write(bundle.join("audio.wav"), vec![9u8; 5000]).unwrap();
        // Hidden and already-imported folders are not offered either.
        std::fs::create_dir_all(root.join(".done-Recording old")).unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::write(root.join("stray.txt"), b"x").unwrap();

        assert!(recover_orphans(&root, &HashSet::new(), &no_probe).is_empty());
        assert_eq!(std::fs::read(bundle.join("audio.wav")).unwrap(), vec![9u8; 5000]);
        assert!(!root.join(".done-Recording old").exists(), "already imported: cleaned up");
        assert!(root.join(".hidden").is_dir() && root.join("stray.txt").is_file());
    }
}
