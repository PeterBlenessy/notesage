// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeAll } from 'vitest';

// cmdk uses ResizeObserver and scrollIntoView which jsdom doesn't provide
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // cmdk tries to scroll the active item into view
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});
import { renderWithProviders } from '@/test/component-harness';
import { ModelSelectionForm } from '@/components/settings/connection/ModelSelectionForm';
import type { Connection } from '@/lib/ai/connections';

// Minimal api_key connection — shows the Command-based model picker (not agent, not local)
const API_KEY_CONNECTION: Connection = {
  id: 'conn-anthropic',
  provider: 'anthropic',
  authMethod: 'api_key',
  status: 'connected',
  label: 'Claude',
  credentials: { type: 'api_key', credentialStored: true },
  capabilities: ['interactive'],
  createdAt: 1,
};

const BASE_PROPS = {
  connection: API_KEY_CONNECTION,
  model: 'claude-3-haiku',
  onModelChange: vi.fn(),
  temperature: 1.0,
  onTemperatureChange: vi.fn(),
  maxTokensIndex: null,
  onMaxTokensIndexChange: vi.fn(),
  localModelId: null,
  onLocalModelIdChange: vi.fn(),
  downloadedLocalModels: [],
  contextLength: 4096,
  onContextLengthChange: vi.fn(),
  gpuLayers: 0,
  onGpuLayersChange: vi.fn(),
  models: ['claude-3-haiku', 'claude-3-sonnet'],
  modelsLoading: false,
  modelsError: null,
  // Open the popover so the Command list (with Check icons) is in the DOM
  modelPopoverOpen: true,
  onModelPopoverOpenChange: vi.fn(),
  onFetchModels: vi.fn(),
  defaultModel: 'claude-3-5-haiku-latest',
  onCloseDialog: vi.fn(),
};

describe('ModelSelectionForm — model picker check prominence', () => {
  it('renders a Check with strokeWidth=2.5 on the selected model row', () => {
    renderWithProviders(<ModelSelectionForm {...BASE_PROPS} />);

    // The Check icons are in the CommandItem list (popover open = true)
    // They render as <svg class="lucide lucide-check ..."> with stroke-width attribute
    const checks = document.querySelectorAll('.lucide-check') as NodeListOf<SVGElement>;
    expect(checks.length, 'Expected at least one Check icon in the model picker').toBeGreaterThan(0);

    // At least one Check (the selected model's) should carry strokeWidth = 2.5
    const hasProminentCheck = Array.from(checks).some(
      (svg) => svg.getAttribute('stroke-width') === '2.5',
    );
    expect(hasProminentCheck, 'No Check icon with stroke-width="2.5" found; check needs strokeWidth={2.5}').toBe(true);
  });

  it('selected model Check has h-3.5 class', () => {
    renderWithProviders(<ModelSelectionForm {...BASE_PROPS} />);

    const checks = document.querySelectorAll('.lucide-check') as NodeListOf<SVGElement>;
    expect(checks.length).toBeGreaterThan(0);

    // The selected model Check should have h-3.5 (it already does in current code)
    // This assertion will pass even before the fix — included for completeness
    const hasH35 = Array.from(checks).some((svg) => svg.classList.contains('h-3.5'));
    expect(hasH35, 'Check icon should have h-3.5 class').toBe(true);
  });
});
