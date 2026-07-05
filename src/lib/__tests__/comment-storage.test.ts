import { describe, it, expect } from 'vitest';
import { hashPath, commentSidecarPath, parseSidecar } from '../comment-storage';

describe('hashPath', () => {
  it('regression lock — algorithm must never change: known input maps to pinned output', () => {
    // This exact value was pinned when the algorithm was extracted from useCommentOperations.ts.
    // Any change to the hash algorithm will fail this test, surfacing the sidecar-mismatch risk.
    expect(hashPath('/Users/alice/Notesage/notes.md')).toBe('path-165b1150');
  });

  it('is deterministic — same input returns same output', () => {
    const path = '/home/bob/docs/readme.md';
    expect(hashPath(path)).toBe(hashPath(path));
  });

  it('known second input is stable', () => {
    expect(hashPath('/home/bob/docs/readme.md')).toBe('path-6b0a2cbe');
  });
});

describe('commentSidecarPath', () => {
  it('builds the correct sidecar path from notesRootPath and filePath', () => {
    const result = commentSidecarPath('/Users/alice/Notesage', '/Users/alice/Notesage/notes.md');
    expect(result).toBe('/Users/alice/Notesage/.notesage/comments/path-165b1150.json');
  });
});

describe('parseSidecar', () => {
  it('normalises the legacy bare-array format', () => {
    const raw = JSON.stringify([{ id: 'c1' }]);
    expect(parseSidecar(raw)).toEqual({ comments: [{ id: 'c1' }] });
  });

  it('passes through a valid envelope', () => {
    const raw = JSON.stringify({ originalPath: '/notes/a.md', comments: [{ id: 'c1' }] });
    expect(parseSidecar(raw)).toEqual({ originalPath: '/notes/a.md', comments: [{ id: 'c1' }] });
  });

  it('degrades to empty comments when the envelope has no comments array', () => {
    expect(parseSidecar(JSON.stringify({ originalPath: '/notes/a.md' }))).toEqual({
      originalPath: '/notes/a.md',
      comments: [],
    });
    expect(parseSidecar(JSON.stringify({ comments: 'not-an-array' }))).toEqual({ comments: [] });
  });

  it('drops a non-string originalPath while keeping the comments', () => {
    expect(parseSidecar(JSON.stringify({ originalPath: 42, comments: [] }))).toEqual({
      comments: [],
    });
  });

  it('degrades to empty comments for junk JSON primitives', () => {
    expect(parseSidecar('42')).toEqual({ comments: [] });
    expect(parseSidecar('"junk"')).toEqual({ comments: [] });
    expect(parseSidecar('null')).toEqual({ comments: [] });
  });
});
