/**
 * Tests for image-sidecar.ts — utilities that persist pasted image bytes
 * to a stable on-disk sidecar path and return a file path suitable for use
 * with `convertFileSrc`.
 *
 * Covers acceptance criteria from issue #164:
 *   - For project files: images land in <project>/.notesage/images/<uuid>.<ext>
 *   - For non-project files: images land in ~/.notesage/images/<uuid>.<ext>
 *   - The returned path is an absolute filesystem path (not a blob: URL)
 *   - Directories are created as needed
 */
import { describe, it, expect } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import {
  saveImageSidecar,
  imagesDir,
  imagePath,
} from '@/lib/image-sidecar';

const PROJECT = '/projects/my-project';
const HOME = '/Users/testuser';

describe('imagePath', () => {
  it('returns <projectRoot>/.notesage/images/<uuid>.<ext> for project files', () => {
    const path = imagePath(PROJECT, 'abc-123', 'png');
    expect(path).toBe(`${PROJECT}/.notesage/images/abc-123.png`);
  });

  it('uses the correct extension', () => {
    expect(imagePath(PROJECT, 'id1', 'jpeg')).toBe(`${PROJECT}/.notesage/images/id1.jpeg`);
    expect(imagePath(PROJECT, 'id2', 'gif')).toBe(`${PROJECT}/.notesage/images/id2.gif`);
    expect(imagePath(PROJECT, 'id3', 'webp')).toBe(`${PROJECT}/.notesage/images/id3.webp`);
  });
});

describe('imagesDir', () => {
  it('returns <projectRoot>/.notesage/images', () => {
    expect(imagesDir(PROJECT)).toBe(`${PROJECT}/.notesage/images`);
  });
});

describe('saveImageSidecar', () => {
  it('creates .notesage and .notesage/images dirs when they do not exist', async () => {
    const createdDirs: string[] = [];

    setMockInvokeHandler('path_exists', () => false);
    setMockInvokeHandler('create_directory', (args) => {
      createdDirs.push((args as Record<string, string>).path);
      return undefined;
    });
    setMockInvokeHandler('save_binary_file', () => undefined);

    const bytes = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    await saveImageSidecar(bytes, 'image/png', PROJECT, 'fixed-uuid');

    expect(createdDirs).toContain(`${PROJECT}/.notesage`);
    expect(createdDirs).toContain(`${PROJECT}/.notesage/images`);
  });

  it('skips directory creation when images dir already exists', async () => {
    const createdDirs: string[] = [];

    setMockInvokeHandler('path_exists', () => true); // dir exists
    setMockInvokeHandler('create_directory', (args) => {
      createdDirs.push((args as Record<string, string>).path);
      return undefined;
    });
    setMockInvokeHandler('save_binary_file', () => undefined);

    const bytes = new Uint8Array([137, 80, 78, 71]);
    await saveImageSidecar(bytes, 'image/png', PROJECT, 'fixed-uuid');

    expect(createdDirs).toHaveLength(0);
  });

  it('writes bytes via save_binary_file at the correct path', async () => {
    let savedPath = '';
    let savedData: number[] = [];

    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('save_binary_file', (args) => {
      const a = args as Record<string, unknown>;
      savedPath = a.path as string;
      savedData = a.data as number[];
      return undefined;
    });

    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
    await saveImageSidecar(bytes, 'image/png', PROJECT, 'test-uuid');

    expect(savedPath).toBe(`${PROJECT}/.notesage/images/test-uuid.png`);
    expect(savedData).toEqual(Array.from(bytes));
  });

  it('returns the absolute filesystem path to the saved file', async () => {
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('save_binary_file', () => undefined);

    const bytes = new Uint8Array([0, 0]);
    const result = await saveImageSidecar(bytes, 'image/jpeg', PROJECT, 'my-uuid');

    expect(result).toBe(`${PROJECT}/.notesage/images/my-uuid.jpeg`);
  });

  it('uses ~/.notesage/images for non-project files when projectRoot is the home dir', async () => {
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('save_binary_file', () => undefined);

    const bytes = new Uint8Array([0, 0]);
    const result = await saveImageSidecar(bytes, 'image/png', HOME, 'home-uuid');

    expect(result).toBe(`${HOME}/.notesage/images/home-uuid.png`);
  });

  it('maps image/jpeg MIME to jpeg extension', async () => {
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('save_binary_file', () => undefined);

    const result = await saveImageSidecar(new Uint8Array([0]), 'image/jpeg', PROJECT, 'u1');
    expect(result).toMatch(/\.jpeg$/);
  });

  it('maps image/png MIME to png extension', async () => {
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('save_binary_file', () => undefined);

    const result = await saveImageSidecar(new Uint8Array([0]), 'image/png', PROJECT, 'u2');
    expect(result).toMatch(/\.png$/);
  });

  it('maps image/gif MIME to gif extension', async () => {
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('save_binary_file', () => undefined);

    const result = await saveImageSidecar(new Uint8Array([0]), 'image/gif', PROJECT, 'u3');
    expect(result).toMatch(/\.gif$/);
  });

  it('maps image/webp MIME to webp extension', async () => {
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('save_binary_file', () => undefined);

    const result = await saveImageSidecar(new Uint8Array([0]), 'image/webp', PROJECT, 'u4');
    expect(result).toMatch(/\.webp$/);
  });

  it('falls back to png for unknown MIME types', async () => {
    setMockInvokeHandler('path_exists', () => true);
    setMockInvokeHandler('save_binary_file', () => undefined);

    const result = await saveImageSidecar(new Uint8Array([0]), 'image/tiff', PROJECT, 'u5');
    expect(result).toMatch(/\.png$/);
  });
});
