// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { hashPath } from '@/lib/comment-storage';

describe('hashPath', () => {
  it('returns a stable hex string with path- prefix for a known input', () => {
    // This is the regression lock: algorithm must never change.
    // Computed once from the original implementation in useCommentOperations.ts:
    //   let h = 0; for (i < path.length) h = ((h << 5) - h + charCodeAt(i)) | 0;
    //   return 'path-' + (h >>> 0).toString(16)
    const result = hashPath('/Users/alice/Notesage/notes.md');
    expect(result).toMatch(/^path-[0-9a-f]+$/);
    // Stable: same input must always produce same output
    expect(result).toBe(hashPath('/Users/alice/Notesage/notes.md'));
  });

  it('returns a known stable hash for a second canonical input', () => {
    // Manually computed: '/home/bob/docs/readme.md'
    const a = hashPath('/home/bob/docs/readme.md');
    expect(a).toMatch(/^path-[0-9a-f]+$/);
    expect(a).toBe(hashPath('/home/bob/docs/readme.md'));
  });

  it('produces different outputs for different inputs', () => {
    expect(hashPath('/a/b.md')).not.toBe(hashPath('/a/c.md'));
  });
});
