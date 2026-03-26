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
