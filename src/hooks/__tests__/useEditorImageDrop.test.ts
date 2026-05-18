/**
 * @vitest-environment jsdom
 *
 * Tests for `useEditorImageDrop` — the hook that wires Tauri drag-drop
 * events to the Tiptap editor so users can drag images from Finder into
 * the editor and have them inserted at the drop position.
 *
 * Acceptance criteria being tested (issue #165):
 *   - Supported image files (.png, .jpg, .gif, .webp) trigger an insert
 *   - Drop-target CSS class is added while a drag is in progress and removed
 *     when the drag leaves or the drop completes
 *   - Non-image files (e.g. .zip) show a toast error
 *   - Dropped images go through the compressImage pipeline
 *   - The hook cleans up Tauri event listeners on unmount
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Pull in the Tauri and toast mocks
import '@/test/tauri-mock';
// emitMockEvent and getListenerCount are available but not used directly in these tests
// (drag-drop events are simulated via the captured onDragDropEvent handler instead)
// setMockInvokeHandler is available for future tests that need it
import type {} from '@/test/tauri-mock';

// ---- Module mocks ----------------------------------------------------------

// Mock compressImage: returns a fake ImageAttachment so we don't need a real
// canvas environment in jsdom.
const mockCompressImage = vi.fn();
vi.mock('@/lib/image-compress', () => ({
  compressImage: (...args: unknown[]) => mockCompressImage(...args),
}));

// Mock the Tauri webview module — getCurrentWebview is used to listen for drag
// events.
const mockOnDragDropEvent = vi.fn();
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: mockOnDragDropEvent,
  }),
}));

// Mock tauriApi so we can inject fake binary data for read_binary_file.
const mockReadBinaryFile = vi.fn();
vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    readBinaryFile: (...args: unknown[]) => mockReadBinaryFile(...args),
  },
}));

// Mock toast
import { toast } from 'sonner';

// ---- Import the hook under test -------------------------------------------
import { useEditorImageDrop } from '../useEditorImageDrop';

// ---- Helpers ---------------------------------------------------------------

/** Minimal Tiptap editor stub covering the subset the hook uses. */
function makeEditorStub() {
  const insertContentMock = vi.fn().mockReturnValue(true);
  const chainMock = {
    focus: vi.fn().mockReturnThis(),
    insertContent: insertContentMock,
    run: vi.fn().mockReturnValue(true),
  };
  return {
    chain: vi.fn(() => chainMock),
    isDestroyed: false,
    // expose chain mock for assertion
    _chainMock: chainMock,
    _insertContentMock: insertContentMock,
  };
}

/** Simulate a fake DragDropEvent payload in the Tauri-event shape. */
type DragDropPayload =
  | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave' };

/**
 * Capture the onDragDropEvent handler registered by the hook and fire a
 * simulated event. Returns a helper function to fire events.
 */
function setupDragDropEmitter() {
  let capturedHandler: ((event: { payload: DragDropPayload }) => void) | null = null;

  (mockOnDragDropEvent as Mock).mockImplementation(
    (handler: (event: { payload: DragDropPayload }) => void) => {
      capturedHandler = handler;
      // Return a promise that resolves to an unlisten function (Tauri contract)
      return Promise.resolve(() => {
        capturedHandler = null;
      });
    },
  );

  function emit(payload: DragDropPayload) {
    capturedHandler?.({ payload });
  }

  return emit;
}

// ---- Test setup ------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: compressImage returns a minimal ImageAttachment
  mockCompressImage.mockResolvedValue({
    id: 'img-test',
    data: 'base64data',
    mimeType: 'image/jpeg',
    width: 100,
    height: 100,
    size: 1024,
  });

  // Default: readBinaryFile returns dummy bytes
  mockReadBinaryFile.mockResolvedValue(new Array(1024).fill(0));
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- Tests -----------------------------------------------------------------

describe('useEditorImageDrop', () => {
  it('registers a drag-drop listener on mount', async () => {
    setupDragDropEmitter();
    const editor = makeEditorStub();

    const { unmount } = renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useEditorImageDrop(editor as any),
    );

    // Give the async mount effect time to register the listener
    await act(async () => {});

    expect(mockOnDragDropEvent).toHaveBeenCalledOnce();

    unmount();
  });

  it('adds the drop-target CSS class to the container when a drag enters with an image path', async () => {
    const emit = setupDragDropEmitter();
    const editor = makeEditorStub();

    // Attach a DOM element that the hook will add the class to
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useEditorImageDrop(editor as any, container),
    );

    await act(async () => {});

    act(() => {
      emit({ type: 'enter', paths: ['/Users/me/photo.png'], position: { x: 0, y: 0 } });
    });

    expect(container.classList.contains('editor-image-drop-target')).toBe(true);

    document.body.removeChild(container);
  });

  it('removes the drop-target CSS class when the drag leaves', async () => {
    const emit = setupDragDropEmitter();
    const editor = makeEditorStub();
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useEditorImageDrop(editor as any, container),
    );

    await act(async () => {});

    act(() => {
      emit({ type: 'enter', paths: ['/Users/me/photo.png'], position: { x: 0, y: 0 } });
    });
    expect(container.classList.contains('editor-image-drop-target')).toBe(true);

    act(() => {
      emit({ type: 'leave' });
    });
    expect(container.classList.contains('editor-image-drop-target')).toBe(false);

    document.body.removeChild(container);
  });

  it('inserts the image into the editor when a supported image file is dropped', async () => {
    const emit = setupDragDropEmitter();
    const editor = makeEditorStub();

    renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useEditorImageDrop(editor as any),
    );

    await act(async () => {});

    await act(async () => {
      emit({ type: 'drop', paths: ['/Users/me/photo.png'], position: { x: 0, y: 0 } });
      // Let async drop handling complete
      await new Promise((r) => setTimeout(r, 0));
    });

    // readBinaryFile should have been called with the dropped path
    expect(mockReadBinaryFile).toHaveBeenCalledWith('/Users/me/photo.png');

    // compressImage should have received a Blob
    expect(mockCompressImage).toHaveBeenCalledOnce();

    // The editor should have received the image via chain().insertContent().run()
    const chain = editor.chain();
    expect(chain.focus).toHaveBeenCalled();
    expect(chain.insertContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image' }),
    );
  });

  it('supports .jpg, .gif, and .webp extensions', async () => {
    const extensions = ['.jpg', '.jpeg', '.gif', '.webp'];

    for (const ext of extensions) {
      vi.clearAllMocks();
      mockCompressImage.mockResolvedValue({
        id: 'img-test',
        data: 'base64data',
        mimeType: 'image/jpeg',
        width: 100,
        height: 100,
        size: 1024,
      });
      mockReadBinaryFile.mockResolvedValue(new Array(1024).fill(0));

      const emit = setupDragDropEmitter();
      const editor = makeEditorStub();

      const { unmount } = renderHook(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useEditorImageDrop(editor as any),
      );

      await act(async () => {});

      await act(async () => {
        emit({
          type: 'drop',
          paths: [`/Users/me/photo${ext}`],
          position: { x: 0, y: 0 },
        });
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockReadBinaryFile).toHaveBeenCalledWith(`/Users/me/photo${ext}`);
      expect(mockCompressImage).toHaveBeenCalledOnce();

      unmount();
    }
  });

  it('shows a toast error and does NOT call readBinaryFile for non-image files', async () => {
    const emit = setupDragDropEmitter();
    const editor = makeEditorStub();

    renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useEditorImageDrop(editor as any),
    );

    await act(async () => {});

    await act(async () => {
      emit({ type: 'drop', paths: ['/Users/me/document.zip'], position: { x: 0, y: 0 } });
      await new Promise((r) => setTimeout(r, 0));
    });

    // No binary read for unsupported file
    expect(mockReadBinaryFile).not.toHaveBeenCalled();
    // No image insert
    expect(mockCompressImage).not.toHaveBeenCalled();
    // Toast error shown
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });

  it('removes the drop-target class after a drop completes', async () => {
    const emit = setupDragDropEmitter();
    const editor = makeEditorStub();
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useEditorImageDrop(editor as any, container),
    );

    await act(async () => {});

    // Enter drag
    act(() => {
      emit({ type: 'enter', paths: ['/Users/me/photo.png'], position: { x: 0, y: 0 } });
    });
    expect(container.classList.contains('editor-image-drop-target')).toBe(true);

    // Drop
    await act(async () => {
      emit({ type: 'drop', paths: ['/Users/me/photo.png'], position: { x: 0, y: 0 } });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Class should be removed after drop
    expect(container.classList.contains('editor-image-drop-target')).toBe(false);

    document.body.removeChild(container);
  });

  it('does not add drop-target class for non-image drags', async () => {
    const emit = setupDragDropEmitter();
    const editor = makeEditorStub();
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useEditorImageDrop(editor as any, container),
    );

    await act(async () => {});

    act(() => {
      emit({ type: 'enter', paths: ['/Users/me/document.pdf'], position: { x: 0, y: 0 } });
    });

    // No highlight for non-image drag
    expect(container.classList.contains('editor-image-drop-target')).toBe(false);

    document.body.removeChild(container);
  });

  it('unregisters the drag-drop listener on unmount', async () => {
    let unlistenCalled = false;
    (mockOnDragDropEvent as Mock).mockResolvedValue(() => {
      unlistenCalled = true;
    });

    const editor = makeEditorStub();
    const { unmount } = renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useEditorImageDrop(editor as any),
    );

    await act(async () => {});

    unmount();

    // Give cleanup a tick to run
    await act(async () => {});

    expect(unlistenCalled).toBe(true);
  });

  it('does not insert when the editor is destroyed', async () => {
    const emit = setupDragDropEmitter();
    const editor = makeEditorStub();
    editor.isDestroyed = true; // simulate destroyed editor

    renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useEditorImageDrop(editor as any),
    );

    await act(async () => {});

    await act(async () => {
      emit({ type: 'drop', paths: ['/Users/me/photo.png'], position: { x: 0, y: 0 } });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Nothing should happen for a destroyed editor
    expect(mockReadBinaryFile).not.toHaveBeenCalled();
  });
});
