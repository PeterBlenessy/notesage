// Builds the opt-in community-calibration share payload. PURE + side-effect
// free, so the field whitelist can be asserted by a test. The payload carries
// ONLY hardware specs + model facts + measured numbers — never paths, prompts,
// document content, or any app-added identifier. See PRD
// 2026-06-03-model-fit-runtime-calibration (community share section).

import type { HardwareProfile } from '@/lib/tauri';
import type { RuntimeMeasurement } from '@/stores/model-fit-measurement-store';

const GITHUB_REPO = 'peterblenessy/notesage';
const ISSUE_TEMPLATE = 'model-fit-calibration.yml';
/** Cap the shared set so the prefilled URL stays well under length limits. */
const MAX_SHARED_MODELS = 12;

export interface SharedModelRow {
  model: string;
  measured_tok_per_sec: number;
  peak_ram_gb: number;
  runs: number;
}

export interface CalibrationSharePayload {
  chip: string;
  total_ram_gb: number;
  bandwidth_gbs: number;
  app_version: string;
  measurements: SharedModelRow[];
}

export interface CalibrationShare {
  payload: CalibrationSharePayload;
  markdown: string;
  issueUrl: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Assemble the whitelist-only payload from the profile + local measurements. */
export function buildSharePayload(
  profile: HardwareProfile,
  measurements: RuntimeMeasurement[],
  appVersion: string,
): CalibrationSharePayload {
  const rows: SharedModelRow[] = [...measurements]
    .sort((a, b) => b.sampleCount - a.sampleCount)
    .slice(0, MAX_SHARED_MODELS)
    .map((m) => ({
      model: m.modelId,
      measured_tok_per_sec: round1(m.measuredTokPerSec),
      peak_ram_gb: round1(m.peakRamBytes / 1e9),
      runs: m.sampleCount,
    }));

  return {
    chip: profile.chip_name,
    total_ram_gb: Math.round(profile.total_ram_bytes / 1e9),
    bandwidth_gbs: Math.round(profile.bandwidth_gbs),
    app_version: appVersion,
    measurements: rows,
  };
}

/** Render the payload as a human-readable markdown block (also the copy text). */
export function payloadToMarkdown(p: CalibrationSharePayload): string {
  const lines: string[] = [
    `chip: ${p.chip}`,
    `total_ram_gb: ${p.total_ram_gb}`,
    `bandwidth_gbs: ${p.bandwidth_gbs}`,
    `app_version: ${p.app_version}`,
    `measurements:`,
  ];
  for (const m of p.measurements) {
    lines.push(
      `  - model: ${m.model}   measured_tok_per_sec: ${m.measured_tok_per_sec}   peak_ram_gb: ${m.peak_ram_gb}   runs: ${m.runs}`,
    );
  }
  return lines.join('\n');
}

/** Prefilled GitHub Issue Form URL — opened in the user's browser; the app
 *  never posts (no embedded credential). */
export function payloadToIssueUrl(p: CalibrationSharePayload): string {
  const body = payloadToMarkdown(p);
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title: `Calibration data: ${p.chip}`,
    labels: 'calibration-data',
    // The issue form's "data" textarea id is `data` (see the YAML template).
    data: body,
  });
  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
}

export function buildCalibrationShare(
  profile: HardwareProfile,
  measurements: RuntimeMeasurement[],
  appVersion: string,
): CalibrationShare {
  const payload = buildSharePayload(profile, measurements, appVersion);
  return {
    payload,
    markdown: payloadToMarkdown(payload),
    issueUrl: payloadToIssueUrl(payload),
  };
}
