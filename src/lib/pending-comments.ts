/**
 * Process pending comment files written by ACP agents.
 *
 * Agents write a JSON file to `<project>/.notesage/pending-comments/<name>.json`:
 * {
 *   "file": "relative/path/to/document.md",
 *   "comments": [
 *     { "anchor_text": "exact text", "body": "Comment body" },
 *     ...
 *   ]
 * }
 *
 * This module detects these files, converts them into proper comments
 * (with positions via text search), saves to the comments sidecar,
 * and updates the pending file with results so the agent can read back
 * comment IDs and statuses.
 *
 * After processing, the file becomes:
 * {
 *   "file": "relative/path/to/document.md",
 *   "status": "processed",
 *   "added": 3,
 *   "skipped": 1,
 *   "comments": [
 *     { "anchor_text": "...", "body": "...", "status": "added", "comment_id": "uuid" },
 *     { "anchor_text": "...", "body": "...", "status": "skipped", "reason": "text not found" }
 *   ]
 * }
 *
 * The file is written by a model, so nothing about its shape is trusted: it is
 * parsed to `unknown` and validated field by field. A file that cannot be
 * used at all is still marked `"status": "processed"` with a top-level
 * `"reason"`, so the agent can read back why and the file is not retried on
 * every later write. `file` must resolve inside the project the pending file
 * lives in.
 */

import { invoke } from '@tauri-apps/api/core';
import { useCommentStore } from '@/stores/comment-store';
import { useEditorStore } from '@/stores/editor-store';
import { getEditorRef } from '@/lib/editor-bridge';
import { findTextInDoc } from '@/lib/pm-text-search';
import { setCommentDecorations } from '@/components/editor/extensions/comment-mark';
import { getDocumentId, parseFrontmatter } from '@/lib/frontmatter';
import { hashPath } from '@/lib/comment-storage';
import { normalizeAbsolutePath } from '@/lib/ai/path-filter';
import { toast } from 'sonner';
import { log } from '@/lib/logger';

/** A comment entry that passed validation. */
interface ValidComment {
  anchor_text: string;
  body: string;
  occurrence: number;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate one agent-written comment entry. Returns the reason it is unusable, if any. */
function validateComment(entry: unknown): ValidComment | string {
  if (!isObject(entry)) return 'comment is not an object';
  const { anchor_text: anchorText, body, occurrence } = entry;
  if (typeof anchorText !== 'string' || typeof body !== 'string' || !anchorText || !body) {
    return 'missing anchor_text or body';
  }
  if (occurrence === undefined || occurrence === null) {
    return { anchor_text: anchorText, body, occurrence: 1 };
  }
  if (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 1) {
    return 'occurrence must be a positive integer';
  }
  return { anchor_text: anchorText, body, occurrence };
}

/**
 * Resolve the agent-supplied `file` to an absolute path inside `projectRoot`.
 * Returns null for a path that is malformed or resolves outside the project
 * (`../x`, `/etc/passwd`): an agent may only comment on the project's files.
 */
function resolveTargetPath(file: string, projectRoot: string): string | null {
  const root = normalizeAbsolutePath(projectRoot);
  if (!root) return null;
  const target = normalizeAbsolutePath(file.startsWith('/') ? file : `${root}/${file}`);
  if (!target || !target.startsWith(root === '/' ? '/' : `${root}/`)) return null;
  return target;
}

/** The editor showing `targetPath`, if that file is the active tab right now. */
function getActiveEditorFor(targetPath: string) {
  const editorState = useEditorStore.getState();
  const activeTab = editorState.openDocuments.find((t) => t.id === editorState.activeTabId);
  if (!activeTab || normalizeAbsolutePath(activeTab.filePath) !== targetPath) return null;
  return getEditorRef();
}

/**
 * Strip common markdown syntax to produce plain text for anchor matching.
 * This handles the mismatch between raw markdown (what agents read) and
 * ProseMirror content (which strips syntax like ## headings, **bold**, etc.).
 */
function stripMarkdownSyntax(text: string): string {
  return text
    // Heading prefixes: ## Heading → Heading
    .replace(/^#{1,6}\s+/gm, '')
    // Bold/italic: **text** or __text__ or *text* or _text_
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    // Strikethrough: ~~text~~
    .replace(/~~([^~]+)~~/g, '$1')
    // Inline code: `text`
    .replace(/`([^`]+)`/g, '$1')
    // List markers: - item, * item, 1. item, - [ ] item, - [x] item
    .replace(/^[\s]*[-*+]\s+(\[[ x]\]\s+)?/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Blockquote markers: > text
    .replace(/^>\s*/gm, '')
    // Link syntax: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Image syntax: ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .trim();
}


// ---------------------------------------------------------------------------
// Scheduling: one run per path at a time
// ---------------------------------------------------------------------------

/** Let the agent finish writing the file before reading it. */
const SETTLE_MS = 300;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();
/** Paths that changed again while their run was in flight. */
const rerun = new Map<string, string>();

function runPendingCommentFile(pendingFilePath: string, projectRoot: string): void {
  if (inFlight.has(pendingFilePath)) {
    // A run is reading this file right now. Two runs would both see
    // "not processed yet" and both add every comment, so wait for it.
    rerun.set(pendingFilePath, projectRoot);
    return;
  }
  inFlight.add(pendingFilePath);
  processPendingCommentFile(pendingFilePath, projectRoot)
    .catch((err: unknown) => {
      log.error('pending-comments', `Failed to process: ${pendingFilePath}`, err);
    })
    .finally(() => {
      inFlight.delete(pendingFilePath);
      const again = rerun.get(pendingFilePath);
      if (again !== undefined) {
        rerun.delete(pendingFilePath);
        runPendingCommentFile(pendingFilePath, again);
      }
    });
}

/**
 * Process a pending-comment file after a watcher event, debounced per path
 * and never concurrently with another run for the same path. An agent's
 * create followed by a modify must add its comments once, not twice.
 */
export function schedulePendingCommentFile(pendingFilePath: string, projectRoot: string): void {
  const existing = pendingTimers.get(pendingFilePath);
  if (existing !== undefined) clearTimeout(existing);
  pendingTimers.set(
    pendingFilePath,
    setTimeout(() => {
      pendingTimers.delete(pendingFilePath);
      runPendingCommentFile(pendingFilePath, projectRoot);
    }, SETTLE_MS),
  );
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

/**
 * Process a pending comments JSON file.
 * Creates proper comments and updates the file with results.
 */
export async function processPendingCommentFile(
  pendingFilePath: string,
  projectRoot: string,
): Promise<void> {
  let raw: string;
  try {
    raw = await invoke<string>('read_file', { path: pendingFilePath });
  } catch (err) {
    log.error('pending-comments', `Failed to read: ${pendingFilePath}`, err);
    return;
  }

  // An empty file is one the agent has created but not written yet; the
  // write that follows raises its own event.
  if (typeof raw !== 'string' || raw.trim() === '') return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.error('pending-comments', `Failed to parse: ${pendingFilePath}`, err);
    await writePendingResult(pendingFilePath, { status: 'processed', reason: 'invalid JSON' });
    return;
  }

  if (!isObject(parsed)) {
    log.warn('pending-comments', `Not a JSON object: ${pendingFilePath}`);
    await writePendingResult(pendingFilePath, { status: 'processed', reason: 'expected a JSON object' });
    return;
  }
  const pending: JsonObject = parsed;

  // Skip already-processed files
  if (pending.status === 'processed') return;

  /** Mark the whole file as handled-but-unusable, so it is not retried. */
  const reject = async (reason: string): Promise<void> => {
    log.warn('pending-comments', `Rejected ${pendingFilePath}: ${reason}`);
    await writePendingResult(pendingFilePath, { ...pending, status: 'processed', reason });
  };

  if (typeof pending.file !== 'string' || !pending.file) {
    await reject('missing file field');
    return;
  }

  const targetPath = resolveTargetPath(pending.file, projectRoot);
  if (!targetPath) {
    await reject('file is outside the project');
    return;
  }

  // Handle resolve action
  if (Array.isArray(pending.resolve) && pending.resolve.length > 0) {
    await processResolveAction(pendingFilePath, pending, pending.resolve, targetPath, projectRoot);
    return;
  }

  if (!Array.isArray(pending.comments) || pending.comments.length === 0) {
    await reject('no comments or resolve actions');
    return;
  }

  // Per-comment results, written back in the agent's own order. A malformed
  // entry is reported, not dropped, so the indexes still line up.
  const entries: unknown[] = pending.comments;
  const results: JsonObject[] = entries.map((entry) => (isObject(entry) ? { ...entry } : {}));
  const skip = (index: number, reason: string) => {
    results[index].status = 'skipped';
    results[index].reason = reason;
  };

  // Read the target file
  let fileContent: string;
  try {
    fileContent = await invoke<string>('read_file', { path: targetPath });
  } catch (err) {
    log.error('pending-comments', `Target not found: ${targetPath}`, err);
    // Update the pending file with error
    results.forEach((_, index) => skip(index, 'target file not found'));
    await writePendingResult(pendingFilePath, {
      ...pending,
      status: 'processed',
      added: 0,
      skipped: results.length,
      comments: results,
    });
    return;
  }

  // Derive comment key
  const { frontmatter } = parseFrontmatter(fileContent);
  const commentKey = getDocumentId(frontmatter) || hashPath(targetPath);

  // Load existing comments
  const commentStore = useCommentStore.getState();
  if (!commentStore.commentsByDocument[commentKey]) {
    await commentStore.loadComments(commentKey, projectRoot);
  }

  // Read the active tab only now, after the awaits: the user may have switched
  // tabs meanwhile, and positions must come from the document that is showing.
  const editor = getActiveEditorFor(targetPath);

  let addedCount = 0;
  let skippedCount = 0;

  entries.forEach((entry, index) => {
    const c = validateComment(entry);
    if (typeof c === 'string') {
      skip(index, c);
      skippedCount++;
      return;
    }

    let from: number;
    let to: number;

    // Strip markdown syntax for PM-compatible anchor text
    const strippedAnchor = stripMarkdownSyntax(c.anchor_text);
    // Use stripped version for storage (matches what PM will have)
    const anchorForStorage = strippedAnchor || c.anchor_text;

    if (editor) {
      // Active file — use ProseMirror positions (try stripped first, fall back to raw)
      const range = findTextInDoc(editor.state.doc, strippedAnchor, c.occurrence)
        ?? findTextInDoc(editor.state.doc, c.anchor_text, c.occurrence);
      if (!range) {
        skip(index, 'text not found in document');
        skippedCount++;
        return;
      }
      from = range.from;
      to = range.to;
    } else {
      // Non-active file — search raw content (try original first since it's raw markdown)
      let searchFrom = 0;
      let foundIdx = -1;
      for (let i = 0; i < c.occurrence; i++) {
        foundIdx = fileContent.indexOf(c.anchor_text, searchFrom);
        if (foundIdx === -1) break;
        searchFrom = foundIdx + 1;
      }
      if (foundIdx === -1) {
        skip(index, 'text not found in document');
        skippedCount++;
        return;
      }
      from = foundIdx;
      to = foundIdx + c.anchor_text.length;
    }

    const comment = useCommentStore.getState().addComment({
      documentId: commentKey,
      anchorText: anchorForStorage,
      from,
      to,
      body: c.body,
      author: 'AI',
      status: 'open',
    });

    results[index].status = 'added';
    results[index].comment_id = comment.id;
    addedCount++;
  });

  // Persist comments
  await useCommentStore.getState().saveComments(commentKey, projectRoot);

  // Refresh decorations if the file is (still) active
  refreshDecorations(targetPath, commentKey);

  // Update the pending file with results (agent can read this back)
  await writePendingResult(pendingFilePath, {
    ...pending,
    status: 'processed',
    added: addedCount,
    skipped: skippedCount,
    comments: results,
  });

  // Notify the user
  const fileName = targetPath.split('/').pop() || 'document';
  if (addedCount > 0) {
    toast.success(`${addedCount} comment${addedCount !== 1 ? 's' : ''} added to ${fileName}`, {
      description: skippedCount > 0 ? `${skippedCount} skipped (text not found)` : undefined,
    });
  }

  log.info('pending-comments', `Processed ${pendingFilePath}: ${addedCount} added, ${skippedCount} skipped`);
}

async function processResolveAction(
  pendingFilePath: string,
  pending: JsonObject,
  resolveIds: unknown[],
  targetPath: string,
  projectRoot: string,
): Promise<void> {
  // Derive comment key
  let fileContent: string;
  try {
    fileContent = await invoke<string>('read_file', { path: targetPath });
  } catch {
    await writePendingResult(pendingFilePath, { ...pending, status: 'processed', resolved: 0 });
    return;
  }

  const { frontmatter } = parseFrontmatter(fileContent);
  const commentKey = getDocumentId(frontmatter) || hashPath(targetPath);

  // Load comments if needed
  const commentStore = useCommentStore.getState();
  if (!commentStore.commentsByDocument[commentKey]) {
    await commentStore.loadComments(commentKey, projectRoot);
  }

  let resolvedCount = 0;
  for (const id of resolveIds) {
    // IDs come from the agent: anything that is not a string cannot match.
    if (typeof id !== 'string') continue;
    const existing = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
    if (existing.find((c) => c.id === id)) {
      useCommentStore.getState().setCommentStatus(commentKey, id, 'resolved');
      resolvedCount++;
    }
  }

  await useCommentStore.getState().saveComments(commentKey, projectRoot);

  // Refresh decorations if active
  refreshDecorations(targetPath, commentKey);

  await writePendingResult(pendingFilePath, { ...pending, status: 'processed', resolved: resolvedCount });

  const fileName = targetPath.split('/').pop() || 'document';
  if (resolvedCount > 0) {
    toast.success(`${resolvedCount} comment${resolvedCount !== 1 ? 's' : ''} resolved in ${fileName}`);
  }

  log.info('pending-comments', `Resolved ${resolvedCount} comments via ${pendingFilePath}`);
}

/** Redraw comment highlights, but only if `targetPath` is the document showing right now. */
function refreshDecorations(targetPath: string, commentKey: string): void {
  const editor = getActiveEditorFor(targetPath);
  if (!editor) return;
  const allComments = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
  setCommentDecorations(editor, allComments.filter((c) => c.status !== 'resolved'));
}

async function writePendingResult(filePath: string, data: JsonObject): Promise<void> {
  try {
    await invoke('write_file', { path: filePath, content: JSON.stringify(data, null, 2) });
  } catch (err) {
    log.error('pending-comments', `Failed to write result: ${filePath}`, err);
  }
}
