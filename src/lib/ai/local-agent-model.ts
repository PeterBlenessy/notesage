// Tool-calling model recommendation for the Local Agent setup flow (task #16).
//
// Agentic chat needs a model that can actually call tools, so the recommendation
// is restricted to `supports_tool_calling` models. Within that set we prefer:
//   1. an already-downloaded model that fits in RAM (no download needed),
//   2. else the largest tool-calling model that fits the RAM budget,
//   3. else the smallest tool-calling model (sub-budget — the dialog warns).
// Pure so the ranking is unit-testable without the store.

import type { LocalModelInfo } from '@/lib/tauri';

/** Fraction of total RAM we let a model's working set occupy. */
const RAM_BUDGET_FRACTION = 0.7;

export function recommendToolCallingModel(
  models: LocalModelInfo[],
  totalRamBytes: number | null,
): string | null {
  const candidates = models.filter((m) => m.supports_tool_calling);
  if (candidates.length === 0) return null;

  const budget = totalRamBytes != null ? totalRamBytes * RAM_BUDGET_FRACTION : null;
  const fits = (m: LocalModelInfo) => budget == null || m.ram_required_bytes <= budget;

  // 1. Downloaded + fits — instant, no download.
  const downloadedFitting = candidates
    .filter((m) => m.downloaded && fits(m))
    .sort((a, b) => b.ram_required_bytes - a.ram_required_bytes);
  if (downloadedFitting.length > 0) return downloadedFitting[0].id;

  // 2. Largest tool-calling model that fits the budget (best quality within RAM).
  const fitting = candidates
    .filter(fits)
    .sort((a, b) => b.ram_required_bytes - a.ram_required_bytes);
  if (fitting.length > 0) return fitting[0].id;

  // 3. Nothing fits — smallest tool-calling model (the dialog shows the warning).
  return [...candidates].sort((a, b) => a.ram_required_bytes - b.ram_required_bytes)[0].id;
}
