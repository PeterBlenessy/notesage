/**
 * @vitest-environment jsdom
 *
 * Tests for `useEditorImageDrop` — the hook that wires HTML5 file drag-drop
 * events to the Tiptap editor so users can drag images from Finder into the
 * editor and have them inserted.
 *
 * NOTE — event-source contract change: the app ships with
 * `dragDropEnabled: false` (tauri.conf.json), so Tauri's native
 * `onDragDropEvent` channel never fires. The hook listens for DOM drag
 * events scoped to the editor container instead. These tests simulate
 * DOM DragEvents (jsdom has no DragEvent constructor, so plain Events are
 * decorated with a `dataTransfer` object).
 *
 * Acceptance criteria (issue #165, adapted to the DOM event source):
 *   - Supported image files (.png, .jpg, .gif, .webp) trigger an insert
 *   - Drop-target CSS class is added while an image drag is over the
 *     container and removed when the drag leaves or the drop completes
 *   - Non-image files show a toast error
 *   - Dropped images go through the compressImage pipeline
 *   - Drops OUTSIDE the container are left untouched (command bar, sidebar)
 *   - Listeners are removed on unmount
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import '@/test/tauri-mock';

// ---- Module mocks ----------------------------------------------------------

// Mock compressImage: returns a fake ImageAttachment so we don't need a real
// canvas environment in jsdom.
const mockCompressImage = vi.fn();
vi.mock('@/lib/image-compress', () => ({
  compressImage: (...args: unknown[]) => mockCompressImage(...args),
}));

// Mock toast
import { toast } from 'sonner';

// ---- Import the hook under test -------------------------------------------
import { useEditorImageDrop } from '../useEditorImageDrop';

// ---- Helpers ---------------------------------------------------------------

/** Minimal Tiptap editor stub covering the subset the hook uses. */
function makeEditorStub() {
  const chainMock = {
    focus: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    insertContentAt: vi.fn().mockReturnThis(),
    run: vi.fn().mockReturnValue(true),
  };
  return {
    chain: vi.fn(() => chainMock),
    isDestroyed: false,
    // No `view` — exercises the selection-fallback insert path.
    _chainMock: chainMock,
  };
}

interface FakeDataTransfer {
  types: string[];
  items: Array<{ kind: string; type: string }>;
  files: File[];
}

function makeImageFile(name: string, type: string): File {
  return new File([new Uint8Array(16)], name, { type });
}

function fileTransfer(files: File[]): FakeDataTransfer {
  return {
    types: ['Files'],
    items: files.map((f) => ({ kind: 'file', type: f.type })),
    files,
  };
}

/** Dispatch a synthetic drag event with an attached dataTransfer. */
function fireDragEvent(
  target: EventTarget,
  type: 'dragenter' | 'dragover' | 'dragleave' | 'dragend' | 'drop',
  dataTransfer: FakeDataTransfer | null,
  coords: { clientX?: number; clientY?: number } = {},
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer, clientX: coords.clientX ?? 0, clientY: coords.clientY ?? 0 });
  target.dispatchEvent(event);
}

/** Flush the async drop-processing microtasks. */
async function flushDrop(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ---- Test setup ------------------------------------------------------------

let container: HTMLDivElement;
let outside: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();

  mockCompressImage.mockResolvedValue({
    id: 'img-test',
    data: 'base64data',
    mimeType: 'image/jpeg',
    width: 100,
    height: 100,
    size: 1024,
  });

  container = document.createElement('div');
  outside = document.createElement('div');
  document.body.appendChild(container);
  document.body.appendChild(outside);
});

afterEach(() => {
  container.remove();
  outside.remove();
  vi.clearAllMocks();
});

function renderDropHook(editor: ReturnType<typeof makeEditorStub>) {
  return renderHook(() =>
    useEditorImageDrop(
      editor as unknown as Parameters<typeof useEditorImageDrop>[0],
      { current: container },
    ),
  );
}

// ---- Tests -----------------------------------------------------------------

describe('useEditorImageDrop', () => {
  it('adds the drop-target CSS class when an image drag enters the container', () => {
    const editor = makeEditorStub();
    renderDropHook(editor);

    act(() => {
      fireDragEvent(container, 'dragenter', fileTransfer([makeImageFile('photo.png', 'image/png')]));
    });

    expect(container.classList.contains('editor-image-drop-target')).toBe(true);
  });

  it('removes the drop-target CSS class when the drag leaves', () => {
    const editor = makeEditorStub();
    renderDropHook(editor);
    const dt = fileTransfer([makeImageFile('photo.png', 'image/png')]);

    act(() => {
      fireDragEvent(container, 'dragenter', dt);
    });
    expect(container.classList.contains('editor-image-drop-target')).toBe(true);

    act(() => {
      fireDragEvent(container, 'dragleave', dt);
    });
    expect(container.classList.contains('editor-image-drop-target')).toBe(false);
  });

  it('does not flicker the class across nested enter/leave (counter-based)', () => {
    const editor = makeEditorStub();
    renderDropHook(editor);
    const child = document.createElement('p');
    container.appendChild(child);
    const dt = fileTransfer([makeImageFile('photo.png', 'image/png')]);

    act(() => {
      fireDragEvent(container, 'dragenter', dt);
      fireDragEvent(child, 'dragenter', dt); // nested boundary
      fireDragEvent(container, 'dragleave', dt); // leaving outer for inner
    });
    // Still inside the child — class must remain.
    expect(container.classList.contains('editor-image-drop-target')).toBe(true);

    act(() => {
      fireDragEvent(child, 'dragleave', dt);
    });
    expect(container.classList.contains('editor-image-drop-target')).toBe(false);
  });

  it('inserts the image into the editor when a supported image file is dropped', async () => {
    const editor = makeEditorStub();
    renderDropHook(editor);
    const file = makeImageFile('photo.png', 'image/png');

    act(() => {
      fireDragEvent(container, 'drop', fileTransfer([file]));
    });
    await flushDrop();

    // compressImage received the dropped File
    expect(mockCompressImage).toHaveBeenCalledOnce();
    expect(mockCompressImage.mock.calls[0][0]).toBe(file);

    // The editor received the image via chain().focus().insertContent().run()
    expect(editor._chainMock.focus).toHaveBeenCalled();
    expect(editor._chainMock.insertContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image' }),
    );
  });

  it('inserts at the drop coordinates when the editor view can resolve them', async () => {
    const editor = makeEditorStub();
    const posAtCoords = vi.fn().mockReturnValue({ pos: 42, inside: 0 });
    (editor as unknown as { view: unknown }).view = { posAtCoords };
    renderDropHook(editor);

    act(() => {
      fireDragEvent(container, 'drop', fileTransfer([makeImageFile('p.png', 'image/png')]), {
        clientX: 10,
        clientY: 20,
      });
    });
    await flushDrop();

    expect(posAtCoords).toHaveBeenCalledWith({ left: 10, top: 20 });
    expect(editor._chainMock.insertContentAt).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ type: 'image' }),
    );
  });

  it('supports .jpg, .gif, and .webp MIME types', async () => {
    const cases: Array<[string, string]> = [
      ['photo.jpg', 'image/jpeg'],
      ['photo.gif', 'image/gif'],
      ['photo.webp', 'image/webp'],
    ];

    for (const [name, type] of cases) {
      vi.clearAllMocks();
      mockCompressImage.mockResolvedValue({
        id: 'img-test',
        data: 'base64data',
        mimeType: 'image/jpeg',
        width: 100,
        height: 100,
        size: 1024,
      });

      const editor = makeEditorStub();
      const { unmount } = renderDropHook(editor);

      act(() => {
        fireDragEvent(container, 'drop', fileTransfer([makeImageFile(name, type)]));
      });
      await flushDrop();

      expect(mockCompressImage).toHaveBeenCalledOnce();
      expect(editor._chainMock.insertContent).toHaveBeenCalled();

      unmount();
    }
  });

  it('shows a toast error and does NOT insert for non-image files', async () => {
    const editor = makeEditorStub();
    renderDropHook(editor);

    act(() => {
      fireDragEvent(
        container,
        'drop',
        fileTransfer([makeImageFile('document.zip', 'application/zip')]),
      );
    });
    await flushDrop();

    expect(mockCompressImage).not.toHaveBeenCalled();
    expect(editor._chainMock.insertContent).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });

  it('removes the drop-target class after a drop completes', async () => {
    const editor = makeEditorStub();
    renderDropHook(editor);
    const dt = fileTransfer([makeImageFile('photo.png', 'image/png')]);

    act(() => {
      fireDragEvent(container, 'dragenter', dt);
    });
    expect(container.classList.contains('editor-image-drop-target')).toBe(true);

    act(() => {
      fireDragEvent(container, 'drop', dt);
    });
    await flushDrop();

    expect(container.classList.contains('editor-image-drop-target')).toBe(false);
  });

  it('does not add the drop-target class for non-image drags', () => {
    const editor = makeEditorStub();
    renderDropHook(editor);

    act(() => {
      fireDragEvent(
        container,
        'dragenter',
        fileTransfer([makeImageFile('document.pdf', 'application/pdf')]),
      );
    });

    expect(container.classList.contains('editor-image-drop-target')).toBe(false);
  });

  it('ignores drops outside the container (command bar / sidebar keep their handlers)', async () => {
    const editor = makeEditorStub();
    renderDropHook(editor);

    act(() => {
      fireDragEvent(outside, 'drop', fileTransfer([makeImageFile('photo.png', 'image/png')]));
    });
    await flushDrop();

    expect(mockCompressImage).not.toHaveBeenCalled();
    expect(editor._chainMock.insertContent).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('ignores drags without OS files (sidebar row drags with a custom MIME)', async () => {
    const editor = makeEditorStub();
    renderDropHook(editor);
    const dt: FakeDataTransfer = {
      types: ['application/x-notesage-file'],
      items: [],
      files: [],
    };

    act(() => {
      fireDragEvent(container, 'dragenter', dt);
      fireDragEvent(container, 'drop', dt);
    });
    await flushDrop();

    expect(container.classList.contains('editor-image-drop-target')).toBe(false);
    expect(mockCompressImage).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('removes listeners on unmount', async () => {
    const editor = makeEditorStub();
    const { unmount } = renderDropHook(editor);
    unmount();

    act(() => {
      fireDragEvent(container, 'drop', fileTransfer([makeImageFile('photo.png', 'image/png')]));
    });
    await flushDrop();

    expect(mockCompressImage).not.toHaveBeenCalled();
  });

  it('does not insert when the editor is destroyed', async () => {
    const editor = makeEditorStub();
    editor.isDestroyed = true;
    renderDropHook(editor);

    act(() => {
      fireDragEvent(container, 'drop', fileTransfer([makeImageFile('photo.png', 'image/png')]));
    });
    await flushDrop();

    expect(mockCompressImage).not.toHaveBeenCalled();
  });

  it('toasts (but keeps going) when a single image fails to compress', async () => {
    const editor = makeEditorStub();
    renderDropHook(editor);
    mockCompressImage.mockRejectedValueOnce(new Error('boom'));

    act(() => {
      fireDragEvent(container, 'drop', fileTransfer([makeImageFile('bad.png', 'image/png')]));
    });
    await flushDrop();

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('bad.png'));
    expect(editor._chainMock.insertContent).not.toHaveBeenCalled();
  });
});
