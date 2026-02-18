import { tauriApi, type FileEntry } from '@/lib/tauri';
import { parseFrontmatter } from '@/lib/frontmatter';

export interface DocumentIndex {
  /** UUID → absolute file path */
  entries: Record<string, string>;
}

/**
 * Recursively collect all .md file paths from a file tree.
 */
function collectMarkdownFiles(entries: FileEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.is_directory && entry.children) {
      // Skip .notesage directory
      if (entry.name === '.notesage') continue;
      paths.push(...collectMarkdownFiles(entry.children));
    } else if (entry.name.endsWith('.md')) {
      paths.push(entry.path);
    }
  }
  return paths;
}

/**
 * Scan all .md files in a project, extract frontmatter `id` fields,
 * and build a UUID → file path mapping. Writes the index to
 * `.notesage/doc-index.json`.
 */
export async function buildDocumentIndex(projectRoot: string): Promise<DocumentIndex> {
  const tree = await tauriApi.listDirectory(projectRoot);
  const mdFiles = collectMarkdownFiles(tree);

  const entries: Record<string, string> = {};

  // Process files in parallel (batched to avoid overwhelming the backend)
  const BATCH_SIZE = 20;
  for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
    const batch = mdFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const raw = await tauriApi.readFile(filePath);
          const { frontmatter } = parseFrontmatter(raw);
          if (frontmatter?.id && typeof frontmatter.id === 'string') {
            return { id: frontmatter.id, filePath };
          }
        } catch {
          // Skip files that can't be read
        }
        return null;
      })
    );
    for (const result of results) {
      if (result) {
        entries[result.id] = result.filePath;
      }
    }
  }

  const index: DocumentIndex = { entries };

  // Write index to disk
  try {
    const notesageDir = `${projectRoot}/.notesage`;
    const notesageDirExists = await tauriApi.pathExists(notesageDir);
    if (!notesageDirExists) {
      await tauriApi.createDirectory(notesageDir);
    }
    await tauriApi.writeFile(
      `${notesageDir}/doc-index.json`,
      JSON.stringify(index, null, 2)
    );
  } catch (error) {
    console.error('Failed to write document index:', error);
  }

  return index;
}

/**
 * Update a single entry in the document index.
 */
export async function updateDocumentIndex(
  projectRoot: string,
  uuid: string,
  filePath: string
): Promise<void> {
  const index = await loadDocumentIndex(projectRoot);
  index.entries[uuid] = filePath;

  try {
    await tauriApi.writeFile(
      `${projectRoot}/.notesage/doc-index.json`,
      JSON.stringify(index, null, 2)
    );
  } catch (error) {
    console.error('Failed to update document index:', error);
  }
}

/**
 * Load the existing document index from disk.
 * Returns an empty index if the file doesn't exist.
 */
export async function loadDocumentIndex(projectRoot: string): Promise<DocumentIndex> {
  const filePath = `${projectRoot}/.notesage/doc-index.json`;
  try {
    const exists = await tauriApi.pathExists(filePath);
    if (!exists) {
      return { entries: {} };
    }
    const raw = await tauriApi.readFile(filePath);
    return JSON.parse(raw) as DocumentIndex;
  } catch {
    return { entries: {} };
  }
}
