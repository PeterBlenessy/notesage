//! Short audio clips for the interface to play ("this is Speaker 2").
//!
//! A clip is a few seconds of a recording written as a 16 kHz mono WAV into
//! a private folder under the system temp directory. Clips are voice data:
//! the folder is `0700`, the files `0600`, they are removed when they are an
//! hour old and when the app quits.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The longest clip that can be asked for.
pub const MAX_CLIP_SECS: f64 = 30.0;
/// Clips older than this are removed whenever a new one is made.
pub const CLIP_MAX_AGE: Duration = Duration::from_secs(60 * 60);

const RATE: u32 = 16_000;
const PREFIX: &str = "clip-";

/// What stops the decoder once the clip is complete. Never shown.
pub const CLIP_COMPLETE: &str = "\u{0}clip-complete";

/// `<temp>/notesage-speaker-clips/`.
pub fn default_clip_dir() -> PathBuf {
    std::env::temp_dir().join("notesage-speaker-clips")
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

/// Check a requested range. Returns it in samples.
pub fn clip_range(start: f64, end: f64) -> Result<(usize, usize), String> {
    if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start {
        return Err("Invalid clip range".into());
    }
    if end - start > MAX_CLIP_SECS {
        return Err(format!("A clip can be at most {MAX_CLIP_SECS:.0} seconds long"));
    }
    Ok(((start * RATE as f64) as usize, (end * RATE as f64).ceil() as usize))
}

/// Picks the samples of one range out of a stream.
pub struct ClipCollector {
    start: usize,
    end: usize,
    position: usize,
    pub samples: Vec<f32>,
}

impl ClipCollector {
    pub fn new(start: usize, end: usize) -> Self {
        Self { start, end, position: 0, samples: Vec::with_capacity(end.saturating_sub(start)) }
    }

    /// Feed the next samples of the stream. `Err(CLIP_COMPLETE)` once
    /// everything wanted has been seen, so the decoder can stop.
    pub fn push(&mut self, samples: &[f32]) -> Result<(), String> {
        let (from, to) = (self.position, self.position + samples.len());
        let (a, b) = (self.start.max(from), self.end.min(to));
        if a < b {
            self.samples.extend_from_slice(&samples[a - from..b - from]);
        }
        self.position = to;
        if to >= self.end {
            Err(CLIP_COMPLETE.to_string())
        } else {
            Ok(())
        }
    }
}

/// The file a clip of `audio_path` from `start` to `end` is written to.
pub fn clip_path(dir: &Path, audio_path: &str, start: usize, end: usize) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(audio_path.as_bytes());
    hasher.update(start.to_le_bytes());
    hasher.update(end.to_le_bytes());
    let hex: String = hasher.finalize().iter().take(12).map(|b| format!("{b:02x}")).collect();
    dir.join(format!("{PREFIX}{hex}.wav"))
}

/// Write `samples` as a 16-bit mono WAV at `path` (replacing it), in a
/// private folder.
pub fn write_clip(dir: &Path, path: &Path, samples: &[f32]) -> Result<(), String> {
    if samples.is_empty() {
        return Err("The recording has no audio in that range".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    restrict(dir, 0o700);
    let data_bytes = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + samples.len() * 2);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
    bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
    bytes.extend_from_slice(&RATE.to_le_bytes());
    bytes.extend_from_slice(&(RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_bytes.to_le_bytes());
    for s in samples {
        bytes.extend_from_slice(&((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes());
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(&bytes)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Could not write the clip: {e}"));
    }
    restrict(&tmp, 0o600);
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not write the clip: {e}")
    })
}

/// Remove clips older than `max_age` (all of them with a zero age). Only
/// files this module wrote are touched. Returns how many were removed.
pub fn purge(dir: &Path, max_age: Duration) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let now = std::time::SystemTime::now();
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(PREFIX) {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .map(|age| age >= max_age)
            .unwrap_or(true);
        if old && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Remove every clip and, if nothing else is in it, the folder. For app exit.
pub fn purge_all(dir: &Path) -> usize {
    let removed = purge(dir, Duration::ZERO);
    let _ = std::fs::remove_dir(dir);
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("notesage-clip-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn ranges_are_checked() {
        assert_eq!(clip_range(1.0, 2.5), Ok((16_000, 40_000)));
        assert_eq!(clip_range(0.0, 30.0), Ok((0, 480_000)));
        for (s, e) in [(2.0, 2.0), (3.0, 1.0), (-1.0, 2.0), (f64::NAN, 2.0), (0.0, f64::INFINITY)] {
            assert_eq!(clip_range(s, e).unwrap_err(), "Invalid clip range", "{s} {e}");
        }
        assert_eq!(clip_range(0.0, 30.5).unwrap_err(), "A clip can be at most 30 seconds long");
    }

    #[test]
    fn the_collector_takes_exactly_the_range_from_any_chunking() {
        let stream: Vec<f32> = (0..10_000).map(|i| i as f32).collect();
        for chunk in [1usize, 7, 999, 10_000] {
            let mut c = ClipCollector::new(2_500, 6_100);
            let mut stopped_at = None;
            for (i, part) in stream.chunks(chunk).enumerate() {
                if let Err(e) = c.push(part) {
                    assert_eq!(e, CLIP_COMPLETE);
                    stopped_at = Some((i + 1) * chunk);
                    break;
                }
            }
            assert_eq!(c.samples.len(), 3_600);
            assert_eq!(c.samples[0], 2_500.0);
            assert_eq!(*c.samples.last().unwrap(), 6_099.0);
            // The decoder is stopped as soon as the range has been seen.
            assert!(stopped_at.unwrap() < 6_100 + chunk, "chunk {chunk}");
        }
        // A range past the end of the stream: what there is (maybe nothing).
        let mut c = ClipCollector::new(9_000, 20_000);
        assert!(c.push(&stream).is_ok());
        assert_eq!(c.samples.len(), 1_000);
        let mut c = ClipCollector::new(50_000, 60_000);
        assert!(c.push(&stream).is_ok());
        assert!(c.samples.is_empty());
    }

    #[test]
    fn a_clip_is_a_private_valid_wav() {
        let dir = temp_dir("write");
        let path = clip_path(&dir, "/lib/Recordings/A/audio.m4a", 16_000, 48_000);
        let samples: Vec<f32> = (0..32_000).map(|i| ((i as f32) * 0.01).sin() * 0.5).collect();
        write_clip(&dir, &path, &samples).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), 1);
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 64_000);
        assert_eq!(bytes.len(), 44 + 64_000);
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize, bytes.len() - 8);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // Writing it again replaces it and leaves no temp file.
        write_clip(&dir, &path, &samples[..16_000]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap().len(), 44 + 32_000);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        assert_eq!(write_clip(&dir, &path, &[]).unwrap_err(), "The recording has no audio in that range");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clip_names_do_not_reveal_the_recording_and_differ_by_range() {
        let dir = Path::new("/tmp/x");
        let a = clip_path(dir, "/lib/Recordings/Board meeting/audio.m4a", 0, 100);
        let b = clip_path(dir, "/lib/Recordings/Board meeting/audio.m4a", 0, 101);
        let c = clip_path(dir, "/lib/Recordings/Other/audio.m4a", 0, 100);
        assert_ne!(a, b);
        assert_ne!(a, c);
        assert_eq!(a, clip_path(dir, "/lib/Recordings/Board meeting/audio.m4a", 0, 100));
        let name = a.file_name().unwrap().to_string_lossy().to_string();
        assert!(name.starts_with("clip-") && name.ends_with(".wav") && !name.contains("Board"));
    }

    #[test]
    fn purging_removes_only_old_clips_and_only_ours() {
        let dir = temp_dir("purge");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("clip-aaaa.wav"), b"x").unwrap();
        std::fs::write(dir.join("clip-bbbb.wav"), b"x").unwrap();
        std::fs::write(dir.join("something-else.txt"), b"x").unwrap();
        // Nothing is an hour old yet.
        assert_eq!(purge(&dir, CLIP_MAX_AGE), 0);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 3);
        // Everything of ours goes on exit; the stranger (and so the folder) stays.
        assert_eq!(purge_all(&dir), 2);
        assert!(dir.join("something-else.txt").exists());
        std::fs::remove_file(dir.join("something-else.txt")).unwrap();
        std::fs::write(dir.join("clip-cccc.wav"), b"x").unwrap();
        assert_eq!(purge_all(&dir), 1);
        assert!(!dir.exists());
        assert_eq!(purge_all(&dir), 0);
    }
}
