import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn().mockResolvedValue('{}');
const mockPathExists = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    pathExists: (...args: unknown[]) => mockPathExists(...args),
    writeFile: vi.fn().mockResolvedValue(undefined),
    createDirectory: vi.fn().mockResolvedValue(undefined),
    listDirectory: vi.fn().mockResolvedValue([]),
  },
}));

import { isDocumentIndex, loadDocumentIndex } from '../document-index';

beforeEach(() => {
  vi.clearAllMocks();
  mockPathExists.mockResolvedValue(true);
});

describe('isDocumentIndex', () => {
  it('accepts a valid index (including empty entries)', () => {
    expect(isDocumentIndex({ entries: {} })).toBe(true);
    expect(isDocumentIndex({ entries: { 'uuid-1': '/notes/a.md' } })).toBe(true);
  });

  it('rejects junk primitives', () => {
    expect(isDocumentIndex(null)).toBe(false);
    expect(isDocumentIndex(undefined)).toBe(false);
    expect(isDocumentIndex(42)).toBe(false);
    expect(isDocumentIndex('index')).toBe(false);
    expect(isDocumentIndex([{ entries: {} }])).toBe(false);
  });

  it('rejects wrong-shape objects', () => {
    expect(isDocumentIndex({})).toBe(false);
    expect(isDocumentIndex({ entries: null })).toBe(false);
    expect(isDocumentIndex({ entries: ['a'] })).toBe(false);
    expect(isDocumentIndex({ entries: { 'uuid-1': 42 } })).toBe(false);
  });
});

describe('loadDocumentIndex', () => {
  it('returns the parsed index for a valid file', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ entries: { u1: '/p/a.md' } }));
    const index = await loadDocumentIndex('/p');
    expect(index).toEqual({ entries: { u1: '/p/a.md' } });
  });

  it('falls back to an empty index for valid JSON of the wrong shape', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ totally: 'different' }));
    expect(await loadDocumentIndex('/p')).toEqual({ entries: {} });

    mockReadFile.mockResolvedValue('"just a string"');
    expect(await loadDocumentIndex('/p')).toEqual({ entries: {} });
  });

  it('falls back to an empty index for invalid JSON', async () => {
    mockReadFile.mockResolvedValue('{ not json');
    expect(await loadDocumentIndex('/p')).toEqual({ entries: {} });
  });
});
