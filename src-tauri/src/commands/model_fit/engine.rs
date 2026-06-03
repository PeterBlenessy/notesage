//! Fit + speed estimation engine.
//!
//! Pure functions, no I/O — unit-tested below. The constants are
//! **UNCALIBRATED**: they are ported from `Andyyyy64/whichllm`
//! (`engine/vram.py`, `engine/performance.py`) and validated/tuned by the
//! calibration harness (task #10) before any estimate is presented to a user
//! as anything but a `~`-prefixed estimate.

use super::types::{Fit, HardwareProfile, ModelFitInput, ModelFitResult, Speed};

const GB: f64 = 1e9;
const MB: f64 = 1e6;

// --- UNCALIBRATED constants — see task #10 calibration harness -------------
// Memory estimate components.
const KV_MB_PER_BPARAM_PER_KCTX: f64 = 3.5; // MB per B-active-params per 1K ctx (FP16 KV)
const ACT_FLOOR_MB: f64 = 400.0; // activation/scratch floor
const ACT_BYTES_PER_PARAM: f64 = 0.08; // activation scaling
const ACT_MB_PER_4KCTX: f64 = 150.0; // activation ctx scaling
const FRAMEWORK_OVERHEAD_MB: f64 = 500.0; // llama.cpp allocations

// Apple unified memory: reserve for OS + Notesage editor itself.
const UNIFIED_USABLE_FRACTION: f64 = 0.75;
const TIGHT_CEILING_FRACTION: f64 = 0.90; // above usable but below this = "tight"

// Speed: bandwidth-bound decode. tok/s = BW * quantEff * backend / readBytes
const APPLE_BACKEND_FACTOR: f64 = 0.82; // Metal kernel quality vs theoretical
const CPU_BACKEND_FACTOR: f64 = 0.45; // non-Metal fallback
// ---------------------------------------------------------------------------

/// Minimum tok/s for a model to count as "runnable" for interactive use.
pub const MIN_USABLE_TPS: f32 = 2.0;

fn quant_efficiency(quant: &str) -> f64 {
    match quant.to_uppercase().as_str() {
        "Q4_K_M" | "Q4_K_S" | "Q4_0" | "Q4_1" => 0.55,
        "Q5_K_M" | "Q5_K_S" | "Q5_0" | "Q5_1" => 0.50,
        "Q6_K" => 0.48,
        "Q8_0" => 0.45,
        "F16" | "BF16" => 0.35,
        "F32" => 0.30,
        _ => 0.50,
    }
}

/// Estimated peak resident memory in bytes: weights + KV cache + activation +
/// framework overhead. MoE models scale KV/activation on *active* params.
pub fn estimate_memory_bytes(m: &ModelFitInput, planning_ctx: u32) -> u64 {
    let effective_params_b = m.active_params_b.unwrap_or(m.params_b) as f64;
    let kv_params_b = match m.active_params_b {
        Some(a) => (a as f64) * 4.0,
        None => m.params_b as f64,
    };
    let weights = m.file_size_bytes as f64; // mmap'd weights ≈ file size
    let kv = KV_MB_PER_BPARAM_PER_KCTX * kv_params_b * (planning_ctx as f64 / 1000.0) * MB;
    let act = (ACT_FLOOR_MB
        + ACT_BYTES_PER_PARAM * effective_params_b * GB / MB
        + ACT_MB_PER_4KCTX * (planning_ctx as f64 / 4096.0))
        * MB;
    let overhead = FRAMEWORK_OVERHEAD_MB * MB;
    (weights + kv + act + overhead).round() as u64
}

/// Bandwidth-bound decode estimate in tok/s. MoE reads only active experts per
/// token (with a kernel-bound floor so the estimate doesn't run away).
pub fn estimate_tok_per_sec(m: &ModelFitInput, profile: &HardwareProfile) -> f32 {
    let quant_eff = quant_efficiency(&m.quant);
    let mut read_bytes = m.file_size_bytes as f64;
    if let Some(active) = m.active_params_b {
        if m.params_b > 0.0 {
            let ratio = (active / m.params_b) as f64;
            let floor = (0.05 * (profile.bandwidth_gbs as f64 / 256.0).max(1.0)).min(0.25);
            read_bytes = m.file_size_bytes as f64 * ratio.max(floor);
        }
    }
    if read_bytes <= 0.0 {
        return 0.0;
    }
    let backend_factor = if profile.backend == "metal" {
        APPLE_BACKEND_FACTOR
    } else {
        CPU_BACKEND_FACTOR
    };
    let bw = profile.bandwidth_gbs as f64 * GB;
    ((bw * quant_eff * backend_factor) / read_bytes) as f32
}

pub fn classify_fit(est_bytes: u64, profile: &HardwareProfile) -> Fit {
    let total = profile.total_ram_bytes as f64;
    let est = est_bytes as f64;
    if est <= total * UNIFIED_USABLE_FRACTION {
        Fit::Fits
    } else if est <= total * TIGHT_CEILING_FRACTION {
        Fit::Tight
    } else {
        Fit::WontFit
    }
}

pub fn classify_speed(tps: f32) -> Speed {
    if tps >= 10.0 {
        Speed::Fast
    } else if tps >= 5.0 {
        Speed::Ok
    } else if tps >= 2.0 {
        Speed::Sluggish
    } else {
        Speed::Unusable
    }
}

/// Full verdict for one model on one machine.
pub fn evaluate(m: &ModelFitInput, profile: &HardwareProfile, planning_ctx: u32) -> ModelFitResult {
    let est = estimate_memory_bytes(m, planning_ctx);
    let fit = classify_fit(est, profile);
    let tps = estimate_tok_per_sec(m, profile);
    let speed = classify_speed(tps);
    let runnable = matches!(fit, Fit::Fits | Fit::Tight) && tps >= MIN_USABLE_TPS;

    let mut reasons = Vec::new();
    let est_gb = est as f64 / GB;
    let have_gb = profile.total_ram_bytes as f64 / GB;
    match fit {
        Fit::WontFit => reasons.push(format!(
            "Won't fit — needs ~{:.0} GB, you have {:.0} GB",
            est_gb, have_gb
        )),
        Fit::Tight => reasons.push(format!(
            "Tight — needs ~{:.0} GB of {:.0} GB",
            est_gb, have_gb
        )),
        Fit::Fits => {}
    }
    if tps < MIN_USABLE_TPS {
        reasons.push(format!("~{:.0} tok/s — too slow on this Mac", tps));
    }

    ModelFitResult {
        id: m.id.clone(),
        est_ram_bytes: est,
        fit,
        est_tok_per_sec: tps,
        speed,
        runnable,
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(ram_gb: u64, bw: f32) -> HardwareProfile {
        HardwareProfile {
            total_ram_bytes: ram_gb * 1_000_000_000,
            available_ram_bytes: ram_gb * 1_000_000_000,
            chip_name: "test".into(),
            bandwidth_gbs: bw,
            is_unified: true,
            backend: "metal".into(),
        }
    }

    fn dense(id: &str, params_b: f32, file_gb: f64, quant: &str) -> ModelFitInput {
        ModelFitInput {
            id: id.into(),
            file_size_bytes: (file_gb * 1e9) as u64,
            params_b,
            active_params_b: None,
            quant: quant.into(),
        }
    }

    #[test]
    fn small_model_fits_on_16gb() {
        let m = dense("qwen3-4b", 4.0, 2.5, "Q4_K_M");
        let r = evaluate(&m, &profile(16, 100.0), 8192);
        assert_eq!(r.fit, Fit::Fits);
        assert!(r.runnable);
    }

    #[test]
    fn seventy_b_wont_fit_on_16gb_but_fits_on_128gb() {
        let m = dense("llama-70b", 70.0, 42.5, "Q4_K_M");
        let small = evaluate(&m, &profile(16, 100.0), 8192);
        assert_eq!(small.fit, Fit::WontFit);
        assert!(!small.runnable);
        assert!(small.reasons.iter().any(|s| s.contains("Won't fit")));

        let big = evaluate(&m, &profile(128, 819.0), 8192);
        assert_ne!(big.fit, Fit::WontFit);
    }

    #[test]
    fn raising_ram_flips_fit() {
        // ~30B Q4 model (~18 GB on disk): won't fit on 16GB, fits on 64GB.
        let m = dense("big-30b", 30.0, 18.0, "Q4_K_M");
        let small = classify_fit(estimate_memory_bytes(&m, 8192), &profile(16, 100.0));
        let large = classify_fit(estimate_memory_bytes(&m, 8192), &profile(64, 410.0));
        assert_eq!(small, Fit::WontFit);
        assert_eq!(large, Fit::Fits);
    }

    #[test]
    fn moe_decodes_faster_than_dense_of_similar_size() {
        let prof = profile(64, 410.0);
        // MoE: 26B total / 4B active, large on disk.
        let moe = ModelFitInput {
            id: "gemma-moe".into(),
            file_size_bytes: (16.8 * 1e9) as u64,
            params_b: 26.0,
            active_params_b: Some(4.0),
            quant: "Q4_K_M".into(),
        };
        // Dense of similar on-disk size.
        let dense_big = dense("dense-27b", 27.0, 16.5, "Q4_K_M");
        let moe_tps = estimate_tok_per_sec(&moe, &prof);
        let dense_tps = estimate_tok_per_sec(&dense_big, &prof);
        assert!(
            moe_tps > dense_tps,
            "MoE {moe_tps} should beat dense {dense_tps}"
        );
    }

    #[test]
    fn slow_model_is_unusable_and_not_runnable() {
        // Big dense model on a low-bandwidth machine → very low tok/s.
        let m = dense("big", 70.0, 42.5, "Q4_K_M");
        let r = evaluate(&m, &profile(128, 60.0), 8192);
        assert_eq!(r.speed, Speed::Unusable);
        assert!(!r.runnable);
    }

    #[test]
    fn speed_classification_boundaries() {
        assert_eq!(classify_speed(12.0), Speed::Fast);
        assert_eq!(classify_speed(7.0), Speed::Ok);
        assert_eq!(classify_speed(3.0), Speed::Sluggish);
        assert_eq!(classify_speed(1.0), Speed::Unusable);
    }
}
