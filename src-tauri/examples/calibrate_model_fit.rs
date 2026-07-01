//! Calibration harness for the hardware-aware model-fit engine (PRD task #9).
//!
//! Reads a manifest describing the host hardware plus a list of locally
//! downloaded `.gguf` models. For each model it:
//!   1. Builds a `ModelFitInput` and runs `engine::evaluate` to get the
//!      ESTIMATED RAM + tok/s (using the UNCALIBRATED engine constants).
//!   2. Spawns the real bundled `llama-server` via `measure_model_runtime`
//!      to get the MEASURED tok/s + peak RSS.
//!   3. Computes per-model error and, in aggregate, proposes scaling factors
//!      for the engine constants.
//!
//! It ONLY proposes — it never writes to `engine.rs`. The operator applies the
//! proposed constants by hand (task #10).
//!
//! This requires real downloaded models and real Apple hardware (it spawns
//! `llama-server`), so it cannot run in CI or a sandbox.
//!
//! Run via `pnpm calibrate:model-fit [manifest.json]` or directly:
//!   cargo run --release --example calibrate_model_fit -- <manifest.json>

use std::fs;

use serde::Deserialize;

use tauri_app_lib::model_fit::calibration::{measure_model_runtime, RuntimeMeasurement};
use tauri_app_lib::model_fit::engine;
use tauri_app_lib::model_fit::types::{HardwareProfile, ModelFitInput, ModelFitResult};

const GB: f64 = 1e9;
const DEFAULT_MANIFEST: &str = "model-fit-calibration-manifest.json";
const DEFAULT_DECODE_TOKENS: u32 = 128;
const DEFAULT_PLANNING_CTX: u32 = 8192;

#[derive(Deserialize)]
struct ManifestHardware {
    total_ram_bytes: u64,
    available_ram_bytes: u64,
    chip_name: String,
    bandwidth_gbs: f32,
    is_unified: bool,
    backend: String,
}

impl From<&ManifestHardware> for HardwareProfile {
    fn from(h: &ManifestHardware) -> Self {
        HardwareProfile {
            total_ram_bytes: h.total_ram_bytes,
            available_ram_bytes: h.available_ram_bytes,
            chip_name: h.chip_name.clone(),
            bandwidth_gbs: h.bandwidth_gbs,
            is_unified: h.is_unified,
            backend: h.backend.clone(),
        }
    }
}

#[derive(Deserialize)]
struct ManifestModel {
    id: String,
    model_path: String,
    file_size_bytes: u64,
    params_b: f32,
    #[serde(default)]
    active_params_b: Option<f32>,
    quant: String,
    #[serde(default)]
    decode_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct Manifest {
    hardware: ManifestHardware,
    #[serde(default)]
    planning_ctx: Option<u32>,
    models: Vec<ManifestModel>,
}

/// One model's estimate-vs-measurement outcome.
struct Row {
    id: String,
    est: ModelFitResult,
    measured: Option<RuntimeMeasurement>,
    /// (measured - estimated) / measured * 100, when a measurement exists.
    tps_error_pct: Option<f32>,
    ram_error_pct: Option<f32>,
    /// measured/estimated, used to propose scaling factors.
    tps_ratio: Option<f32>,
    ram_ratio: Option<f32>,
}

#[tokio::main]
async fn main() {
    let manifest_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_MANIFEST.to_string());

    let raw = match fs::read_to_string(&manifest_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: cannot read manifest '{manifest_path}': {e}");
            std::process::exit(1);
        }
    };
    let manifest: Manifest = match serde_json::from_str(&raw) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("error: failed to parse manifest '{manifest_path}': {e}");
            std::process::exit(1);
        }
    };

    let profile: HardwareProfile = (&manifest.hardware).into();
    let planning_ctx = manifest.planning_ctx.unwrap_or(DEFAULT_PLANNING_CTX);

    println!("Model-fit calibration harness");
    println!("  manifest:     {manifest_path}");
    println!("  chip:         {}", profile.chip_name);
    println!(
        "  RAM:          {:.0} GB total / {:.0} GB available",
        profile.total_ram_bytes as f64 / GB,
        profile.available_ram_bytes as f64 / GB
    );
    println!("  bandwidth:    {} GB/s", profile.bandwidth_gbs);
    println!("  backend:      {}", profile.backend);
    println!("  planning_ctx: {planning_ctx}");
    println!("  models:       {}", manifest.models.len());
    println!();

    let mut rows: Vec<Row> = Vec::new();

    for m in &manifest.models {
        let decode_tokens = m.decode_tokens.unwrap_or(DEFAULT_DECODE_TOKENS);
        let input = ModelFitInput {
            id: m.id.clone(),
            file_size_bytes: m.file_size_bytes,
            params_b: m.params_b,
            active_params_b: m.active_params_b,
            quant: m.quant.clone(),
        };

        let est = engine::evaluate(&input, &profile, planning_ctx);

        print!("Measuring '{}' ({})... ", m.id, m.model_path);
        let measured = match measure_model_runtime(&m.model_path, decode_tokens, planning_ctx).await
        {
            Ok(rm) => {
                println!(
                    "ok — {:.2} tok/s, peak RSS {:.2} GB",
                    rm.measured_tok_per_sec,
                    rm.peak_ram_bytes as f64 / GB
                );
                Some(rm)
            }
            Err(e) => {
                println!("SKIPPED ({e})");
                None
            }
        };

        let (tps_error_pct, ram_error_pct, tps_ratio, ram_ratio) = match &measured {
            Some(rm) => {
                let mt = rm.measured_tok_per_sec;
                let et = est.est_tok_per_sec;
                let mr = rm.peak_ram_bytes as f32;
                let er = est.est_ram_bytes as f32;
                let tps_err = if mt != 0.0 {
                    Some((mt - et) / mt * 100.0)
                } else {
                    None
                };
                let ram_err = if mr != 0.0 {
                    Some((mr - er) / mr * 100.0)
                } else {
                    None
                };
                let tps_ratio = if et != 0.0 { Some(mt / et) } else { None };
                let ram_ratio = if er != 0.0 { Some(mr / er) } else { None };
                (tps_err, ram_err, tps_ratio, ram_ratio)
            }
            None => (None, None, None, None),
        };

        rows.push(Row {
            id: m.id.clone(),
            est,
            measured,
            tps_error_pct,
            ram_error_pct,
            tps_ratio,
            ram_ratio,
        });
    }

    println!();
    print_table(&rows);

    let median_tps_ratio = median(&collect_ratios(&rows, |r| r.tps_ratio));
    let median_ram_ratio = median(&collect_ratios(&rows, |r| r.ram_ratio));
    let median_tps_error = median(&collect_ratios(&rows, |r| r.tps_error_pct));
    let median_ram_error = median(&collect_ratios(&rows, |r| r.ram_error_pct));

    println!();
    if let Some(r) = median_tps_ratio {
        println!("Aggregate median measured/estimated tok/s ratio: {r:.3}");
    }
    if let Some(e) = median_tps_error {
        println!("Aggregate median tok/s error: {e:+.1}%");
    }
    if let Some(r) = median_ram_ratio {
        println!("Aggregate median measured/estimated RAM ratio:   {r:.3}");
    }
    if let Some(e) = median_ram_error {
        println!("Aggregate median RAM error:   {e:+.1}%");
    }

    let report = build_report(
        &manifest_path,
        &profile,
        planning_ctx,
        &rows,
        median_tps_ratio,
        median_ram_ratio,
        median_tps_error,
        median_ram_error,
    );

    let date = today();
    let out_path = format!("../docs/audits/{date}-model-fit-calibration.md");
    match fs::write(&out_path, &report) {
        Ok(()) => println!("\nReport written to {out_path}"),
        Err(e) => {
            // Fall back to the cwd if the docs path is not reachable.
            let fallback = format!("{date}-model-fit-calibration.md");
            match fs::write(&fallback, &report) {
                Ok(()) => println!(
                    "\nwarning: could not write {out_path} ({e}); wrote {fallback} instead"
                ),
                Err(e2) => eprintln!("error: failed to write report: {e}; fallback also failed: {e2}"),
            }
        }
    }
}

fn collect_ratios<F>(rows: &[Row], f: F) -> Vec<f32>
where
    F: Fn(&Row) -> Option<f32>,
{
    rows.iter().filter_map(f).collect()
}

fn median(values: &[f32]) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    let mut v: Vec<f32> = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 {
        Some(v[n / 2])
    } else {
        Some((v[n / 2 - 1] + v[n / 2]) / 2.0)
    }
}

fn fmt_opt_pct(v: Option<f32>) -> String {
    v.map(|x| format!("{x:+.1}%")).unwrap_or_else(|| "—".into())
}

fn print_table(rows: &[Row]) {
    println!(
        "{:<24} {:>10} {:>10} {:>10} {:>12} {:>12} {:>10}",
        "model", "est tok/s", "meas t/s", "t/s err", "est RAM GB", "meas RAM GB", "RAM err"
    );
    println!("{}", "-".repeat(92));
    for r in rows {
        let (meas_tps, meas_ram) = match &r.measured {
            Some(m) => (
                format!("{:.2}", m.measured_tok_per_sec),
                format!("{:.2}", m.peak_ram_bytes as f64 / GB),
            ),
            None => ("—".into(), "—".into()),
        };
        println!(
            "{:<24} {:>10.2} {:>10} {:>10} {:>12.2} {:>12} {:>10}",
            truncate(&r.id, 24),
            r.est.est_tok_per_sec,
            meas_tps,
            fmt_opt_pct(r.tps_error_pct),
            r.est.est_ram_bytes as f64 / GB,
            meas_ram,
            fmt_opt_pct(r.ram_error_pct),
        );
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        format!("{}…", &s[..n.saturating_sub(1)])
    }
}

#[allow(clippy::too_many_arguments)]
fn build_report(
    manifest_path: &str,
    profile: &HardwareProfile,
    planning_ctx: u32,
    rows: &[Row],
    median_tps_ratio: Option<f32>,
    median_ram_ratio: Option<f32>,
    median_tps_error: Option<f32>,
    median_ram_error: Option<f32>,
) -> String {
    let mut s = String::new();
    s.push_str(&format!("# Model-fit calibration — {}\n\n", today()));
    s.push_str(&format!("Manifest: `{manifest_path}`\n\n"));

    s.push_str("## Hardware\n\n");
    s.push_str("| Field | Value |\n| --- | --- |\n");
    s.push_str(&format!("| chip_name | {} |\n", profile.chip_name));
    s.push_str(&format!(
        "| total_ram_bytes | {} ({:.1} GB) |\n",
        profile.total_ram_bytes,
        profile.total_ram_bytes as f64 / GB
    ));
    s.push_str(&format!(
        "| available_ram_bytes | {} ({:.1} GB) |\n",
        profile.available_ram_bytes,
        profile.available_ram_bytes as f64 / GB
    ));
    s.push_str(&format!("| bandwidth_gbs | {} |\n", profile.bandwidth_gbs));
    s.push_str(&format!("| is_unified | {} |\n", profile.is_unified));
    s.push_str(&format!("| backend | {} |\n", profile.backend));
    s.push_str(&format!("| planning_ctx | {planning_ctx} |\n\n"));

    s.push_str("## Per-model results\n\n");
    s.push_str("| Model | Est tok/s | Measured tok/s | tok/s err | Est RAM (GB) | Measured RAM (GB) | RAM err |\n");
    s.push_str("| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n");
    for r in rows {
        let (mt, mr) = match &r.measured {
            Some(m) => (
                format!("{:.2}", m.measured_tok_per_sec),
                format!("{:.2}", m.peak_ram_bytes as f64 / GB),
            ),
            None => ("— (skipped)".into(), "—".into()),
        };
        s.push_str(&format!(
            "| {} | {:.2} | {} | {} | {:.2} | {} | {} |\n",
            r.id,
            r.est.est_tok_per_sec,
            mt,
            fmt_opt_pct(r.tps_error_pct),
            r.est.est_ram_bytes as f64 / GB,
            mr,
            fmt_opt_pct(r.ram_error_pct),
        ));
    }
    s.push('\n');

    s.push_str("## Aggregate\n\n");
    s.push_str("| Metric | Value |\n| --- | --- |\n");
    s.push_str(&format!(
        "| Median tok/s error | {} |\n",
        fmt_opt_pct(median_tps_error)
    ));
    s.push_str(&format!(
        "| Median RAM error | {} |\n",
        fmt_opt_pct(median_ram_error)
    ));
    s.push_str(&format!(
        "| Median measured/estimated tok/s ratio | {} |\n",
        median_tps_ratio
            .map(|r| format!("{r:.3}"))
            .unwrap_or_else(|| "—".into())
    ));
    s.push_str(&format!(
        "| Median measured/estimated RAM ratio | {} |\n\n",
        median_ram_ratio
            .map(|r| format!("{r:.3}"))
            .unwrap_or_else(|| "—".into())
    ));

    s.push_str("## Proposed constant adjustments\n\n");
    s.push_str(
        "> The harness only **proposes**. It never edits `engine.rs`. Apply these by hand (task #10) and re-run to confirm convergence.\n\n",
    );
    match median_tps_ratio {
        Some(r) if r.is_finite() && r > 0.0 => {
            s.push_str(&format!(
                "- **Speed.** The engine under/over-estimates tok/s by a median factor of `{r:.3}` (measured ÷ estimated). \
                 To centre the estimate, scale the backend factor for `backend = \"{}\"` by ~`{r:.3}`: \
                 e.g. `APPLE_BACKEND_FACTOR` (currently used for Metal) → `APPLE_BACKEND_FACTOR * {r:.3}`. \
                 If the ratio is consistent across quants, prefer adjusting the backend factor over `quant_efficiency`.\n",
                profile.backend
            ));
        }
        _ => {
            s.push_str(
                "- **Speed.** No usable measurements — cannot propose a tok/s scaling factor. Point `model_path` entries at real `.gguf` files and re-run.\n",
            );
        }
    }
    match median_ram_ratio {
        Some(r) if r.is_finite() && r > 0.0 => {
            s.push_str(&format!(
                "- **Memory.** Peak RSS is a median factor of `{r:.3}` of the estimate (measured ÷ estimated). \
                 If `> 1`, the engine under-counts — raise `FRAMEWORK_OVERHEAD_MB` and/or the activation terms (`ACT_FLOOR_MB`, `ACT_BYTES_PER_PARAM`). \
                 If `< 1`, the estimate is conservative; consider lowering the same terms. \
                 Note RSS includes mmap'd weight pages, so compare against the weights+overhead components, not KV alone.\n",
            ));
        }
        _ => {
            s.push_str(
                "- **Memory.** No usable peak-RSS measurements — cannot propose a RAM scaling factor.\n",
            );
        }
    }
    s.push('\n');
    s.push_str(
        "_Generated by `src-tauri/examples/calibrate_model_fit.rs` — re-run with `pnpm calibrate:model-fit [manifest.json]`._\n",
    );
    s
}

/// Current date as `YYYY-MM-DD` (UTC) via chrono (already a crate dependency).
fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}
