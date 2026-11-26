//! Transcription, apart from the Tauri commands themselves (those are in
//! `transcription.rs`): turning audio files into a transcript, importing
//! media, downloading models.
//!
//! Everything except `whisper_engine` is independent of Whisper and of Tauri
//! and is unit-tested as plain logic.

pub mod engine;
pub mod job;
pub mod jobs;
pub mod local_file;
pub mod media_import;
pub mod model_download;
pub mod multitrack;
pub mod pipeline;
pub mod preprocess;
pub mod progress;
pub mod resample;
pub mod whisper_engine;
