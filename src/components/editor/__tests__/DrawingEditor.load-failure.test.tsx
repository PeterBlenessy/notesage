// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';

/**
 * The drawing editor used to open an EMPTY canvas when the drawing could not
 * be loaded, and Done then saved that empty canvas over the drawing. The
 * shape library had the same problem on every change (audit 2026-11-22 §10).
 */

vi.mock('@excalidraw/excalidraw/index.css', () => ({}));

interface FakeExcalidrawProps {
  excalidrawAPI: (api: unknown) => void;
  onLibraryChange: (items: unknown[]) => void;
}
let lastProps: FakeExcalidrawProps | null = null;
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: FakeExcalidrawProps) => {
    lastProps = props;
    props.excalidrawAPI({
      getSceneElements: () => [],
      getAppState: () => ({ viewBackgroundColor: '#fff' }),
      getFiles: () => ({}),
      updateLibrary: () => {},
      getLibraryItems: () => [],
    });
    return <div data-testid="excalidraw-canvas" />;
  },
}));

vi.mock('@/lib/excalidraw-export', () => ({
  exportDrawingToSvg: vi.fn(async () => document.createElementNS('http://www.w3.org/2000/svg', 'svg')),
}));

const storage = vi.hoisted(() => ({
  loadDrawingStrict: vi.fn(),
  loadLibraryStrict: vi.fn(),
  loadLibrary: vi.fn(async () => []),
  saveDrawing: vi.fn(async () => {}),
  saveSvgPreview: vi.fn(async () => {}),
  saveLibrary: vi.fn(async () => {}),
  importLibraryFile: vi.fn(async () => 0),
}));
vi.mock('@/lib/drawing-storage', () => storage);

import { DrawingEditor } from '@/components/editor/DrawingEditor';
import { useSettingsStore } from '@/stores/settings-store';

function renderEditor(onDone = vi.fn(), drawingJson: string | null = null) {
  render(
    <DrawingEditor
      drawingId="abc"
      drawingJson={drawingJson}
      projectRoot="/proj"
      initialHeight={300}
      onDone={onDone}
    />,
  );
  return onDone;
}

describe('DrawingEditor — a drawing that fails to load', () => {
  beforeEach(() => {
    lastProps = null;
    // An explicit theme: "system" asks `window.matchMedia`, which jsdom lacks.
    useSettingsStore.setState({ theme: 'light' });
    Object.values(storage).forEach((fn) => fn.mockClear());
    storage.loadDrawingStrict.mockResolvedValue({ type: 'excalidraw', elements: [] });
    storage.loadLibraryStrict.mockResolvedValue([]);
    vi.mocked(toast.warning).mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows an error instead of an empty canvas, and Done saves nothing', async () => {
    storage.loadDrawingStrict.mockRejectedValue(new Error('Operation not permitted'));
    const onDone = renderEditor();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Operation not permitted');
    expect(screen.queryByTestId('excalidraw-canvas')).toBeNull();

    // The button closes; it must not write an empty scene over the drawing.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
    expect(storage.saveDrawing).not.toHaveBeenCalled();
    expect(storage.saveSvgPreview).not.toHaveBeenCalled();
  });

  it('treats unparseable inline JSON the same way', async () => {
    const onDone = renderEditor(vi.fn(), '{"type":"excalidraw","elements":[');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByTestId('excalidraw-canvas')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
  });

  it('opens the canvas and saves on Done when the drawing loads', async () => {
    const onDone = renderEditor();
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(storage.saveDrawing).toHaveBeenCalledTimes(1);
  });

  it('opens an empty canvas for a drawing that does not exist yet', async () => {
    storage.loadDrawingStrict.mockResolvedValue(null);
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not save the shape library while it could not be loaded', async () => {
    storage.loadLibraryStrict.mockRejectedValue(new Error('Operation timed out'));
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy());
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    act(() => lastProps?.onLibraryChange([{ id: 'only-this' }]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(storage.saveLibrary).not.toHaveBeenCalled();
  });

  it('saves the shape library when it loaded', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy());
    await waitFor(() => expect(storage.loadLibraryStrict).toHaveBeenCalled());
    await act(async () => {});

    vi.useFakeTimers();
    act(() => lastProps?.onLibraryChange([{ id: 'a' }]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(storage.saveLibrary).toHaveBeenCalledTimes(1);
  });
});
