//! Shared types for the hardware-aware model-fit engine.
//!
//! These structs cross the Tauri IPC boundary, so the field names here must
//! stay in sync with the TypeScript interfaces in `src/lib/tauri.ts`.

use serde::{Deserialize, Serialize};

/// A snapshot of the host machine's inference-relevant hardware.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HardwareProfile {
    pub total_ram_bytes: u64,
    pub available_ram_bytes: u64,
    /// e.g. "Apple M3 Pro", or "unknown".
    pub chip_name: String,
    /// Memory bandwidth in GB/s — the dominant factor in decode speed.
    pub bandwidth_gbs: f32,
    /// Unified memory (Apple Silicon) vs discrete/host RAM.
    pub is_unified: bool,
    /// "metal" | "cpu".
    pub backend: String,
}

/// Capability facts read directly from a GGUF file's metadata header.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct GgufCapabilities {
    pub architecture: Option<String>,
    pub context_length: Option<u32>,
    /// True iff all three FIM token ids (prefix/suffix/middle) are present.
    pub has_fim_tokens: bool,
    /// True iff the chat template references tool/function calling.
    pub has_tool_template: bool,
    pub has_thinking: bool,
    pub gguf_version: u32,
    /// True when the metadata window was exceeded before parsing finished —
    /// flags reduce confidence (a missing template may just be off-window).
    pub truncated: bool,
}

/// A single model candidate to evaluate. Sizes/params come from the catalog
/// or HF search; quant from the filename.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelFitInput {
    pub id: String,
    pub file_size_bytes: u64,
    /// Total parameter count in billions (e.g. 7.0 for a 7B model).
    pub params_b: f32,
    /// Active parameter count in billions for MoE models (None for dense).
    #[serde(default)]
    pub active_params_b: Option<f32>,
    /// Quantization label, e.g. "Q4_K_M".
    pub quant: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Fit {
    Fits,
    Tight,
    WontFit,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Speed {
    Fast,
    Ok,
    Sluggish,
    Unusable,
}

/// The computed verdict for one model on one machine.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelFitResult {
    pub id: String,
    pub est_ram_bytes: u64,
    pub fit: Fit,
    pub est_tok_per_sec: f32,
    pub speed: Speed,
    /// `fit ∈ {Fits, Tight}` AND `tok/s ≥ floor`. Capability gating for a
    /// specific routing slot is applied on the frontend against
    /// `GgufCapabilities`.
    pub runnable: bool,
    /// Human-readable reasons for a non-runnable / tight verdict, surfaced in
    /// the disabled-card badge + tooltip.
    pub reasons: Vec<String>,
}
