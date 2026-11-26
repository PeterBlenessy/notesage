//! Speaker identification: who spoke when in a recording, and (opt-in)
//! recognising remembered voices. Everything runs on this Mac; no audio and
//! no voice data leaves it. See `docs/features/speakers.md`.
//!
//! Layout:
//! - `fbank`, `vad`, `cluster`, `turns`, `assign`, `analyze`, `matching`:
//!   plain logic, unit-tested, no model and no Tauri;
//! - `engine`: the seam to the voice model (plus the fake used in tests);
//! - `tract_engine`: the real model (ONNX run by `tract`, pure Rust);
//! - `models`: which model files, from where;
//! - `profiles`: remembered voices on disk (biometric data: read its rules);
//! - `clip`: short sample clips for playback;
//! - `commands`: the Tauri commands.

pub mod analyze;
pub mod assign;
pub mod clip;
pub mod cluster;
pub mod commands;
pub mod engine;
pub mod fbank;
pub mod matching;
pub mod models;
pub mod profiles;
pub mod tract_engine;
pub mod turns;
pub mod vad;
