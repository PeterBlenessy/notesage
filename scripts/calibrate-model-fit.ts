#!/usr/bin/env tsx
/**
 * Thin wrapper for the model-fit calibration harness.
 *
 * Shells out to the Rust example binary, which spawns the real bundled
 * llama-server against the models named in the manifest. Requires real
 * downloaded models + real Apple hardware — it cannot run in CI or a sandbox.
 *
 *   pnpm calibrate:model-fit [manifest.json]
 *
 * The optional manifest path is forwarded verbatim to the example. When
 * omitted, the example defaults to `model-fit-calibration-manifest.json`
 * (resolved relative to the src-tauri working directory).
 */
import { spawnSync } from "node:child_process";

const forwarded = process.argv.slice(2);

const result = spawnSync(
  "cargo",
  ["run", "--release", "--example", "calibrate_model_fit", "--", ...forwarded],
  { cwd: "src-tauri", stdio: "inherit" },
);

if (result.error) {
  console.error(`Failed to launch cargo: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
