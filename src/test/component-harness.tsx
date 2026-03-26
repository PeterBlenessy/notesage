// @vitest-environment jsdom

import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import '@/test/tauri-mock';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
  emitMockEvent,
  registerDefaultHandlers,
} from '@/test/tauri-mock';

// Re-export everything from RTL
export * from '@testing-library/react';

// Re-export tauri-mock utilities for convenience
export {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
  emitMockEvent,
  registerDefaultHandlers,
};

/**
 * Wraps the given UI in all required providers for component testing.
 * Currently wraps with TooltipProvider (delayDuration=0 for instant tooltips in tests).
 */
function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={0}>
      {children}
    </TooltipProvider>
  );
}

/**
 * Render a component wrapped in all required providers (TooltipProvider, etc.).
 * Accepts the same options as RTL's `render()`.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}
