/**
 * Sample data for E2E tests — used by the Tauri IPC mock.
 */

export const SAMPLE_PROJECT_PATH = '/tmp/notesage-e2e-project';

export const SAMPLE_FILES = {
  'welcome.md': `# Welcome to Notesage

This is a sample note for E2E testing.

- Item one
- Item two
- Item three
`,
  'todo.md': `# Todo List

- [ ] Write E2E tests
- [ ] Review pull request
- [x] Set up Playwright
`,
  'notes.md': `# Meeting Notes

## 2026-03-26

Discussed the new feature roadmap.

> Important: Ship before end of quarter.

### Action Items

1. Update documentation
2. Fix the sidebar bug
3. Deploy to staging
`,
  'code-example.md': `# Code Example

Here is some sample code:

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

And some inline \`code\` as well.
`,
  'empty.md': '',
};

export type SampleFileName = keyof typeof SAMPLE_FILES;

/**
 * File tree structure matching the Tauri FileEntry format.
 */
export const SAMPLE_FILE_TREE = [
  {
    name: 'welcome.md',
    path: `${SAMPLE_PROJECT_PATH}/welcome.md`,
    is_directory: false,
    children: null,
  },
  {
    name: 'todo.md',
    path: `${SAMPLE_PROJECT_PATH}/todo.md`,
    is_directory: false,
    children: null,
  },
  {
    name: 'notes.md',
    path: `${SAMPLE_PROJECT_PATH}/notes.md`,
    is_directory: false,
    children: null,
  },
  {
    name: 'code-example.md',
    path: `${SAMPLE_PROJECT_PATH}/code-example.md`,
    is_directory: false,
    children: null,
  },
  {
    name: 'subfolder',
    path: `${SAMPLE_PROJECT_PATH}/subfolder`,
    is_directory: true,
    children: [
      {
        name: 'empty.md',
        path: `${SAMPLE_PROJECT_PATH}/subfolder/empty.md`,
        is_directory: false,
        children: null,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Document-index fixtures — back the FloatingCommandBar's index-backed prefix
// modes (`#` tags, `@` references, `?` research, `:file` filename search).
//
// Shapes mirror the TS interfaces in `src/lib/tauri.ts` exactly:
//   IndexedTag, IndexTagOccurrence, IndexedMention, IndexResearchResult,
//   IndexFilenameSearchResult.
// The Rust commands these mock (`index_tags`, `index_tag_occurrences`,
// `index_mentions`, `index_mention_occurrences`, `index_search_research`,
// `index_search_filenames`) serialize the same snake_case fields.
// ---------------------------------------------------------------------------

/** Rows from `index_tags` — `{ tag, file_count }`, ordered file_count desc. */
export const SAMPLE_TAGS = [
  { tag: 'roadmap', file_count: 3 },
  { tag: 'research', file_count: 2 },
  { tag: 'bug', file_count: 1 },
];

/**
 * Rows from `index_tag_occurrences` — `{ path, file_name, context_before,
 * context_after }`. Keyed in the mock by the requested `tag` arg.
 */
export const SAMPLE_TAG_OCCURRENCES: Record<
  string,
  Array<{
    path: string;
    file_name: string;
    context_before: string;
    context_after: string;
  }>
> = {
  roadmap: [
    {
      path: `${SAMPLE_PROJECT_PATH}/notes.md`,
      file_name: 'notes.md',
      context_before: 'the new feature ',
      context_after: ' before quarter',
    },
    {
      path: `${SAMPLE_PROJECT_PATH}/welcome.md`,
      file_name: 'welcome.md',
      context_before: 'see the ',
      context_after: ' for details',
    },
  ],
  research: [
    {
      path: `${SAMPLE_PROJECT_PATH}/welcome.md`,
      file_name: 'welcome.md',
      context_before: 'ongoing ',
      context_after: ' notes',
    },
  ],
  bug: [
    {
      path: `${SAMPLE_PROJECT_PATH}/todo.md`,
      file_name: 'todo.md',
      context_before: 'fix the sidebar ',
      context_after: ' soon',
    },
  ],
};

/** Rows from `index_mentions` — `{ mention, file_count }`, file_count desc. */
export const SAMPLE_MENTIONS = [
  { mention: 'alice', file_count: 2 },
  { mention: 'bob', file_count: 1 },
];

/**
 * Rows from `index_mention_occurrences` — same shape as tag occurrences
 * (`IndexTagOccurrence`). Keyed in the mock by the requested `mention` arg.
 */
export const SAMPLE_MENTION_OCCURRENCES: Record<
  string,
  Array<{
    path: string;
    file_name: string;
    context_before: string;
    context_after: string;
  }>
> = {
  alice: [
    {
      path: `${SAMPLE_PROJECT_PATH}/notes.md`,
      file_name: 'notes.md',
      context_before: 'assigned to ',
      context_after: ' for review',
    },
    {
      path: `${SAMPLE_PROJECT_PATH}/todo.md`,
      file_name: 'todo.md',
      context_before: 'ping ',
      context_after: ' about the PR',
    },
  ],
  bob: [
    {
      path: `${SAMPLE_PROJECT_PATH}/welcome.md`,
      file_name: 'welcome.md',
      context_before: 'thanks ',
      context_after: ' for the help',
    },
  ],
};

/**
 * Rows from `index_search_research` — `IndexResearchResult`. Field set:
 * `{ file, title, tags, source_url, snippet, date_saved, word_count }`
 * (`project_name` optional). ResearchMode keys on `file` (open path) and
 * renders `title`, `date_saved`, and the source hostname.
 */
export const SAMPLE_RESEARCH = [
  {
    file: `${SAMPLE_PROJECT_PATH}/research/climate-policy.md`,
    title: 'Climate Policy Overview',
    tags: ['climate', 'policy'],
    source_url: 'https://example.com/climate',
    snippet: 'A survey of recent climate policy proposals.',
    date_saved: '2026-03-01',
    word_count: 1200,
    project_name: 'E2E Project',
  },
  {
    file: `${SAMPLE_PROJECT_PATH}/research/ai-safety.md`,
    title: 'AI Safety Notes',
    tags: ['ai', 'safety'],
    source_url: 'https://example.org/ai-safety',
    snippet: 'Collected notes on AI alignment approaches.',
    date_saved: '2026-02-14',
    word_count: 850,
    project_name: 'E2E Project',
  },
];

/**
 * Rows from `index_search_filenames` — `IndexFilenameSearchResult`. Field set:
 * `{ path, file_name, parent_dir, project_root }`. FileMode renders
 * `file_name` + `parent_dir` and opens `path` on selection.
 */
export const SAMPLE_FILENAME_RESULTS = [
  {
    path: `${SAMPLE_PROJECT_PATH}/notes.md`,
    file_name: 'notes.md',
    parent_dir: SAMPLE_PROJECT_PATH,
    project_root: SAMPLE_PROJECT_PATH,
  },
  {
    path: `${SAMPLE_PROJECT_PATH}/todo.md`,
    file_name: 'todo.md',
    parent_dir: SAMPLE_PROJECT_PATH,
    project_root: SAMPLE_PROJECT_PATH,
  },
  {
    path: `${SAMPLE_PROJECT_PATH}/welcome.md`,
    file_name: 'welcome.md',
    parent_dir: SAMPLE_PROJECT_PATH,
    project_root: SAMPLE_PROJECT_PATH,
  },
];
