/**
 * Tests for drawing sidecar file operations (drawing-storage.ts).
 * Tauri IPC is mocked via setMockInvokeHandler from the shared tauri-mock.
 */
import { describe, it, expect } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import {
  loadDrawing,
  saveDrawing,
  saveSvgPreview,
  deleteDrawing,
  drawingExists,
  loadSvgPreview,
  loadLibrary,
  saveLibrary,
  importLibraryFile,
} from '@/lib/drawing-storage';

const PROJECT = '/projects/my-project';

describe('drawing-storage', () => {
  describe('loadDrawing', () => {
    it('returns parsed JSON when file exists', async () => {
      const sceneData = { type: 'excalidraw', elements: [], appState: {} };
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('read_file', () => JSON.stringify(sceneData));

      const result = await loadDrawing('abc123', PROJECT);
      expect(result).toEqual(sceneData);
    });

    it('returns null when file does not exist', async () => {
      setMockInvokeHandler('path_exists', () => false);

      const result = await loadDrawing('missing', PROJECT);
      expect(result).toBeNull();
    });

    it('returns null when read_file throws', async () => {
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('read_file', () => {
        throw new Error('read error');
      });

      const result = await loadDrawing('broken', PROJECT);
      expect(result).toBeNull();
    });
  });

  describe('saveDrawing', () => {
    it('creates directory and writes JSON', async () => {
      const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

      setMockInvokeHandler('path_exists', (args) => {
        calls.push({ cmd: 'path_exists', args: args ?? {} });
        return true; // drawings dir exists
      });
      setMockInvokeHandler('write_file', (args) => {
        calls.push({ cmd: 'write_file', args: args ?? {} });
        return undefined;
      });

      await saveDrawing('abc123', PROJECT, { type: 'excalidraw', elements: [] });

      const writeCall = calls.find((c) => c.cmd === 'write_file');
      expect(writeCall).toBeDefined();
      expect(writeCall!.args.path).toBe(
        `${PROJECT}/.notesage/drawings/abc123.excalidraw`,
      );
      // Verify written content is valid JSON
      const parsed = JSON.parse(writeCall!.args.content as string);
      expect(parsed).toEqual({ type: 'excalidraw', elements: [] });
    });

    it('creates .notesage and drawings dirs when they do not exist', async () => {
      const createdDirs: string[] = [];

      setMockInvokeHandler('path_exists', () => false);
      setMockInvokeHandler('create_directory', (args) => {
        createdDirs.push((args as Record<string, string>).path);
        return undefined;
      });
      setMockInvokeHandler('write_file', () => undefined);

      await saveDrawing('new-drawing', PROJECT, { elements: [] });

      expect(createdDirs).toContain(`${PROJECT}/.notesage`);
      expect(createdDirs).toContain(`${PROJECT}/.notesage/drawings`);
    });
  });

  describe('saveSvgPreview', () => {
    it('writes SVG string to file', async () => {
      let writtenContent = '';
      let writtenPath = '';

      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('write_file', (args) => {
        const a = args as Record<string, string>;
        writtenPath = a.path;
        writtenContent = a.content;
        return undefined;
      });

      await saveSvgPreview('abc123', PROJECT, '<svg>test</svg>');

      expect(writtenPath).toBe(`${PROJECT}/.notesage/drawings/abc123.svg`);
      expect(writtenContent).toBe('<svg>test</svg>');
    });
  });

  describe('deleteDrawing', () => {
    it('attempts to delete both .excalidraw and .svg files', async () => {
      const deletedPaths: string[] = [];

      setMockInvokeHandler('delete_path', (args) => {
        deletedPaths.push((args as Record<string, string>).path);
        return undefined;
      });

      await deleteDrawing('abc123', PROJECT);

      expect(deletedPaths).toHaveLength(2);
      expect(deletedPaths.some((p) => p.endsWith('.excalidraw'))).toBe(true);
      expect(deletedPaths.some((p) => p.endsWith('.svg'))).toBe(true);
    });

    it('does not throw if files do not exist', async () => {
      setMockInvokeHandler('delete_path', () => {
        throw new Error('not found');
      });

      await expect(deleteDrawing('missing', PROJECT)).resolves.not.toThrow();
    });
  });

  describe('drawingExists', () => {
    it('returns true when file exists', async () => {
      setMockInvokeHandler('path_exists', () => true);
      expect(await drawingExists('abc123', PROJECT)).toBe(true);
    });

    it('returns false when file does not exist', async () => {
      setMockInvokeHandler('path_exists', () => false);
      expect(await drawingExists('missing', PROJECT)).toBe(false);
    });

    it('checks the correct path', async () => {
      let checkedPath = '';
      setMockInvokeHandler('path_exists', (args) => {
        checkedPath = (args as Record<string, string>).path;
        return true;
      });

      await drawingExists('my-drawing', PROJECT);
      expect(checkedPath).toBe(`${PROJECT}/.notesage/drawings/my-drawing.excalidraw`);
    });
  });

  describe('loadSvgPreview', () => {
    it('returns SVG string when file exists', async () => {
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('read_file', () => '<svg>preview</svg>');

      expect(await loadSvgPreview('abc123', PROJECT)).toBe('<svg>preview</svg>');
    });

    it('returns null when file does not exist', async () => {
      setMockInvokeHandler('path_exists', () => false);

      expect(await loadSvgPreview('missing', PROJECT)).toBeNull();
    });

    it('returns null when read throws', async () => {
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('read_file', () => {
        throw new Error('read error');
      });

      expect(await loadSvgPreview('broken', PROJECT)).toBeNull();
    });
  });

  // --- Shape Library Persistence ---

  describe('loadLibrary', () => {
    it('returns parsed array when file exists', async () => {
      const items = [{ id: 'lib1', status: 'published', elements: [] }];
      setMockInvokeHandler('get_home_dir', () => '/Users/test');
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('read_file', () => JSON.stringify(items));

      const result = await loadLibrary();
      expect(result).toEqual(items);
    });

    it('returns empty array when file does not exist', async () => {
      setMockInvokeHandler('get_home_dir', () => '/Users/test');
      setMockInvokeHandler('path_exists', () => false);

      const result = await loadLibrary();
      expect(result).toEqual([]);
    });

    it('returns empty array on read error', async () => {
      setMockInvokeHandler('get_home_dir', () => '/Users/test');
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('read_file', () => { throw new Error('fail'); });

      const result = await loadLibrary();
      expect(result).toEqual([]);
    });

    it('returns empty array when file contains non-array JSON', async () => {
      setMockInvokeHandler('get_home_dir', () => '/Users/test');
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('read_file', () => '{"not": "an array"}');

      const result = await loadLibrary();
      expect(result).toEqual([]);
    });
  });

  describe('saveLibrary', () => {
    it('writes library items as pretty JSON', async () => {
      let writtenContent = '';
      let writtenPath = '';

      setMockInvokeHandler('get_home_dir', () => '/Users/test');
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('write_file', (args) => {
        const a = args as Record<string, string>;
        writtenPath = a.path;
        writtenContent = a.content;
        return undefined;
      });

      const items = [{ id: 'a', elements: [] }];
      await saveLibrary(items);

      expect(writtenPath).toBe('/Users/test/.notesage/excalidraw-library.json');
      expect(JSON.parse(writtenContent)).toEqual(items);
    });

    it('creates .notesage dir if it does not exist', async () => {
      const createdDirs: string[] = [];

      setMockInvokeHandler('get_home_dir', () => '/Users/test');
      setMockInvokeHandler('path_exists', () => false);
      setMockInvokeHandler('create_directory', (args) => {
        createdDirs.push((args as Record<string, string>).path);
        return undefined;
      });
      setMockInvokeHandler('write_file', () => undefined);

      await saveLibrary([]);

      expect(createdDirs).toContain('/Users/test/.notesage');
    });
  });

  describe('importLibraryFile', () => {
    it('merges new items and returns count', async () => {
      const existingItems = [{ id: 'existing-1', elements: [1] }];
      const libFile = {
        type: 'excalidrawlib',
        version: 2,
        libraryItems: [
          { id: 'new-1', elements: [2] },
          { id: 'new-2', elements: [3] },
        ],
      };

      let savedItems: unknown[] = [];
      setMockInvokeHandler('get_home_dir', () => '/Users/test');
      setMockInvokeHandler('path_exists', (args) => {
        const path = (args as Record<string, string>).path;
        // Library file exists (for loadLibrary), .notesage dir exists
        return path.endsWith('.json') || path.endsWith('.notesage');
      });
      setMockInvokeHandler('read_file', (args) => {
        const path = (args as Record<string, string>).path;
        if (path.endsWith('import.excalidrawlib')) return JSON.stringify(libFile);
        return JSON.stringify(existingItems);
      });
      setMockInvokeHandler('write_file', (args) => {
        savedItems = JSON.parse((args as Record<string, string>).content);
        return undefined;
      });

      const count = await importLibraryFile('/tmp/import.excalidrawlib');

      expect(count).toBe(2);
      expect(savedItems).toHaveLength(3);
    });

    it('deduplicates by id — existing items take priority', async () => {
      const existingItems = [{ id: 'dup', elements: [1] }];
      const libFile = {
        libraryItems: [{ id: 'dup', elements: [999] }],
      };

      let savedItems: unknown[] | null = null;
      setMockInvokeHandler('get_home_dir', () => '/Users/test');
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('read_file', (args) => {
        const path = (args as Record<string, string>).path;
        if (path.endsWith('.excalidrawlib')) return JSON.stringify(libFile);
        return JSON.stringify(existingItems);
      });
      setMockInvokeHandler('write_file', (args) => {
        savedItems = JSON.parse((args as Record<string, string>).content);
        return undefined;
      });

      const count = await importLibraryFile('/tmp/dup.excalidrawlib');

      expect(count).toBe(0);
      // Should not have saved since no new items
      expect(savedItems).toBeNull();
    });

    it('returns 0 when library file has no items', async () => {
      setMockInvokeHandler('get_home_dir', () => '/Users/test');
      setMockInvokeHandler('path_exists', () => true);
      setMockInvokeHandler('read_file', () => JSON.stringify({ libraryItems: [] }));

      const count = await importLibraryFile('/tmp/empty.excalidrawlib');
      expect(count).toBe(0);
    });
  });
});
