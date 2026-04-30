// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  registerDefaultHandlers,
  fireEvent,
  cleanup,
} from '@/test/component-harness';
import { createMockEditor } from '@/test/mock-editor';
import { Toolbar } from '@/components/editor/Toolbar';
import type { Editor } from '@tiptap/react';

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

describe('Toolbar – onSave prop', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  it('renders a button with the lucide Save icon when onSave is provided', () => {
    const editor = createMockEditor() as unknown as Editor;
    const onSave = vi.fn();

    const { container: baseline } = renderWithProviders(<Toolbar editor={editor} />);
    const baseCount = baseline.querySelectorAll('button').length;
    cleanup();

    const { container } = renderWithProviders(<Toolbar editor={editor} onSave={onSave} />);
    const withSaveCount = container.querySelectorAll('button').length;

    expect(withSaveCount).toBe(baseCount + 1);
  });

  it('tooltip content renders "Save (cmd+S)"', () => {
    const editor = createMockEditor() as unknown as Editor;
    const onSave = vi.fn();
    const { container } = renderWithProviders(<Toolbar editor={editor} onSave={onSave} />);

    // The ToolbarButton passes title as HTML title attribute (matching the pattern
    // used by the pill overflow button in Toolbar.pill.test.tsx).
    const saveButton = container.querySelector('button[title="Save (cmd+S)"]');
    expect(saveButton).not.toBeNull();
  });

  it('clicking the button calls onSave once', () => {
    const editor = createMockEditor() as unknown as Editor;
    const onSave = vi.fn();
    const { container } = renderWithProviders(<Toolbar editor={editor} onSave={onSave} />);

    const saveButton = container.querySelector('button[title="Save (cmd+S)"]') as HTMLElement;
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not render Save button when onSave is omitted', () => {
    const editor = createMockEditor() as unknown as Editor;
    const onSave = vi.fn();

    const { container: withSave } = renderWithProviders(<Toolbar editor={editor} onSave={onSave} />);
    const countWith = withSave.querySelectorAll('button').length;
    cleanup();

    const { container: withoutSave } = renderWithProviders(<Toolbar editor={editor} />);
    const countWithout = withoutSave.querySelectorAll('button').length;

    expect(countWithout).toBeLessThan(countWith);
  });
});
