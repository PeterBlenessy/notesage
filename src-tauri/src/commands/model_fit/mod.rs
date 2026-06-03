//! Hardware-aware local model recommendation.
//!
//! Computes, per machine, whether a model will run (memory fit + bandwidth-
//! bound tok/s) and reads its feature capabilities straight from the GGUF
//! header — all before any weights are downloaded. See PRD
//! `docs/prds/2026-06-02-hardware-aware-model-recommendation.md`.

pub mod calibration;
pub mod engine;
pub mod gguf_header;
pub mod hardware;
pub mod types;

pub use hardware::detect_hardware_profile;

use types::{GgufCapabilities, HardwareProfile, ModelFitInput, ModelFitResult};

/// Estimate fit + speed for a set of model candidates on the given hardware.
#[tauri::command]
pub async fn estimate_model_fit(
    candidates: Vec<ModelFitInput>,
    profile: HardwareProfile,
    planning_ctx: u32,
) -> Result<Vec<ModelFitResult>, String> {
    Ok(candidates
        .iter()
        .map(|m| engine::evaluate(m, &profile, planning_ctx))
        .collect())
}

/// Read GGUF feature capabilities from a remote `resolve` URL (Range-GET, no
/// weight download) or a local file path.
#[tauri::command]
pub async fn read_gguf_capabilities(
    resolve_url: Option<String>,
    local_path: Option<String>,
) -> Result<GgufCapabilities, String> {
    gguf_header::read_capabilities(resolve_url, local_path).await
}
