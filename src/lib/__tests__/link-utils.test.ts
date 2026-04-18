import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { isExternalUrl, isLocalFilePath, computeRelativePath, searchWorkspaceFiles, OPENABLE_EXTENSIONS, handleLinkNavigation } from '../link-utils';
import type { FileEntry } from '@/lib/tauri';

// Mock the opener plugin — `handleLinkNavigation` uses it for external URLs.
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

describe('isExternalUrl', () => {
  it('detects http URLs', () => {
    expect(isExternalUrl('https://example.com')).toBe(true);
    expect(isExternalUrl('http://example.com')).toBe(true);
  });

  it('detects mailto links', () => {
    expect(isExternalUrl('mailto:test@example.com')).toBe(true);
  });

  it('detects tel links', () => {
    expect(isExternalUrl('tel:+1234567890')).toBe(true);
  });

  it('detects anchor links', () => {
    expect(isExternalUrl('#section')).toBe(true);
  });

  it('rejects file paths', () => {
    expect(isExternalUrl('./readme.md')).toBe(false);
    expect(isExternalUrl('docs/file.md')).toBe(false);
    expect(isExternalUrl('/absolute/path.md')).toBe(false);
  });
});

describe('isLocalFilePath', () => {
  it('detects relative paths starting with ./', () => {
    expect(isLocalFilePath('./readme.md')).toBe(true);
  });

  it('detects parent paths starting with ../', () => {
    expect(isLocalFilePath('../other/file.md')).toBe(true);
  });

  it('detects absolute paths starting with /', () => {
    expect(isLocalFilePath('/home/user/file.md')).toBe(true);
  });

  it('detects home paths starting with ~', () => {
    expect(isLocalFilePath('~/Documents/file.md')).toBe(true);
  });

  it('detects files with known extensions', () => {
    expect(isLocalFilePath('readme.md')).toBe(true);
    expect(isLocalFilePath('docs/features/editor.md')).toBe(true);
    expect(isLocalFilePath('data.json')).toBe(true);
    expect(isLocalFilePath('script.py')).toBe(true);
  });

  it('rejects plain text without extensions', () => {
    expect(isLocalFilePath('example.com')).toBe(false);
    expect(isLocalFilePath('google.com/search')).toBe(false);
  });
});

describe('OPENABLE_EXTENSIONS', () => {
  it('matches common file types', () => {
    expect(OPENABLE_EXTENSIONS.test('file.md')).toBe(true);
    expect(OPENABLE_EXTENSIONS.test('file.txt')).toBe(true);
    expect(OPENABLE_EXTENSIONS.test('file.pdf')).toBe(true);
    expect(OPENABLE_EXTENSIONS.test('file.epub')).toBe(true);
    expect(OPENABLE_EXTENSIONS.test('file.docx')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(OPENABLE_EXTENSIONS.test('file.MD')).toBe(true);
    expect(OPENABLE_EXTENSIONS.test('file.Txt')).toBe(true);
  });

  it('rejects unknown extensions', () => {
    expect(OPENABLE_EXTENSIONS.test('file.xyz')).toBe(false);
    expect(OPENABLE_EXTENSIONS.test('file.mp3')).toBe(false);
  });
});

describe('computeRelativePath', () => {
  it('computes sibling file path with ./ prefix', () => {
    expect(computeRelativePath('/project/docs', '/project/docs/file.md')).toBe('./file.md');
  });

  it('computes path in subdirectory with ./ prefix', () => {
    expect(computeRelativePath('/project', '/project/docs/file.md')).toBe('./docs/file.md');
  });

  it('computes path with ../', () => {
    expect(computeRelativePath('/project/docs/features', '/project/readme.md')).toBe('../../readme.md');
  });

  it('computes path across directories', () => {
    expect(computeRelativePath('/project/src', '/project/docs/file.md')).toBe('../docs/file.md');
  });
});

describe('searchWorkspaceFiles', () => {
  const makeFile = (name: string, path: string): FileEntry => ({
    name,
    path,
    is_directory: false,
    hidden: name.startsWith('.'),
  });

  const makeDir = (name: string, path: string, children: FileEntry[]): FileEntry => ({
    name,
    path,
    is_directory: true,
    hidden: name.startsWith('.'),
    children,
  });

  const trees = [
    {
      rootPath: '/project',
      name: 'My Project',
      fileTree: [
        makeFile('readme.md', '/project/readme.md'),
        makeDir('docs', '/project/docs', [
          makeFile('editor.md', '/project/docs/editor.md'),
          makeFile('design.md', '/project/docs/design.md'),
        ]),
        makeDir('src', '/project/src', [
          makeFile('app.tsx', '/project/src/app.tsx'),
          makeFile('utils.ts', '/project/src/utils.ts'),
        ]),
        makeFile('image.png', '/project/image.png'), // not openable
      ],
    },
  ];

  it('finds files matching query', () => {
    const results = searchWorkspaceFiles('editor', trees);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('editor.md');
    expect(results[0].project).toBe('My Project');
  });

  it('is case-insensitive', () => {
    const results = searchWorkspaceFiles('README', trees);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('readme.md');
  });

  it('filters to openable extensions only', () => {
    const results = searchWorkspaceFiles('image', trees);
    expect(results).toHaveLength(0);
  });

  it('limits results to 20', () => {
    const bigTree = [{
      rootPath: '/big',
      name: 'Big Project',
      fileTree: Array.from({ length: 30 }, (_, i) => makeFile(`file${i}.md`, `/big/file${i}.md`)),
    }];
    const results = searchWorkspaceFiles('file', bigTree);
    expect(results).toHaveLength(20);
  });

  it('computes relative paths from active file dir', () => {
    const results = searchWorkspaceFiles('editor', trees, '/project/src');
    expect(results[0].relativePath).toBe('../docs/editor.md');
  });

  it('computes paths relative to root when no active file dir', () => {
    const results = searchWorkspaceFiles('editor', trees);
    expect(results[0].relativePath).toBe('./docs/editor.md');
  });
});

// ---------------------------------------------------------------------------
// handleLinkNavigation — covers the "file:// inside project vs external URL"
// split for ACP `resource_link` rendering (PRD #12, bullet 5).
//
// The markdown emitted by `formatResourceLinkAsMarkdown` flows through the
// editor's normal link-click extension, which delegates to `handleLinkNavigation`.
// These tests exercise that helper directly so we don't need to spin up
// ProseMirror just to prove the split works.
// ---------------------------------------------------------------------------

describe('handleLinkNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens external http URLs via openUrl (no editor tab opened)', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const mockOpenUrl = vi.mocked(openUrl);
    const openTab = vi.fn();

    await handleLinkNavigation('https://example.com/docs/intro', openTab, ['/project']);

    expect(mockOpenUrl).toHaveBeenCalledTimes(1);
    expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com/docs/intro');
    expect(openTab).not.toHaveBeenCalled();
  });

  it('opens absolute file path inside project via in-app openTab (no openUrl)', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const mockOpenUrl = vi.mocked(openUrl);
    setMockInvokeHandler('read_file', () => '# Hello');

    const openTab = vi.fn();

    await handleLinkNavigation('/project/notes/readme.md', openTab, ['/project']);

    expect(openTab).toHaveBeenCalledTimes(1);
    const [path, name, content, _fm, fileType] = openTab.mock.calls[0];
    expect(path).toBe('/project/notes/readme.md');
    expect(name).toBe('readme.md');
    // Frontmatter is parsed for markdown, body stripped to raw content.
    expect(content).toBe('# Hello');
    expect(fileType).toBe('markdown');
    // External opener never invoked for a file that resolved in-app.
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it('falls back to openUrl for non-openable external-looking paths', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const mockOpenUrl = vi.mocked(openUrl);
    const openTab = vi.fn();

    // No known file extension and not an http/mailto scheme → falls through to openUrl.
    await handleLinkNavigation('ftp://example.com/file', openTab, ['/project']);

    expect(mockOpenUrl).toHaveBeenCalledWith('ftp://example.com/file');
    expect(openTab).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// NOTE: Rendering of ACP `resource_link` content → markdown link is already
// covered in:
//   - src/hooks/__tests__/useAcpSessionListeners.test.ts (chat path)
//   - src/hooks/__tests__/useAgentTaskOperations.test.ts (task path)
// Those tests assert the emitted text contains `[name](uri)`. The click-handler
// tests above prove that such a link — once rendered in the editor — routes
// `file://`/local paths through the in-app opener and everything else through
// `openUrl`, closing the loop on PRD #12 bullet 5.
// ---------------------------------------------------------------------------
