// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { createMockEditor } from '@/test/mock-editor';
import { Toolbar } from '@/components/editor/Toolbar';
import type { Editor } from '@tiptap/react';

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
// Tests
// ---------------------------------------------------------------------------
//
// Task #49 adds a `variant?: "inline" | "pill"` prop. `"inline"` is the
// default and must stay byte-identical to the pre-refactor legacy toolbar.
// `"pill"` wraps the same button row in a floating, backdrop-blurred pill
// with a `data-quiet-toolbar` hook so #50's fade-on-type CSS can target it.

describe('Toolbar — variants', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  describe('variant="inline" (default, legacy)', () => {
    it('wrapper has no pill attribute and keeps legacy flat-bar classes', () => {
      const editor = createMockEditor() as unknown as Editor;
      const { container } = renderWithProviders(
        <Toolbar editor={editor} />,
      );

      const wrapper = container.querySelector('[class*="h-9"]');
      expect(wrapper).toBeTruthy();
      expect(wrapper?.getAttribute('data-quiet-toolbar')).toBeNull();
      expect(wrapper?.className ?? '').not.toContain('rounded-full');
      expect(wrapper?.className ?? '').not.toContain('backdrop-blur');
    });

    it('explicit variant="inline" matches default behaviour', () => {
      const editor = createMockEditor() as unknown as Editor;
      const { container } = renderWithProviders(
        <Toolbar editor={editor} variant="inline" />,
      );

      const wrapper = container.querySelector('[data-quiet-toolbar]');
      expect(wrapper).toBeNull();
    });
  });

  describe('variant="pill" (quiet composer)', () => {
    it('wrapper has data-quiet-toolbar, rounded-full, and backdrop-blur', () => {
      const editor = createMockEditor() as unknown as Editor;
      const { container } = renderWithProviders(
        <Toolbar editor={editor} variant="pill" />,
      );

      const wrapper = container.querySelector('[data-quiet-toolbar]');
      expect(wrapper).toBeTruthy();
      const className = wrapper?.className ?? '';
      expect(className).toContain('rounded-full');
      expect(className).toContain('backdrop-blur-[14px]');
      expect(className).toContain('border');
    });

    it('wrapper does not carry a bottom border class', () => {
      const editor = createMockEditor() as unknown as Editor;
      const { container } = renderWithProviders(
        <Toolbar editor={editor} variant="pill" />,
      );

      const wrapper = container.querySelector('[data-quiet-toolbar]');
      expect(wrapper).toBeTruthy();
      // The legacy wrapping <div> in Editor.tsx owns `border-b`; the pill
      // itself must never use a bottom border. Check tokenised classes so
      // "border-border" doesn't false-positive against a substring match.
      const classes = (wrapper?.className ?? '').split(/\s+/);
      expect(classes).not.toContain('border-b');
    });

    it('renders the reduced 8-button set + overflow trigger in pill variant (#110, #112)', () => {
      const editor = createMockEditor() as unknown as Editor;
      const { container } = renderWithProviders(
        <Toolbar editor={editor} variant="pill" />,
      );

      // Pill variant renders: Heading | Quote | Task list | sep |
      // TextColor | Highlight | sep | Callout | Table | Typography | sep |
      // ••• overflow. With the popover/picker sub-components mocked to
      // `null`, only the two raw ToolbarButton entries (Quote, Task List)
      // and the overflow DropdownMenuTrigger button (#112) survive as
      // `<button>` elements; HeadingPicker remains as a stub div. The rest
      // collapse into nothing under the test mocks. Assert the count so the
      // test fails if a button is added or removed.
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(3);
    });

    it('does NOT render legacy buttons (Bold/Italic/Underline/etc.) in pill variant', () => {
      const editor = createMockEditor() as unknown as Editor;
      const { container } = renderWithProviders(
        <Toolbar editor={editor} variant="pill" />,
      );
      // The reduced set is much smaller than the inline variant. Inline
      // renders ~25 buttons; pill renders 2 raw buttons + composed pickers
      // + 1 overflow trigger (#112). Use button count as the safety net —
      // anything > 5 means legacy buttons leaked into the pill branch.
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeLessThanOrEqual(3);
    });

    it('renders the ••• overflow trigger in pill variant (#112)', () => {
      const editor = createMockEditor() as unknown as Editor;
      const { container } = renderWithProviders(
        <Toolbar editor={editor} variant="pill" />,
      );

      // The overflow DropdownMenuTrigger carries title="More" — assert by
      // attribute so we don't couple to icon class names. The icon itself
      // is `MoreHorizontal` from lucide.
      const overflowTrigger = container.querySelector('button[title="More"]');
      expect(overflowTrigger).toBeTruthy();
    });

    it('inline variant still renders the full button set (legacy parity)', () => {
      const editor = createMockEditor() as unknown as Editor;
      const { container } = renderWithProviders(
        <Toolbar editor={editor} variant="inline" />,
      );
      // Inline variant must stay byte-identical to today's behaviour. With
      // the same picker mocks in place, the inline variant renders ~22+
      // raw `<button>` entries (formatting, lists, alignment, undo/redo,
      // indent, mic, view-mode, etc.) — `> 15` is a comfortable lower bound
      // that catches accidental pruning.
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(15);
    });

    it('renders gracefully with editor=null (no crash, wrapper still tagged)', () => {
      const { container } = renderWithProviders(
        <Toolbar editor={null} variant="pill" />,
      );

      const wrapper = container.querySelector('[data-quiet-toolbar]');
      expect(wrapper).toBeTruthy();
    });
  });
});
