// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderWithProviders,
  registerDefaultHandlers,
  screen,
  fireEvent,
  act,
} from '@/test/component-harness';
import { createMockEditor } from '@/test/mock-editor';
import { Toolbar } from '@/components/editor/Toolbar';
import type { Editor } from '@tiptap/react';

// ResizeObserver is used by Radix UI for tooltip/popover positioning but is
// not implemented in JSDOM. Provide a no-op class so Tooltip content renders.
class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// ---------------------------------------------------------------------------
// Mock sub-components that have their own complex dependencies
// ---------------------------------------------------------------------------

vi.mock('@/components/editor/toolbar/index', () => ({
  HeadingPicker: () => <div data-testid="heading-picker">H</div>,
  LinkButton: () => <button data-testid="link-button">Link</button>,
  TextColorPopover: () => null,
  HighlightPopover: () => null,
  TypographyPopover: () => null,
  MicButton: () => null,
  TableGridPicker: () => null,
  TableToolsPopover: () => null,
  CalloutPicker: () => null,
}));

// ---------------------------------------------------------------------------
// Regression tests for issue #64 — Save button tooltip with keyboard hint
// ---------------------------------------------------------------------------
//
// These tests lock in the acceptance criteria from #64:
//   - A Save button appears in the toolbar when `onSave` is provided
//   - The button's tooltip contains "Save" and the Cmd+S shortcut hint
//   - No Save button is rendered when `onSave` is omitted (conditional render)

describe('Toolbar — Save button', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Save button', () => {
    it('Save button shows tooltip with keyboard shortcut', async () => {
      // Fake timers let us skip past Toolbar's 300ms TooltipProvider delay
      // without waiting real time.
      vi.useFakeTimers();

      const editor = createMockEditor() as unknown as Editor;
      const onSave = vi.fn();

      renderWithProviders(
        <Toolbar editor={editor} onSave={onSave} />,
      );

      // A Save button must be present in the toolbar when onSave is provided.
      // RED before the fix: Toolbar has no onSave prop / Save button.
      const saveButton = screen.getByRole('button', { name: /save/i });
      expect(saveButton).toBeTruthy();

      // Hovering the button must reveal a tooltip that contains "Save" and
      // the Cmd+S keyboard shortcut hint.
      //
      // Radix Tooltip v1.2.8 opens on `onPointerMove` (not onPointerEnter).
      // Fire the event directly then advance past the inner TooltipProvider's
      // 300ms delay so the Radix open-timer fires and React re-renders.
      await act(async () => {
        fireEvent.pointerMove(saveButton);
        vi.advanceTimersByTime(400);
      });

      const tooltip = document.body.querySelector('[role="tooltip"]');
      expect(tooltip).toBeTruthy();
      expect(tooltip?.textContent).toMatch(/save/i);
      // Matches "Cmd+S", "⌘S", or similar shortcut representations
      expect(tooltip?.textContent).toMatch(/cmd\+s|⌘s|⌘.*s/i);
    });

    it('does not render Save button when onSave is omitted', () => {
      const editor = createMockEditor() as unknown as Editor;

      renderWithProviders(
        <Toolbar editor={editor} />,
      );

      // Without onSave, no Save button should appear (non-regression for
      // the conditional render introduced by the fix).
      const saveButton = screen.queryByRole('button', { name: /save/i });
      expect(saveButton).toBeNull();
    });
  });
});
