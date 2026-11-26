//! After-stop compression: WAV → mono AAC in an `.m4a` (S2).
//!
//! An hour of 16-bit mono PCM at 48 kHz is 346 MB; the same hour as 64 kbit/s
//! AAC is 29 MB, which is what the phone already records and what iCloud
//! should be asked to carry.
//!
//! The encoder is Apple's own `afconvert`, present on every macOS, run as a
//! child process once capture has finished. It was chosen over driving
//! `AVAudioFile` through objc2 because it needs no unsafe code and no Cargo
//! feature this crate does not already enable, and a failure in it cannot
//! take the app down.
//!
//! The rule that matters is in [`encode_verified`]: the WAV is deleted only
//! after the encoded file was read back and its duration matches. On any
//! doubt the WAV is what is kept and returned.

use std::path::{Path, PathBuf};
use std::time::Duration;

/// AAC bit rate for a mono track at `sample_rate`. The encoder rejects rates
/// that are too high for the sample rate, and AirPods deliver 16 or 24 kHz.
pub fn aac_bitrate_for(sample_rate: u32) -> u32 {
    if sample_rate >= 44_100 {
        64_000
    } else if sample_rate >= 32_000 {
        48_000
    } else if sample_rate >= 22_050 {
        32_000
    } else {
        24_000
    }
}

/// Pull the duration out of `afinfo` output (`estimated duration: 12.345 sec`).
pub fn parse_afinfo_duration(text: &str) -> Option<f64> {
    text.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("estimated duration:")?;
        let value = rest.trim().strip_suffix("sec").unwrap_or(rest).trim();
        value.parse::<f64>().ok().filter(|v| v.is_finite() && *v >= 0.0)
    })
}

/// Whether an encoded file's duration is the WAV's, within what an AAC
/// container legitimately adds or hides (priming and padding frames, well
/// under 0.1 s) plus a small proportional allowance.
pub fn durations_match(wav_secs: f64, encoded_secs: f64) -> bool {
    if !(encoded_secs > 0.0) || !(wav_secs > 0.0) {
        return false;
    }
    (encoded_secs - wav_secs).abs() <= 0.5 + wav_secs * 0.001
}

/// Duration of an audio file as the app's own decoder (symphonia, the one
/// transcription uses) sees it, without decoding. `None` if it cannot open
/// the file or the container does not state a length.
pub fn probe_duration_secs(path: &Path) -> Option<f64> {
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::formats::{FormatOptions, TrackType};
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;

    let file = std::fs::File::open(path).ok()?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let format = symphonia::default::get_probe()
        .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
        .ok()?;
    let track = format.default_track(TrackType::Audio)?;
    let frames = track.num_frames?;
    let rate = track.codec_params.as_ref()?.audio()?.sample_rate?;
    (rate > 0 && frames > 0).then(|| frames as f64 / rate as f64)
}

/// Run a helper tool to completion with a deadline. Output is discarded
/// except stdout when `capture_stdout` is set (small, text).
fn run_tool(
    program: &str,
    args: &[&std::ffi::OsStr],
    timeout: Duration,
    capture_stdout: bool,
) -> Result<String, String> {
    use std::process::{Command, Stdio};
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(if capture_stdout { Stdio::piped() } else { Stdio::null() })
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start {}: {}", program, e))?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    use std::io::Read;
                    let _ = stdout.read_to_string(&mut out);
                }
                return if status.success() {
                    Ok(out)
                } else {
                    Err(format!("{} exited with {}", program, status))
                };
            }
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("{} timed out", program));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("{} failed: {}", program, e)),
        }
    }
}

/// Encode with `/usr/bin/afconvert`. Tries the chosen bit rate first, then
/// the encoder's own default (a rate it refuses for this sample rate must not
/// cost the user the compression).
fn afconvert(wav: &Path, out: &Path, sample_rate: u32) -> Result<(), String> {
    use std::ffi::OsStr;
    let timeout = Duration::from_secs(20 * 60);
    let bitrate = aac_bitrate_for(sample_rate).to_string();
    let with_rate: Vec<&OsStr> = vec![
        OsStr::new("-f"),
        OsStr::new("m4af"),
        OsStr::new("-d"),
        OsStr::new("aac"),
        OsStr::new("-b"),
        OsStr::new(&bitrate),
        wav.as_os_str(),
        out.as_os_str(),
    ];
    match run_tool("/usr/bin/afconvert", &with_rate, timeout, false) {
        Ok(_) => Ok(()),
        Err(first) => {
            let _ = std::fs::remove_file(out);
            let default_rate: Vec<&OsStr> = vec![
                OsStr::new("-f"),
                OsStr::new("m4af"),
                OsStr::new("-d"),
                OsStr::new("aac"),
                wav.as_os_str(),
                out.as_os_str(),
            ];
            run_tool("/usr/bin/afconvert", &default_rate, timeout, false)
                .map(|_| ())
                .map_err(|second| format!("{}; {}", first, second))
        }
    }
}

/// Duration according to `/usr/bin/afinfo`: a second opinion for files
/// symphonia cannot size.
fn afinfo_duration(path: &Path) -> Option<f64> {
    let out = run_tool("/usr/bin/afinfo", &[path.as_os_str()], Duration::from_secs(30), true).ok()?;
    parse_afinfo_duration(&out)
}

/// Duration of an encoded file: the app's decoder first (if it can open the
/// file, transcription can), Apple's tool second.
pub fn encoded_duration_secs(path: &Path) -> Option<f64> {
    probe_duration_secs(path).or_else(|| {
        if cfg!(target_os = "macos") {
            afinfo_duration(path)
        } else {
            None
        }
    })
}

/// What became of one WAV.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodeOutcome {
    /// The file to use from now on: the `.m4a`, or the untouched WAV.
    pub path: PathBuf,
    pub encoded: bool,
    /// Why the WAV was kept, when encoding was attempted and failed.
    pub warning: Option<String>,
}

fn set_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Encode `wav` next to itself as `<stem>.m4a`, verify, and only then delete
/// the WAV. `encode(wav, out)` produces the file; `probe(out)` reads its
/// duration back. Both are parameters so that the keep-or-delete decision,
/// the part that can lose a recording, is tested without an encoder.
pub fn encode_verified(
    wav: &Path,
    wav_secs: f64,
    encode: &dyn Fn(&Path, &Path) -> Result<(), String>,
    probe: &dyn Fn(&Path) -> Option<f64>,
) -> EncodeOutcome {
    let keep = |why: String| EncodeOutcome { path: wav.to_path_buf(), encoded: false, warning: Some(why) };
    let Some(stem) = wav.file_stem().and_then(|s| s.to_str()) else {
        return keep("unusable file name".into());
    };
    if !(wav_secs > 0.0) {
        return keep("nothing to encode".into());
    }
    let temp = wav.with_file_name(format!("{}.encoding.m4a", stem));
    let target = wav.with_file_name(format!("{}.m4a", stem));
    let _ = std::fs::remove_file(&temp);

    let fail = |why: String| {
        let _ = std::fs::remove_file(&temp);
        keep(why)
    };
    if let Err(e) = encode(wav, &temp) {
        return fail(e);
    }
    match std::fs::metadata(&temp) {
        Ok(m) if m.len() > 0 => {}
        _ => return fail("the encoder produced no file".into()),
    }
    let Some(encoded_secs) = probe(&temp) else {
        return fail("the encoded file could not be read back".into());
    };
    if !durations_match(wav_secs, encoded_secs) {
        return fail(format!(
            "the encoded file is {:.2} s long, the recording {:.2} s",
            encoded_secs, wav_secs
        ));
    }
    set_private(&temp);
    if let Err(e) = std::fs::rename(&temp, &target) {
        return fail(format!("could not put the encoded file in place: {}", e));
    }
    if let Err(e) = std::fs::remove_file(wav) {
        // Both files exist. A WAV beside an .m4a means "unverified" to the
        // recovery code, so keep to that rule: the WAV stays the recording.
        let _ = std::fs::remove_file(&target);
        return keep(format!("could not remove the WAV after encoding: {}", e));
    }
    EncodeOutcome { path: target, encoded: true, warning: None }
}

/// Compress a finished WAV on macOS; elsewhere the WAV is the result (no
/// encoder is assumed to exist, and that is not a warning).
pub fn encode_to_aac(wav: &Path, wav_secs: f64, sample_rate: u32) -> EncodeOutcome {
    if !cfg!(target_os = "macos") {
        return EncodeOutcome { path: wav.to_path_buf(), encoded: false, warning: None };
    }
    encode_verified(
        wav,
        wav_secs,
        &|input, output| afconvert(input, output, sample_rate),
        &encoded_duration_secs,
    )
}

#[cfg(test)]
mod tests {
    use super::super::wav::WavWriter;
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "notesage-encode-{}-{}-{:?}",
            tag,
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn wav(dir: &Path) -> PathBuf {
        let path = dir.join("audio.wav");
        let mut w = WavWriter::create(&path, 48_000, 1).unwrap();
        w.write_f32(&vec![0.1; 48_000]).unwrap();
        w.finalize().unwrap();
        path
    }

    fn fake_encoder(input: &Path, output: &Path) -> Result<(), String> {
        std::fs::copy(input, output).map(|_| ()).map_err(|e| e.to_string())
    }

    #[test]
    fn bitrate_follows_the_sample_rate() {
        assert_eq!(aac_bitrate_for(48_000), 64_000);
        assert_eq!(aac_bitrate_for(44_100), 64_000);
        assert_eq!(aac_bitrate_for(32_000), 48_000);
        assert_eq!(aac_bitrate_for(24_000), 32_000);
        assert_eq!(aac_bitrate_for(16_000), 24_000);
    }

    #[test]
    fn afinfo_duration_is_parsed_from_real_looking_output() {
        let out = "File:           /tmp/a.m4a\nFile type ID:   m4af\nNum Tracks:     1\n----\n\
Data format:     1 ch,  48000 Hz, aac  (0x00000000) 0 bits/channel, 0 bytes/packet, 1024 frames/packet, 0 bytes/frame\n\
                no channel layout.\nestimated duration: 3601.237333 sec\naudio bytes: 28809898\n";
        assert_eq!(parse_afinfo_duration(out), Some(3601.237333));
        assert_eq!(parse_afinfo_duration("  estimated duration: 0.5 sec  "), Some(0.5));
        assert_eq!(parse_afinfo_duration("estimated duration: nan sec"), None);
        assert_eq!(parse_afinfo_duration("estimated duration: -1 sec"), None);
        assert_eq!(parse_afinfo_duration("no duration here"), None);
    }

    #[test]
    fn duration_tolerance_is_tight_enough_to_catch_a_truncated_encode() {
        assert!(durations_match(3600.0, 3600.05));
        assert!(durations_match(3600.0, 3597.0), "AAC padding plus 0.1 %");
        assert!(!durations_match(3600.0, 3590.0), "ten seconds missing");
        assert!(!durations_match(3600.0, 1800.0));
        assert!(!durations_match(10.0, 0.0));
        assert!(!durations_match(10.0, f64::NAN));
        assert!(!durations_match(0.0, 0.0));
        assert!(durations_match(1.0, 1.04));
    }

    /// The decoder transcription uses can size a file the recorder wrote.
    #[test]
    fn probe_reads_the_duration_of_a_wav() {
        let dir = temp_dir("probe");
        let path = wav(&dir);
        let secs = probe_duration_secs(&path).expect("symphonia sizes a PCM WAV");
        assert!((secs - 1.0).abs() < 1e-6, "{secs}");
        assert_eq!(probe_duration_secs(&dir.join("missing.m4a")), None);
        std::fs::write(dir.join("junk.m4a"), b"not audio at all").unwrap();
        assert_eq!(probe_duration_secs(&dir.join("junk.m4a")), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// S2 happy path: verified, renamed into place, WAV removed.
    #[test]
    fn a_verified_encode_replaces_the_wav() {
        let dir = temp_dir("ok");
        let path = wav(&dir);
        let out = encode_verified(&path, 1.0, &fake_encoder, &|_| Some(1.02));
        assert_eq!(out, EncodeOutcome { path: dir.join("audio.m4a"), encoded: true, warning: None });
        assert!(dir.join("audio.m4a").is_file());
        assert!(!path.exists());
        assert!(!dir.join("audio.encoding.m4a").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join("audio.m4a")).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Never lose audio: every way the encode can go wrong keeps the WAV and
    /// leaves no half-made .m4a behind.
    #[test]
    fn any_doubt_keeps_the_wav() {
        let dir = temp_dir("doubt");
        let path = wav(&dir);
        let original = std::fs::read(&path).unwrap();
        let encoder_fails = |_: &Path, _: &Path| -> Result<(), String> { Err("afconvert exited with 1".into()) };
        let writes_nothing = |_: &Path, _: &Path| -> Result<(), String> { Ok(()) };
        let writes_empty = |_: &Path, out: &Path| -> Result<(), String> {
            std::fs::write(out, b"").map_err(|e| e.to_string())
        };
        let cases: Vec<(&dyn Fn(&Path, &Path) -> Result<(), String>, Option<f64>, f64, &str)> = vec![
            (&encoder_fails, Some(1.0), 1.0, "afconvert exited"),
            (&writes_nothing, Some(1.0), 1.0, "no file"),
            (&writes_empty, Some(1.0), 1.0, "no file"),
            (&fake_encoder, None, 1.0, "could not be read back"),
            (&fake_encoder, Some(0.4), 1.0, "0.40 s long"),
            (&fake_encoder, Some(0.0), 1.0, "0.00 s long"),
            (&fake_encoder, Some(1.0), 0.0, "nothing to encode"),
        ];
        for (encode, probed, wav_secs, expect) in cases {
            let out = encode_verified(&path, wav_secs, encode, &|_| probed);
            assert!(!out.encoded);
            assert_eq!(out.path, path);
            let warning = out.warning.unwrap();
            assert!(warning.contains(expect), "{warning} / {expect}");
            assert_eq!(std::fs::read(&path).unwrap(), original, "WAV untouched ({expect})");
            assert!(!dir.join("audio.m4a").exists(), "{expect}");
            assert!(!dir.join("audio.encoding.m4a").exists(), "{expect}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stale_partial_encode_is_overwritten() {
        let dir = temp_dir("stale");
        let path = wav(&dir);
        std::fs::write(dir.join("audio.encoding.m4a"), b"left over").unwrap();
        let out = encode_verified(&path, 1.0, &fake_encoder, &|_| Some(1.0));
        assert!(out.encoded);
        assert!(std::fs::metadata(dir.join("audio.m4a")).unwrap().len() > 9);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn off_macos_the_wav_is_kept_without_a_warning() {
        let dir = temp_dir("linux");
        let path = wav(&dir);
        let out = encode_to_aac(&path, 1.0, 48_000);
        assert_eq!(out, EncodeOutcome { path: path.clone(), encoded: false, warning: None });
        assert!(path.is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn helper_tools_are_bounded_and_report_failure() {
        use std::ffi::OsStr;
        let ok = run_tool("/bin/sh", &[OsStr::new("-c"), OsStr::new("echo hello")], Duration::from_secs(5), true);
        assert_eq!(ok.unwrap().trim(), "hello");
        let bad = run_tool("/bin/sh", &[OsStr::new("-c"), OsStr::new("exit 3")], Duration::from_secs(5), false);
        assert!(bad.unwrap_err().contains("exited with"));
        let slow = run_tool("/bin/sh", &[OsStr::new("-c"), OsStr::new("sleep 5")], Duration::from_millis(200), false);
        assert!(slow.unwrap_err().contains("timed out"));
        assert!(run_tool("/nonexistent/tool", &[], Duration::from_secs(1), false).is_err());
    }
}
