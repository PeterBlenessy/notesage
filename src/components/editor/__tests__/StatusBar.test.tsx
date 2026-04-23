// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderWithProviders,
  registerDefaultHandlers,
  act,
  fireEvent,
} from '@/test/component-harness';
import { createMockEditor } from '@/test/mock-editor';
import type { Editor } from '@tiptap/core';
import { StatusBar } from '@/components/editor/StatusBar';
import { useEditorStore } from '@/stores/editor-store';

// ---------------------------------------------------------------------------
// Store reset + helpers
// ---------------------------------------------------------------------------

function resetEditorStore() {
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    recentFiles: [],
    scrollPositions: {},
    externalChanges: {},
    pendingCloseTabId: null,
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
}

function openTab(path: string, fileName: string, lastSavedAt?: number) {
  const id = 'tab-' + path;
  useEditorStore.setState((s) => ({
    tabs: [
      ...s.tabs,
      {
        id,
        filePath: path,
        fileName,
        isDirty: false,
        content: '',
        contentLoaded: true,
        frontmatter: null,
        fileType: 'markdown',
        lastSavedAt,
      },
    ],
    activeTabId: id,
  }));
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Task #52 adds a `variant?: "full" | "quiet"` prop. `"full"` is the default
// and must stay byte-identical to today's rich status strip. `"quiet"` renders
// the simplified `<words> · saved Ns ago · ⌘K ask · ⌘. focus` strip used by
// the quiet-composer layout; clicking or pressing Enter/Space calls
// `onOpenTray` (the tray popover itself lands in task #53).

describe('StatusBar — variants', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetEditorStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Full variant (legacy) — regression checks
  // -------------------------------------------------------------------------
  describe('variant="full" (default, legacy)', () => {
    it('renders legacy word-count label when an editor is provided', () => {
      const editor = createMockEditor({ text: 'hello world' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);

      const text = container.textContent ?? '';
      expect(text).toContain('2 words');
      expect(text).toMatch(/min read/);
    });

    it('does not mark the root as the quiet strip', () => {
      const editor = createMockEditor({ text: 'a' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} />);

      expect(container.querySelector('[data-quiet-status]')).toBeNull();
    });

    it('explicit variant="full" matches default behaviour', () => {
      const editor = createMockEditor({ text: 'one two three' }) as unknown as Editor;
      const { container } = renderWithProviders(<StatusBar editor={editor} variant="full" />);

      expect(container.textContent ?? '').toContain('3 words');
      expect(container.querySelector('[data-quiet-status]')).toBeNull();
    });

    it('renders the editor=null placeholder strip (shortcuts button visible)', () => {
      const onShortcutsOpen = vi.fn();
      const { container } = renderWithProviders(
        <StatusBar editor={null} onShortcutsOpen={onShortcutsOpen} />,
      );

      // Status role present, no quiet-status slot.
      expect(container.querySelector('[role="status"]')).toBeTruthy();
      expect(container.querySelector('[data-quiet-status]')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Quiet variant (task #52)
  // -------------------------------------------------------------------------
  describe('variant="quiet"', () => {
    it('root is tagged with data-quiet-status and role="button"', () => {
      const editor = createMockEditor({ text: 'hello' }) as unknown as Editor;
      openTab('/x/y.md', 'y.md');
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      const root = container.querySelector('[data-quiet-status]') as HTMLElement | null;
      expect(root).toBeTruthy();
      expect(root?.getAttribute('role')).toBe('button');
      expect(root?.getAttribute('aria-label')).toBe('Open status tray');
    });

    it('reserves an empty dot slot for task #54', () => {
      const editor = createMockEditor({ text: 'hi' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      const slot = container.querySelector('[data-status-dots]');
      expect(slot).toBeTruthy();
      expect(slot?.children.length).toBe(0);
    });

    it('renders word count + keyboard hints', () => {
      const editor = createMockEditor({ text: 'one two three four five' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      const text = container.textContent ?? '';
      expect(text).toContain('5 words');
      expect(text).toContain('\u2318K');
      expect(text).toContain('ask');
      expect(text).toContain('\u2318.');
      expect(text).toContain('focus');
    });

    it('uses the singular "word" label for a single word', () => {
      const editor = createMockEditor({ text: 'solo' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      expect(container.textContent ?? '').toContain('1 word');
      expect(container.textContent ?? '').not.toContain('1 words');
    });

    it('shows "saved Ns ago" when an active tab has lastSavedAt', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      openTab('/p/file.md', 'file.md', Date.now() - 3_000);

      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      expect(container.textContent ?? '').toMatch(/saved \ds ago/);
    });

    it('shows an em-dash placeholder when lastSavedAt is undefined', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      openTab('/p/file.md', 'file.md' /* no lastSavedAt */);

      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      expect(container.textContent ?? '').toContain('\u2014');
      expect(container.textContent ?? '').not.toMatch(/saved \d/);
    });

    it('calls onOpenTray when the strip is clicked', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const onOpenTray = vi.fn();
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" onOpenTray={onOpenTray} />,
      );

      const root = container.querySelector('[data-quiet-status]') as HTMLElement;
      fireEvent.click(root);
      expect(onOpenTray).toHaveBeenCalledTimes(1);
    });

    it('calls onOpenTray on Enter and Space', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const onOpenTray = vi.fn();
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" onOpenTray={onOpenTray} />,
      );

      const root = container.querySelector('[data-quiet-status]') as HTMLElement;
      fireEvent.keyDown(root, { key: 'Enter' });
      fireEvent.keyDown(root, { key: ' ' });
      expect(onOpenTray).toHaveBeenCalledTimes(2);
    });

    it('updates the saved label as time advances (fake timers)', () => {
      vi.useFakeTimers();
      const start = new Date('2026-04-22T12:00:00Z').getTime();
      vi.setSystemTime(start);

      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      openTab('/p/file.md', 'file.md', start);

      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );

      expect(container.textContent ?? '').toContain('saved 0s ago');

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(container.textContent ?? '').toContain('saved 10s ago');
    });

    // ---------------------------------------------------------------------
    // Task #53 regression: quiet strip now owns the StatusTray popover.
    // The tray must not be in the DOM until the strip is activated, and
    // activating the strip must surface it.
    // ---------------------------------------------------------------------
    it('does not mount the StatusTray popover content until the strip is clicked', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      renderWithProviders(<StatusBar editor={editor} variant="quiet" />);
      // Radix renders Popover content in a portal — inspect document.body.
      expect(document.body.textContent ?? '').not.toContain('Completions');
    });

    it('mounts the StatusTray popover after the strip is clicked', () => {
      const editor = createMockEditor({ text: 'x' }) as unknown as Editor;
      const { container } = renderWithProviders(
        <StatusBar editor={editor} variant="quiet" />,
      );
      const strip = container.querySelector('[data-quiet-status]') as HTMLElement;
      fireEvent.click(strip);
      // All four group headers should now be in the DOM (portal).
      const text = document.body.textContent ?? '';
      expect(text).toContain('Completions');
      expect(text).toContain('Comments');
      expect(text).toContain('Session');
      expect(text).toContain('Help');
    });
  });
});
