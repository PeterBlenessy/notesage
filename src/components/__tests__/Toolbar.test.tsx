// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { createMockEditor } from '@/test/mock-editor';
import { Toolbar } from '@/components/editor/Toolbar';

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

describe('Toolbar', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  it('renders nothing useful when editor is null', () => {
    const { container } = renderWithProviders(<Toolbar editor={null} />);
    // With no editor, the heading picker shouldn't render
    expect(screen.queryByTestId('heading-picker')).toBeNull();
    // But the wrapper div should exist
    expect(container.firstChild).toBeTruthy();
  });

  it('renders formatting buttons when editor is provided', () => {
    const editor = createMockEditor() as any;
    const { container } = renderWithProviders(<Toolbar editor={editor} />);

    // Toolbar should render multiple buttons (formatting actions)
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(5);

    // HeadingPicker mock should be present
    expect(screen.getByTestId('heading-picker')).toBeTruthy();
  });

  it('renders bold button that calls editor chain on click', () => {
    const editor = createMockEditor() as any;
    const { container } = renderWithProviders(<Toolbar editor={editor} />);

    // Click the first formatting button after undo/redo (Bold)
    const buttons = container.querySelectorAll('button');
    buttons[2].click();
    expect(editor.chain).toHaveBeenCalled();
  });

  it('does not render formatting buttons in source mode', () => {
    const editor = createMockEditor() as any;
    const { container } = renderWithProviders(
      <Toolbar editor={editor} viewMode="source" />,
    );

    // In source mode, HeadingPicker should not render
    expect(screen.queryByTestId('heading-picker')).toBeNull();

    // Should have fewer buttons (only view mode toggle, word wrap, etc.)
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeLessThan(5);
  });

  it('shows heading picker in wysiwyg mode', () => {
    const editor = createMockEditor() as any;
    renderWithProviders(<Toolbar editor={editor} viewMode="wysiwyg" />);

    expect(screen.getByTestId('heading-picker')).toBeTruthy();
  });

  it('calls editor.isActive for formatting state', () => {
    const editor = createMockEditor({ activeStates: { bold: true } }) as any;
    renderWithProviders(<Toolbar editor={editor} />);

    // isActive should have been called during render
    expect(editor.isActive).toHaveBeenCalled();
  });
});
