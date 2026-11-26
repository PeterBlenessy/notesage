//! Shapes that cross IPC, and the small enums the recorder is described in.
//!
//! Every struct here serialises with snake_case field names, matching the
//! `RecordingResult` the frontend already reads (`duration_secs`,
//! `sample_rate`).

use super::monitor::Role;
use serde::{Deserialize, Serialize};

/// What the user asked to record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Microphone,
    System,
    Both,
}

impl Source {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "microphone" => Ok(Source::Microphone),
            "system" => Ok(Source::System),
            "both" => Ok(Source::Both),
            other => Err(format!("Unknown recording source: {}", other)),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Source::Microphone => "microphone",
            Source::System => "system",
            Source::Both => "both",
        }
    }

    pub fn includes_mic(self) -> bool {
        matches!(self, Source::Microphone | Source::Both)
    }

    pub fn includes_system(self) -> bool {
        matches!(self, Source::System | Source::Both)
    }

    /// The tracks to capture, and the file each is written to. A single
    /// source is written straight to `audio.wav`; with both, each source gets
    /// its own file and `audio.wav` is mixed from them at stop.
    pub fn track_files(self) -> Vec<(Role, &'static str)> {
        match self {
            Source::Microphone => vec![(Role::Mic, "audio.wav")],
            Source::System => vec![(Role::System, "audio.wav")],
            Source::Both => vec![(Role::Mic, "mic.wav"), (Role::System, "system.wav")],
        }
    }
}

/// `kind` of a `recording-warning` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WarningKind {
    Silence,
    DeviceLost,
    DeviceChanged,
    WriteError,
    LowDisk,
    DroppedFrames,
}

impl WarningKind {
    pub fn as_str(self) -> &'static str {
        match self {
            WarningKind::Silence => "silence",
            WarningKind::DeviceLost => "device-lost",
            WarningKind::DeviceChanged => "device-changed",
            WarningKind::WriteError => "write-error",
            WarningKind::LowDisk => "low-disk",
            WarningKind::DroppedFrames => "dropped-frames",
        }
    }
}

/// Payload of the `recording-warning` event.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WarningPayload {
    pub kind: &'static str,
    pub message: String,
    pub fatal: bool,
    /// `"microphone"` or `"system"` when the warning concerns one source;
    /// absent otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<&'static str>,
}

impl WarningPayload {
    pub fn new(kind: WarningKind, role: Option<Role>, message: String, fatal: bool) -> Self {
        Self {
            kind: kind.as_str(),
            message,
            fatal,
            source: role.map(|r| match r {
                Role::Mic => "microphone",
                Role::System => "system",
            }),
        }
    }
}

/// One separately recorded source of a bundle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrackRef {
    /// `"mic"` or `"system"`.
    pub role: String,
    /// Absolute path.
    pub path: String,
}

/// Per-source peaks of a finished recording. `None` for a source that was
/// not recorded.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct TrackPeaks {
    pub mic: Option<f32>,
    pub system: Option<f32>,
}

/// Returned by `stop_recording`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingResult {
    /// The staging bundle folder.
    pub bundle_dir: String,
    /// The mix / primary audio: `audio.m4a`, or `audio.wav` when not encoded.
    pub audio_path: String,
    /// The separate source tracks. Only for source "both"; empty otherwise.
    pub tracks: Vec<TrackRef>,
    /// From the samples that reached the file (longest track).
    pub duration_secs: f64,
    pub peak: f32,
    pub sample_rate: u32,
    pub dropped_frames: u64,
    /// Machine-readable codes, optionally followed by `: detail`.
    pub warnings: Vec<String>,
    /// Same as `audio_path` (the field name older callers read).
    pub path: String,
    pub source: String,
    pub rms: f32,
    pub track_peaks: TrackPeaks,
}

/// Returned by `finalize_recording_bundle`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FinalizedBundle {
    pub bundle_dir: String,
    pub audio_path: String,
    pub tracks: Vec<TrackRef>,
}

/// One entry of `recover_orphan_recordings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OrphanRecording {
    pub bundle_dir: String,
    pub audio_path: String,
    pub tracks: Vec<TrackRef>,
    pub duration_secs: f64,
    /// RFC 3339 with offset, or `None` when it cannot be determined.
    pub started_at: Option<String>,
    pub source: Option<String>,
    /// `recording.json` is already in the bundle.
    pub has_manifest: bool,
}

/// Returned by `recording_preflight`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecordingPreflight {
    /// `"granted" | "denied" | "undetermined" | "unknown"`.
    pub microphone: String,
    /// `"available" | "unsupported" | "unknown"`.
    pub system_audio: String,
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub free_bytes: u64,
}

/// Returned by `get_recording_state`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RecordingStateInfo {
    pub recording: bool,
    pub paused: bool,
    pub source: Option<String>,
    pub started_at_ms: Option<u64>,
    pub elapsed_recorded_ms: u64,
    /// The backend stopped capturing by itself; `stop_recording` collects it.
    pub fatal: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_round_trips_and_rejects_unknown_values() {
        for s in ["microphone", "system", "both"] {
            assert_eq!(Source::parse(s).unwrap().as_str(), s);
        }
        assert_eq!(Source::parse("mic").unwrap_err(), "Unknown recording source: mic");
        assert!(Source::Both.includes_mic() && Source::Both.includes_system());
        assert!(!Source::Microphone.includes_system());
        assert!(!Source::System.includes_mic());
    }

    /// A single source is the primary audio itself; "both" keeps the sources
    /// apart so the transcript can tell "me" from "others".
    #[test]
    fn track_files_follow_the_bundle_layout() {
        assert_eq!(Source::Microphone.track_files(), vec![(Role::Mic, "audio.wav")]);
        assert_eq!(Source::System.track_files(), vec![(Role::System, "audio.wav")]);
        assert_eq!(
            Source::Both.track_files(),
            vec![(Role::Mic, "mic.wav"), (Role::System, "system.wav")]
        );
    }

    /// The frontend matches on these exact strings and field names.
    #[test]
    fn ipc_shapes_are_snake_case_and_kinds_are_kebab_case() {
        let w = WarningPayload::new(WarningKind::DeviceLost, Some(Role::Mic), "mic: x".into(), false);
        assert_eq!(
            serde_json::to_string(&w).unwrap(),
            r#"{"kind":"device-lost","message":"mic: x","fatal":false,"source":"microphone"}"#
        );
        let w = WarningPayload::new(WarningKind::Silence, Some(Role::System), "system: x".into(), false);
        assert_eq!(serde_json::to_value(&w).unwrap()["source"], "system");
        // Not about one source: the key is absent, not null.
        let w = WarningPayload::new(WarningKind::LowDisk, None, "x".into(), true);
        assert_eq!(serde_json::to_string(&w).unwrap(), r#"{"kind":"low-disk","message":"x","fatal":true}"#);
        let kinds: Vec<&str> = [
            WarningKind::Silence,
            WarningKind::DeviceLost,
            WarningKind::DeviceChanged,
            WarningKind::WriteError,
            WarningKind::LowDisk,
            WarningKind::DroppedFrames,
        ]
        .iter()
        .map(|k| k.as_str())
        .collect();
        assert_eq!(
            kinds,
            ["silence", "device-lost", "device-changed", "write-error", "low-disk", "dropped-frames"]
        );

        let state = serde_json::to_value(RecordingStateInfo::default()).unwrap();
        for key in ["recording", "paused", "source", "started_at_ms", "elapsed_recorded_ms"] {
            assert!(state.get(key).is_some(), "missing {key}");
        }
        let pre = serde_json::to_value(RecordingPreflight {
            microphone: "granted".into(),
            system_audio: "available".into(),
            input_device: None,
            output_device: Some("Speakers".into()),
            free_bytes: 1,
        })
        .unwrap();
        for key in ["microphone", "system_audio", "input_device", "output_device", "free_bytes"] {
            assert!(pre.get(key).is_some(), "missing {key}");
        }
        assert!(pre["input_device"].is_null());
        let level = serde_json::to_string(&super::super::monitor::LevelPayload { mic: Some(0.5), system: None }).unwrap();
        assert_eq!(level, r#"{"mic":0.5,"system":null}"#);
    }
}
