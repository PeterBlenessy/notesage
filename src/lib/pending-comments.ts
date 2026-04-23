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
 */

import { invoke } from '@tauri-apps/api/core';
import { useCommentStore } from '@/stores/comment-store';
import { useEditorStore } from '@/stores/editor-store';
import { getEditorRef } from '@/lib/editor-bridge';
import { findTextInDoc } from '@/lib/pm-text-search';
import { setCommentDecorations } from '@/components/editor/extensions/comment-mark';
import { parseFrontmatter } from '@/lib/frontmatter';
import { toast } from 'sonner';
import { log } from '@/lib/logger';

interface PendingComment {
  anchor_text: string;
  body: string;
  occurrence?: number;
  // Set by processing:
  status?: 'added' | 'skipped';
  comment_id?: string;
  reason?: string;
}

interface PendingCommentFile {
  file: string;
  status?: 'pending' | 'processed';
  added?: number;
  skipped?: number;
  comments?: PendingComment[];
  /** Comment IDs to resolve (written by agent after fixing issues). */
  resolve?: string[];
  resolved?: number;
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

/** Simple deterministic hash of a string → hex string (matches useCommentOperations). */
function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return 'path-' + (h >>> 0).toString(16);
}

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

  let pending: PendingCommentFile;
  try {
    pending = JSON.parse(raw) as PendingCommentFile;
  } catch (err) {
    log.error('pending-comments', `Failed to parse: ${pendingFilePath}`, err);
    return;
  }

  // Skip already-processed files
  if (pending.status === 'processed') return;

  if (!pending.file) {
    log.warn('pending-comments', `Missing file field: ${pendingFilePath}`);
    return;
  }

  // Handle resolve action
  if (Array.isArray(pending.resolve) && pending.resolve.length > 0) {
    await processResolveAction(pendingFilePath, pending, projectRoot);
    return;
  }

  if (!Array.isArray(pending.comments) || pending.comments.length === 0) {
    log.warn('pending-comments', `No comments or resolve actions: ${pendingFilePath}`);
    return;
  }

  // Resolve the target file path
  const targetPath = pending.file.startsWith('/')
    ? pending.file
    : `${projectRoot}/${pending.file}`;

  // Read the target file
  let fileContent: string;
  try {
    fileContent = await invoke<string>('read_file', { path: targetPath });
  } catch (err) {
    log.error('pending-comments', `Target not found: ${targetPath}`, err);
    // Update the pending file with error
    pending.status = 'processed';
    pending.added = 0;
    pending.skipped = pending.comments.length;
    for (const c of pending.comments) {
      c.status = 'skipped';
      c.reason = 'target file not found';
    }
    await writePendingResult(pendingFilePath, pending);
    return;
  }

  // Derive comment key
  const { frontmatter } = parseFrontmatter(fileContent);
  const documentId = (frontmatter?.id as string) ?? null;
  const commentKey = documentId || hashPath(targetPath);

  // Check if target is the active file
  const editorState = useEditorStore.getState();
  const activeTab = editorState.openDocuments.find((t) => t.id === editorState.activeTabId);
  const isActiveFile = activeTab?.filePath === targetPath;
  const editor = isActiveFile ? getEditorRef() : null;

  // Load existing comments
  const commentStore = useCommentStore.getState();
  if (!commentStore.commentsByDocument[commentKey]) {
    await commentStore.loadComments(commentKey, projectRoot);
  }

  let addedCount = 0;
  let skippedCount = 0;

  for (const c of pending.comments) {
    if (!c.anchor_text || !c.body) {
      c.status = 'skipped';
      c.reason = 'missing anchor_text or body';
      skippedCount++;
      continue;
    }

    let from: number;
    let to: number;

    // Strip markdown syntax for PM-compatible anchor text
    const strippedAnchor = stripMarkdownSyntax(c.anchor_text);
    // Use stripped version for storage (matches what PM will have)
    const anchorForStorage = strippedAnchor || c.anchor_text;

    if (editor && isActiveFile) {
      // Active file — use ProseMirror positions (try stripped first, fall back to raw)
      const range = findTextInDoc(editor.state.doc, strippedAnchor, c.occurrence ?? 1)
        ?? findTextInDoc(editor.state.doc, c.anchor_text, c.occurrence ?? 1);
      if (!range) {
        c.status = 'skipped';
        c.reason = 'text not found in document';
        skippedCount++;
        continue;
      }
      from = range.from;
      to = range.to;
    } else {
      // Non-active file — search raw content (try original first since it's raw markdown)
      const occurrence = c.occurrence ?? 1;
      let searchFrom = 0;
      let foundIdx = -1;
      for (let i = 0; i < occurrence; i++) {
        foundIdx = fileContent.indexOf(c.anchor_text, searchFrom);
        if (foundIdx === -1) break;
        searchFrom = foundIdx + 1;
      }
      if (foundIdx === -1) {
        c.status = 'skipped';
        c.reason = 'text not found in document';
        skippedCount++;
        continue;
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

    c.status = 'added';
    c.comment_id = comment.id;
    addedCount++;
  }

  // Persist comments
  await useCommentStore.getState().saveComments(commentKey, projectRoot);

  // Refresh decorations if the file is active
  if (editor && isActiveFile) {
    const allComments = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
    setCommentDecorations(editor, allComments.filter((c) => c.status !== 'resolved'));
  }

  // Update the pending file with results (agent can read this back)
  pending.status = 'processed';
  pending.added = addedCount;
  pending.skipped = skippedCount;
  await writePendingResult(pendingFilePath, pending);

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
  pending: PendingCommentFile,
  projectRoot: string,
): Promise<void> {
  if (pending.status === 'processed') return;

  const targetPath = pending.file.startsWith('/')
    ? pending.file
    : `${projectRoot}/${pending.file}`;

  // Derive comment key
  let fileContent: string;
  try {
    fileContent = await invoke<string>('read_file', { path: targetPath });
  } catch {
    pending.status = 'processed';
    pending.resolved = 0;
    await writePendingResult(pendingFilePath, pending);
    return;
  }

  const { frontmatter } = parseFrontmatter(fileContent);
  const documentId = (frontmatter?.id as string) ?? null;
  const commentKey = documentId || hashPath(targetPath);

  // Load comments if needed
  const commentStore = useCommentStore.getState();
  if (!commentStore.commentsByDocument[commentKey]) {
    await commentStore.loadComments(commentKey, projectRoot);
  }

  let resolvedCount = 0;
  for (const id of pending.resolve!) {
    const existing = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
    if (existing.find((c) => c.id === id)) {
      useCommentStore.getState().setCommentStatus(commentKey, id, 'resolved');
      resolvedCount++;
    }
  }

  await useCommentStore.getState().saveComments(commentKey, projectRoot);

  // Refresh decorations if active
  const editorState = useEditorStore.getState();
  const activeTab = editorState.openDocuments.find((t) => t.id === editorState.activeTabId);
  if (activeTab?.filePath === targetPath) {
    const editor = getEditorRef();
    if (editor) {
      const allComments = useCommentStore.getState().commentsByDocument[commentKey] ?? [];
      setCommentDecorations(editor, allComments.filter((c) => c.status !== 'resolved'));
    }
  }

  pending.status = 'processed';
  pending.resolved = resolvedCount;
  await writePendingResult(pendingFilePath, pending);

  const fileName = targetPath.split('/').pop() || 'document';
  if (resolvedCount > 0) {
    toast.success(`${resolvedCount} comment${resolvedCount !== 1 ? 's' : ''} resolved in ${fileName}`);
  }

  log.info('pending-comments', `Resolved ${resolvedCount} comments via ${pendingFilePath}`);
}

async function writePendingResult(filePath: string, data: PendingCommentFile): Promise<void> {
  try {
    await invoke('write_file', { path: filePath, content: JSON.stringify(data, null, 2) });
  } catch (err) {
    log.error('pending-comments', `Failed to write result: ${filePath}`, err);
  }
}
