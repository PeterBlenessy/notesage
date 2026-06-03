//! Calibration measurement — a DEV/OPERATOR tool, intentionally **not** a
//! Tauri command (it is unreachable from the IPC surface, so a compromised
//! renderer cannot drive a real model spawn). It is invoked only by the
//! `calibrate_model_fit` example (`pnpm calibrate:model-fit`).
//!
//! Spawns the real bundled `llama-server` against a model file, runs a fixed
//! decode workload, and reports measured decode tok/s + peak resident memory.
//! Used to ground the engine's UNCALIBRATED constants (PRD task #10).

use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::super::model_providers::binary_resolution::{
    find_available_port, resolve_llama_server_binary,
};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RuntimeMeasurement {
    pub model_path: String,
    pub measured_tok_per_sec: f32,
    pub peak_ram_bytes: u64,
    pub decode_tokens: u32,
}

/// Sample a process's resident set size (bytes) via `ps`. Returns 0 on failure
/// (the process may have exited). Avoids depending on the sysinfo process API.
fn sample_rss_bytes(pid: u32) -> u64 {
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output();
    if let Ok(out) = out {
        if out.status.success() {
            if let Ok(s) = String::from_utf8(out.stdout) {
                if let Ok(kb) = s.trim().parse::<u64>() {
                    return kb * 1024; // ps reports RSS in KiB
                }
            }
        }
    }
    0
}

/// Start `llama-server` for `model_path`, run a fixed decode workload, and
/// measure tok/s + peak RSS. The server is killed before returning.
pub async fn measure_model_runtime(
    model_path: &str,
    decode_tokens: u32,
    planning_ctx: u32,
) -> Result<RuntimeMeasurement, String> {
    if !std::path::Path::new(model_path).exists() {
        return Err(format!("model file not found: {model_path}"));
    }

    let port = find_available_port(8290).ok_or("no free port for calibration server")?;
    let binary = resolve_llama_server_binary()?;

    let mut cmd = tokio::process::Command::new(&binary);
    cmd.args([
        "--model",
        model_path,
        "--port",
        &port.to_string(),
        "--ctx-size",
        &planning_ctx.to_string(),
        "--n-gpu-layers",
        "-1",
        "--host",
        "127.0.0.1",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    // Same library-path injection as the production server launcher.
    if let Some(binary_dir) = binary.parent() {
        let lib_dir = binary_dir.join("lib");
        if lib_dir.exists() {
            #[cfg(target_os = "macos")]
            cmd.env("DYLD_LIBRARY_PATH", &lib_dir);
            #[cfg(target_os = "linux")]
            cmd.env("LD_LIBRARY_PATH", &lib_dir);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start llama-server: {e}"))?;
    let pid = child.id();

    let client = reqwest::Client::new();
    let base = format!("http://127.0.0.1:{port}");

    // Wait for /health (up to ~60s — large models load slowly).
    let mut ready = false;
    for _ in 0..120 {
        if let Ok(r) = client.get(format!("{base}/health")).send().await {
            if r.status().is_success() {
                ready = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if !ready {
        let _ = child.kill().await;
        return Err("llama-server did not become healthy in time".into());
    }

    // Background RSS sampler.
    let stop = Arc::new(AtomicBool::new(false));
    let peak = Arc::new(AtomicU64::new(0));
    let sampler = {
        let stop = stop.clone();
        let peak = peak.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                if let Some(pid) = pid {
                    let rss = sample_rss_bytes(pid);
                    peak.fetch_max(rss, Ordering::Relaxed);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        })
    };

    let chat = format!("{base}/v1/chat/completions");

    // Warm-up so model load / first-token cost doesn't pollute the rate.
    let _ = client
        .post(&chat)
        .json(&serde_json::json!({
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 8,
            "stream": false,
        }))
        .send()
        .await;

    // Measured workload.
    let resp = client
        .post(&chat)
        .json(&serde_json::json!({
            "messages": [{
                "role": "user",
                "content": "Write a detailed multi-paragraph explanation of how memory bandwidth bounds large language model token generation speed."
            }],
            "max_tokens": decode_tokens,
            "stream": false,
            "cache_prompt": false,
        }))
        .send()
        .await
        .map_err(|e| format!("decode request failed: {e}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("failed to parse server response: {e}"))?;

    stop.store(true, Ordering::Relaxed);
    let _ = sampler.join();
    let _ = child.kill().await;

    // llama.cpp reports decode rate under `timings.predicted_per_second`.
    let tps = json
        .get("timings")
        .and_then(|t| t.get("predicted_per_second"))
        .and_then(|v| v.as_f64())
        .ok_or("response missing timings.predicted_per_second")? as f32;

    Ok(RuntimeMeasurement {
        model_path: model_path.to_string(),
        measured_tok_per_sec: tps,
        peak_ram_bytes: peak.load(Ordering::Relaxed),
        decode_tokens,
    })
}
