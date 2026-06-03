/**
 * Tests for the opt-in calibration share builder, including the privacy
 * regression locks: the payload carries ONLY whitelisted fields, and the share
 * path ships no GitHub write credential (browser-URL only).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildCalibrationShare,
  buildSharePayload,
  payloadToIssueUrl,
} from '../calibration-share';
import type { HardwareProfile } from '@/lib/tauri';
import type { RuntimeMeasurement } from '@/stores/model-fit-measurement-store';

const profile: HardwareProfile = {
  total_ram_bytes: 36_000_000_000,
  available_ram_bytes: 28_000_000_000,
  chip_name: 'Apple M3 Pro',
  bandwidth_gbs: 150,
  is_unified: true,
  backend: 'metal',
};

function meas(modelId: string, tps: number, ramGb: number, runs: number): RuntimeMeasurement {
  return {
    modelId,
    measuredTokPerSec: tps,
    peakRamBytes: ramGb * 1e9,
    decodeTokens: 128,
    sampleCount: runs,
    measuredAt: '2026-06-03T00:00:00.000Z',
    tpsSamples: [tps],
  };
}

describe('buildSharePayload — field whitelist (privacy lock)', () => {
  it('emits exactly the whitelisted top-level + row fields, nothing else', () => {
    const payload = buildSharePayload(profile, [meas('qwen3-8b', 31.2, 6.1, 4)], '0.46.0');
    expect(Object.keys(payload).sort()).toEqual(
      ['app_version', 'bandwidth_gbs', 'chip', 'measurements', 'total_ram_gb'].sort(),
    );
    expect(Object.keys(payload.measurements[0]).sort()).toEqual(
      ['measured_tok_per_sec', 'model', 'peak_ram_gb', 'runs'].sort(),
    );
  });

  it('does NOT leak measurement internals (tpsSamples, decodeTokens, measuredAt) or any path/identifier', () => {
    const payload = buildSharePayload(profile, [meas('qwen3-8b', 31.2, 6.1, 4)], '0.46.0');
    const blob = JSON.stringify(payload);
    expect(blob).not.toContain('tpsSamples');
    expect(blob).not.toContain('decodeTokens');
    expect(blob).not.toContain('measuredAt');
    expect(blob).not.toMatch(/\/Users\/|\/home\/|C:\\/); // no filesystem paths
  });

  it('rounds numbers and converts RAM to GB', () => {
    const payload = buildSharePayload(profile, [meas('m', 31.27, 6.14, 2)], '0.46.0');
    expect(payload.total_ram_gb).toBe(36);
    expect(payload.bandwidth_gbs).toBe(150);
    expect(payload.measurements[0].measured_tok_per_sec).toBe(31.3);
    expect(payload.measurements[0].peak_ram_gb).toBe(6.1);
  });

  it('caps shared models and sorts by sampleCount desc', () => {
    const many = Array.from({ length: 20 }, (_, i) => meas(`m${i}`, 10, 5, i));
    const payload = buildSharePayload(profile, many, '0.46.0');
    expect(payload.measurements.length).toBe(12);
    // Highest sampleCount (19) should be first.
    expect(payload.measurements[0].model).toBe('m19');
  });
});

describe('payloadToIssueUrl', () => {
  it('targets the public new-issue form with template + label + data', () => {
    const url = payloadToIssueUrl(buildSharePayload(profile, [meas('m', 20, 5, 1)], '0.46.0'));
    expect(url).toContain('https://github.com/peterblenessy/notesage/issues/new');
    expect(url).toContain('template=model-fit-calibration.yml');
    expect(url).toContain('labels=calibration-data');
    expect(url).toContain('data=');
  });
});

describe('buildCalibrationShare', () => {
  it('returns payload + markdown + issueUrl and performs no network call', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const share = buildCalibrationShare(profile, [meas('m', 20, 5, 1)], '0.46.0');
    expect(share.payload).toBeDefined();
    expect(share.markdown).toContain('chip: Apple M3 Pro');
    expect(share.issueUrl).toContain('issues/new');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// Privacy regression lock: the share module must ship NO write credential and
// must not talk to the GitHub API — it only builds a browser URL.
describe('no shipped GitHub write credential (privacy lock)', () => {
  it('calibration-share source contains no token / auth header / api endpoint', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../calibration-share.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/api\.github\.com/);
    expect(src).not.toMatch(/[Aa]uthorization/);
    expect(src).not.toMatch(/ghp_[A-Za-z0-9]/); // classic PAT prefix
    expect(src).not.toMatch(/github_pat_/); // fine-grained PAT prefix
    expect(src).not.toMatch(/\bBearer\b/);
  });
});
