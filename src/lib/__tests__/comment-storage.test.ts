import { describe, it, expect } from 'vitest';
import { hashPath, commentSidecarPath } from '../comment-storage';

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
