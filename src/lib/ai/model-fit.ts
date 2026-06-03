// Pure helpers for the hardware-aware model-fit feature: deriving engine
// inputs from catalog/HF model metadata and gating capabilities per routing
// slot. Kept side-effect free so they can be unit-tested without Tauri.

import type {
  LocalModelInfo,
  ModelFitInput,
  GgufCapabilities,
  ModelFitResult,
} from '@/lib/tauri';

/** Routing slots that impose a capability requirement on a model. */
export type RoutingSlot = 'chat' | 'completion' | 'agent';

/**
 * Parse a parameter-count label ("7B", "1.5B", "0.6B", "70 B") into billions.
 * Returns null when the string can't be understood.
 */
export function parseParamsB(parameters?: string | null): number | null {
  if (!parameters) return null;
  const m = parameters.match(/([\d.]+)\s*([bm])/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  // "M" (millions) → billions; "B" as-is.
  return m[2].toLowerCase() === 'm' ? value / 1000 : value;
}

/** Extract a quantization label from a GGUF filename. */
export function extractQuantFromFilename(filename?: string | null): string | null {
  if (!filename) return null;
  const m = filename.match(/\b(Q\d_K_[MS]|Q\d_\d|Q\d_K|IQ\d_[A-Z]+|F16|F32|BF16)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Build an engine input from a model's metadata. Returns null when essential
 * facts (file size, parameter count) are missing — such models can't be
 * scored and should fall back to "unverified".
 */
export function toModelFitInput(model: {
  id: string;
  size_bytes: number;
  parameters?: string | null;
  quantization?: string | null;
  filename?: string | null;
  active_params_b?: number | null;
}): ModelFitInput | null {
  const paramsB = parseParamsB(model.parameters);
  if (!model.size_bytes || model.size_bytes <= 0 || paramsB == null) return null;
  const quant =
    (model.quantization && model.quantization.toUpperCase()) ||
    extractQuantFromFilename(model.filename) ||
    'Q4_K_M';
  return {
    id: model.id,
    file_size_bytes: model.size_bytes,
    params_b: paramsB,
    active_params_b: model.active_params_b ?? null,
    quant,
  };
}

/** Whether a model with the given verified capabilities satisfies a slot. */
export function hasSlotCapability(
  caps: GgufCapabilities | undefined,
  slot: RoutingSlot,
): boolean {
  if (slot === 'chat') return true;
  if (!caps) return false; // unverified → don't recommend for a specific slot
  return slot === 'completion' ? caps.has_fim_tokens : caps.has_tool_template;
}

/**
 * Is a model recommendable for a slot on this machine? Runnable (fits + fast
 * enough) AND has the slot's required mechanism.
 */
export function isRecommendedForSlot(
  fit: ModelFitResult | undefined,
  caps: GgufCapabilities | undefined,
  slot: RoutingSlot,
): boolean {
  if (!fit || !fit.runnable) return false;
  return hasSlotCapability(caps, slot);
}

/** Compact human label for a verdict line, e.g. "✓ Fits · ~24 tok/s". */
export function fitSummary(fit: ModelFitResult | undefined): string | null {
  if (!fit) return null;
  const mark = fit.fit === 'fits' ? '✓ Fits' : fit.fit === 'tight' ? '~ Tight' : '✗ Won’t fit';
  if (fit.fit === 'wont-fit') {
    return fit.reasons[0] ?? mark;
  }
  return `${mark} · ~${Math.round(fit.est_tok_per_sec)} tok/s`;
}

/** Sort comparator: runnable first, then by estimated tok/s descending. */
export function compareByVerdict(
  a: { fit?: ModelFitResult },
  b: { fit?: ModelFitResult },
): number {
  const ar = a.fit?.runnable ? 1 : 0;
  const br = b.fit?.runnable ? 1 : 0;
  if (ar !== br) return br - ar;
  return (b.fit?.est_tok_per_sec ?? 0) - (a.fit?.est_tok_per_sec ?? 0);
}

// ---------------------------------------------------------------------------
// Phase 2 — runtime calibration helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Per-host correction factor = clamped median of measured/estimated across
 * models with both numbers. Identity (1.0) until at least 2 measured models
 * exist (one sample is noise). Clamped to [0.5, 2.0] so an outlier can't make
 * estimates absurd.
 */
export function medianRatioScale(
  pairs: { measured: number; estimated: number }[],
  min = 0.5,
  max = 2.0,
): number {
  const valid = pairs.filter((p) => p.measured > 0 && p.estimated > 0);
  if (valid.length < 2) return 1.0;
  return clamp(median(valid.map((p) => p.measured / p.estimated)), min, max);
}

export type FitSource = 'measured' | 'scaled-estimate' | 'estimate';

export interface FitDisplay {
  label: string;
  source: FitSource;
  /** Tooltip elaborating the source. */
  detail: string;
}

function fitMark(fit: ModelFitResult['fit']): string {
  return fit === 'fits' ? '✓ Fits' : fit === 'tight' ? '~ Tight' : '✗ Won’t fit';
}

/**
 * The display verdict for a model, preferring (in order): a direct measurement
 * (no `~`, "measured"), a host-scaled estimate, or the raw estimate.
 */
export function fitDisplay(
  fit: ModelFitResult | undefined,
  measurement?: { measuredTokPerSec: number; sampleCount: number; measuredAt: string },
  hostScale = 1,
): FitDisplay | null {
  if (measurement && measurement.measuredTokPerSec > 0) {
    const mark = fit ? fitMark(fit.fit) : '✓ Fits';
    const when = measurement.measuredAt.slice(0, 10);
    return {
      label: `${mark} · ${Math.round(measurement.measuredTokPerSec)} tok/s · measured`,
      source: 'measured',
      detail: `Measured on this Mac on ${when} over ${measurement.sampleCount} run${measurement.sampleCount === 1 ? '' : 's'}.`,
    };
  }
  if (!fit) return null;
  if (fit.fit === 'wont-fit') {
    return { label: fit.reasons[0] ?? '✗ Won’t fit', source: 'estimate', detail: fit.reasons.join('\n') };
  }
  const scaled = hostScale !== 1 ? fit.est_tok_per_sec * hostScale : fit.est_tok_per_sec;
  const source: FitSource = hostScale !== 1 ? 'scaled-estimate' : 'estimate';
  return {
    label: `${fitMark(fit.fit)} · ~${Math.round(scaled)} tok/s`,
    source,
    detail:
      source === 'scaled-estimate'
        ? 'Estimate, adjusted to your Mac’s measured performance. Sharpens further once you run this model.'
        : 'Estimated before download — sharpens once the model runs.',
  };
}

/** Resolve the best capability source for a model: local file if downloaded,
 *  else the HF resolve URL. Returns the args for `readGgufCapabilities`. */
export function capabilitySource(model: LocalModelInfo): {
  resolveUrl: string | null;
  localPath: string | null;
} {
  // Catalog/HF models carry a resolve URL in huggingface_url. Downloaded
  // models could be read locally, but we don't have the absolute path here;
  // the resolve URL works for both (header read is cheap).
  return { resolveUrl: model.huggingface_url || null, localPath: null };
}
