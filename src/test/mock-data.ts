import type { FileEntry } from '@/lib/tauri';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Tab mock (mirrors editor-store Tab shape)
// ---------------------------------------------------------------------------

export interface MockTab {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  content: string;
  frontmatter: null;
  fileType: 'markdown' | 'pdf' | 'docx' | 'epub' | 'image' | 'other';
  viewMode?: 'wysiwyg' | 'source';
  contentLoaded?: boolean;
}

/** Create a mock editor tab with sensible defaults. */
export function createMockTab(overrides?: Partial<MockTab>): MockTab {
  return {
    id: 'tab-1',
    filePath: '/test/note.md',
    fileName: 'note.md',
    isDirty: false,
    content: '# Test\n\nHello world',
    frontmatter: null,
    fileType: 'markdown',
    contentLoaded: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FileEntry mock
// ---------------------------------------------------------------------------

/** Create a mock FileEntry with sensible defaults. */
export function createMockFileEntry(overrides?: Partial<FileEntry>): FileEntry {
  return {
    name: 'test.md',
    path: '/test/test.md',
    is_directory: false,
    children: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// File tree mock
// ---------------------------------------------------------------------------

/** Create a realistic file tree with a folder and root-level files. */
export function createMockFileTree(): FileEntry[] {
  return [
    {
      name: 'docs',
      path: '/test/docs',
      is_directory: true,
      children: [
        {
          name: 'readme.md',
          path: '/test/docs/readme.md',
          is_directory: false,
        },
        {
          name: 'guide.md',
          path: '/test/docs/guide.md',
          is_directory: false,
        },
      ],
    },
    {
      name: 'notes.md',
      path: '/test/notes.md',
      is_directory: false,
    },
    {
      name: 'todo.md',
      path: '/test/todo.md',
      is_directory: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Project mock
// ---------------------------------------------------------------------------

/** Create a mock project with a file tree. */
export function createMockProject(
  overrides?: Partial<{ path: string; fileTree: FileEntry[] }>,
): { path: string; fileTree: FileEntry[] } {
  return {
    path: '/test',
    fileTree: createMockFileTree(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Connection mock
// ---------------------------------------------------------------------------

/** Create a mock AI provider connection with sensible defaults. */
export function createMockConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: 'conn-test',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Test Anthropic',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  };
}
