//! cpal: the only code in the recorder that touches the audio stack.
//!
//! Everything a recording does over time lives in [`super::session`], which
//! is tested against simulated devices. This file is the adapter that lets
//! that loop open real ones, and it is deliberately thin, because it cannot
//! be run without audio hardware.
//!
//! # System audio (C6 / N1)
//!
//! cpal 0.17 records system audio when an INPUT stream is built on an OUTPUT
//! device that has no inputs (`coreaudio/macos/device.rs`, `build_input_stream_raw`:
//! `if self.supports_input() { … } else { LoopbackDevice::from_device(self) }`).
//! It creates a CoreAudio process tap on that device plus a private aggregate
//! device, and reads from the aggregate. Facts taken from that source:
//!
//! - Needs macOS 14.2 and `NSAudioCaptureUsageDescription` in Info.plist.
//!   The command gates on the OS version before this module is ever asked to
//!   open the system source (on older systems the tap symbols do not exist).
//! - The tap-creation status is ignored by cpal, and a denied "System Audio
//!   Recording" permission does not fail anything: the stream runs and
//!   delivers silence. Denial is therefore visible only as silence.
//! - An output device that ALSO has inputs (some USB interfaces and headsets)
//!   takes the other branch: cpal would silently record that device's input.
//!   `open` refuses such a device rather than record the wrong thing.
//! - The aggregate device has a fixed UID, so only one loopback stream can
//!   exist at a time: the session always drops the old stream before it
//!   opens a new one.
//! - The tap follows one device. When the default output changes (AirPods
//!   connect), audio moves to the new device and the old tap goes quiet while
//!   still calling back, so the session polls `default_output_id` and reopens.
//! - For the default INPUT device cpal replaces the error callback with a
//!   no-op and merely pauses the stream when the device dies
//!   (`macos/device.rs`, `macos/mod.rs` `DisconnectManager`), so for the
//!   microphone the session's stall watchdog is the only signal there is.

use super::monitor::Role;
use super::owner::{CaptureEvents, CaptureOwner, CaptureShared};
use super::ring::ring;
use super::session::{deliver, run_session, AudioBackend, CallbackShared, Opened, Timing};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub use super::session::CaptureConfig;

fn device_label(device: &cpal::Device) -> String {
    use cpal::traits::DeviceTrait;
    device
        .description()
        .map(|d| d.name().to_string())
        .unwrap_or_else(|_| "unknown device".to_string())
}

/// Names of the default input and output devices, for the preflight.
pub fn default_device_names() -> (Option<String>, Option<String>) {
    use cpal::traits::HostTrait;
    let host = cpal::default_host();
    (
        host.default_input_device().as_ref().map(device_label),
        host.default_output_device().as_ref().map(device_label),
    )
}

/// The real audio stack.
struct CpalBackend;

impl AudioBackend for CpalBackend {
    type Stream = cpal::Stream;

    fn open(
        &mut self,
        role: Role,
        base: Instant,
        shared: &Arc<CaptureShared>,
    ) -> Result<Opened<cpal::Stream>, String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let (device, default_config) = match role {
            Role::Mic => {
                let device = host.default_input_device().ok_or("No microphone available")?;
                let config = device
                    .default_input_config()
                    .map_err(|e| format!("Failed to get default audio config: {}", e))?;
                (device, config)
            }
            Role::System => {
                let device = host
                    .default_output_device()
                    .ok_or("No audio output device available")?;
                // cpal taps the output only when the device has no inputs
                // (the same test as its `supports_input`); otherwise it would
                // record the device's own input and call it system audio.
                let has_inputs = device
                    .supported_input_configs()
                    .map(|mut configs| configs.next().is_some())
                    .unwrap_or(false);
                if has_inputs {
                    return Err(format!(
                        "System audio cannot be captured from this output device ({}): it is also an input device. Choose a different output device.",
                        device_label(&device)
                    ));
                }
                let config = device
                    .default_output_config()
                    .map_err(|e| format!("Failed to get the output device's audio config: {}", e))?;
                (device, config)
            }
        };

        let config = cpal::StreamConfig {
            channels: default_config.channels(),
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };
        let sample_rate: u32 = config.sample_rate;
        let channels: u16 = config.channels;
        if sample_rate == 0 || channels == 0 {
            return Err("Failed to get default audio config: device reports no format".into());
        }

        // Two seconds of headroom: the capture thread drains every 20 ms, so
        // this fills only if that thread is held up for two whole seconds.
        let (mut producer, consumer) = ring(sample_rate as usize * channels as usize * 2);
        let callback = Arc::new(CallbackShared::new());
        let cb_data = callback.clone();
        let cb_err = callback.clone();
        let shared_cb = shared.clone();

        let stream = device
            .build_input_stream(
                &config,
                // REAL-TIME THREAD. `deliver` is the whole body: see its docs.
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    deliver(&cb_data, &shared_cb.pause, &mut producer, base, data);
                },
                move |err: cpal::StreamError| {
                    // Not the real-time thread. Logged, and flagged so the
                    // session reopens at once instead of waiting out the
                    // stall timeout.
                    log::error!(
                        target: "notesage::recording",
                        "Audio stream error ({}): {}", role.as_str(), err
                    );
                    cb_err.report_error();
                },
                None,
            )
            .map_err(|e| format!("Failed to build audio stream: {}", e))?;
        stream
            .play()
            .map_err(|e| format!("Failed to start audio stream: {}", e))?;

        Ok(Opened {
            stream,
            consumer,
            sample_rate,
            channels,
            callback,
            device_id: device.id().ok().map(|id| id.to_string()),
            device_name: device_label(&device),
        })
    }

    fn default_output_id(&mut self) -> Option<String> {
        use cpal::traits::{DeviceTrait, HostTrait};
        cpal::default_host()
            .default_output_device()
            .and_then(|d| d.id().ok())
            .map(|id| id.to_string())
    }
}

/// Start capturing. Blocks until every requested stream is open (or one
/// failed, in which case nothing is left open) and returns the owner. Call
/// from a blocking thread, not from an async worker (C7).
pub fn spawn_capture(
    config: CaptureConfig,
    events: Box<dyn CaptureEvents>,
) -> Result<CaptureOwner, String> {
    let (setup_tx, setup_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let track_files = config.track_files.clone();
    let source = config.source;
    let bundle_dir = config.bundle_dir.clone();
    let mut owner = CaptureOwner::spawn_with(source, bundle_dir, track_files, move |shared| {
        // The backend is created on the capture thread: cpal streams are not
        // `Send` on every platform, and they live and die here (#264).
        run_session(
            CpalBackend,
            shared,
            config,
            events,
            setup_tx,
            Timing::default(),
            &super::preflight::free_bytes,
        )
    })?;
    match setup_rx.recv() {
        Ok(Ok(())) => Ok(owner),
        Ok(Err(e)) => {
            // The thread has already released whatever it had opened.
            let _ = owner.stop(Duration::from_secs(5));
            Err(e)
        }
        Err(_) => {
            let _ = owner.stop(Duration::from_secs(5));
            Err("Audio thread died during setup".to_string())
        }
    }
}
