import { describe, it, expect } from 'vitest';
import { fileUriToPath, isUriInScope, type UriScope } from '@/lib/ai/uri-scope';

describe('fileUriToPath', () => {
  it('strips file:// scheme', () => {
    expect(fileUriToPath('file:///Users/me/project/foo.md')).toBe('/Users/me/project/foo.md');
  });

  it('returns bare absolute path unchanged', () => {
    expect(fileUriToPath('/project/foo.md')).toBe('/project/foo.md');
  });

  it('rejects non-file schemes', () => {
    expect(fileUriToPath('https://example.com/foo')).toBeNull();
    expect(fileUriToPath('untitled:/foo')).toBeNull();
  });

  it('rejects relative paths', () => {
    expect(fileUriToPath('relative/foo')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(fileUriToPath('')).toBeNull();
  });
});

describe('isUriInScope', () => {
  const scopeWithProject: UriScope = {
    projectRoots: ['/workspace/project-A'],
    notesRootPath: '/Users/me/Notesage',
  };

  const emptyScope: UriScope = {
    projectRoots: [],
    notesRootPath: '/Users/me/Notesage',
  };

  const scopeWithoutNotes: UriScope = {
    projectRoots: ['/workspace/project-A'],
    notesRootPath: null,
  };

  it('allows paths directly inside a selected project', () => {
    expect(isUriInScope('/workspace/project-A/file.md', scopeWithProject)).toBe(true);
    expect(isUriInScope('/workspace/project-A/sub/file.md', scopeWithProject)).toBe(true);
  });

  it('allows the project root itself', () => {
    expect(isUriInScope('/workspace/project-A', scopeWithProject)).toBe(true);
  });

  it('allows file:// URIs inside a selected project', () => {
    expect(isUriInScope('file:///workspace/project-A/file.md', scopeWithProject)).toBe(true);
  });

  it('denies paths in a sibling project not in scope', () => {
    expect(isUriInScope('/workspace/project-B/secrets.md', scopeWithProject)).toBe(false);
  });

  it('denies paths with a prefix that happens to match as substring', () => {
    // /workspace/project-AB is NOT under /workspace/project-A
    expect(isUriInScope('/workspace/project-AB/file.md', scopeWithProject)).toBe(false);
  });

  it('allows paths under the notes root', () => {
    expect(isUriInScope('/Users/me/Notesage/journal.md', scopeWithProject)).toBe(true);
  });

  it('denies paths outside every root when no project selected', () => {
    expect(isUriInScope('/workspace/project-A/file.md', emptyScope)).toBe(false);
  });

  it('still allows notes root reads when no project selected', () => {
    expect(isUriInScope('/Users/me/Notesage/note.md', emptyScope)).toBe(true);
  });

  it('denies everything outside projectRoots when notesRootPath is null', () => {
    expect(isUriInScope('/Users/me/Notesage/note.md', scopeWithoutNotes)).toBe(false);
    expect(isUriInScope('/workspace/project-A/file.md', scopeWithoutNotes)).toBe(true);
  });

  it('handles trailing slashes in the scope roots', () => {
    const scope: UriScope = {
      projectRoots: ['/workspace/project-A/'],
      notesRootPath: '/Users/me/Notesage/',
    };
    expect(isUriInScope('/workspace/project-A/file.md', scope)).toBe(true);
    expect(isUriInScope('/Users/me/Notesage/note.md', scope)).toBe(true);
  });

  it('denies non-file URIs categorically', () => {
    expect(isUriInScope('https://example.com/foo', scopeWithProject)).toBe(false);
    expect(isUriInScope('untitled:/scratch', scopeWithProject)).toBe(false);
  });

  it('denies empty URI', () => {
    expect(isUriInScope('', scopeWithProject)).toBe(false);
  });
});
