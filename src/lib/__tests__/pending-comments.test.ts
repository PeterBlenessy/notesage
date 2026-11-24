// @vitest-environment jsdom
/**
 * The pending-comments processor is an input boundary: the JSON it reads is
 * written by an agent. These tests run it against an in-memory file system
 * and the real comment store, and assert both the store and the file the
 * agent reads back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CommentMark, CommentMarkPluginKey } from '@/components/editor/extensions/comment-mark';
import { processPendingCommentFile, schedulePendingCommentFile } from '@/lib/pending-comments';
import { useCommentStore } from '@/stores/comment-store';
import { useEditorStore } from '@/stores/editor-store';
import { setEditorRef } from '@/lib/editor-bridge';
import { hashPath } from '@/lib/comment-storage';

const ROOT = '/Users/tester/Projects/alpha';
const PENDING = `${ROOT}/.notesage/pending-comments/review.json`;
const DOC = `${ROOT}/notes/doc.md`;
const DOC_KEY = hashPath(DOC);
const DOC_TEXT = 'Alpha beta gamma.\n\nSecond beta paragraph.\n';

let files: Map<string, string>;
/** Every path the processor (or the store) wrote, in order. */
let writes: string[];

function installFs() {
  files = new Map();
  writes = [];
  setMockInvokeHandler('read_file', (args) => {
    const path = String(args?.path);
    const content = files.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  });
  setMockInvokeHandler('write_file', (args) => {
    const path = String(args?.path);
    writes.push(path);
    files.set(path, String(args?.content));
  });
  setMockInvokeHandler('path_exists', (args) => {
    const path = String(args?.path);
    return files.has(path) || [...files.keys()].some((f) => f.startsWith(`${path}/`));
  });
  setMockInvokeHandler('create_directory', () => undefined);
}

function writePending(data: unknown) {
  files.set(PENDING, typeof data === 'string' ? data : JSON.stringify(data));
}

function readPending(): Record<string, unknown> {
  return JSON.parse(files.get(PENDING) ?? 'null') as Record<string, unknown>;
}

function resultComments(): Array<Record<string, unknown>> {
  return readPending().comments as Array<Record<string, unknown>>;
}

function storeComments(key = DOC_KEY) {
  return useCommentStore.getState().commentsByDocument[key] ?? [];
}

function sidecar(key = DOC_KEY): string | undefined {
  return files.get(`${ROOT}/.notesage/comments/${key}.json`);
}

describe('processPendingCommentFile', () => {
  beforeEach(() => {
    installFs();
    files.set(DOC, DOC_TEXT);
    useCommentStore.setState({ commentsByDocument: {}, loadFailedByDocument: {}, activeCommentId: null });
    useEditorStore.setState({ openDocuments: [], activeTabId: null });
    setEditorRef(null);
  });

  describe('adding comments to a file that is not open', () => {
    it('adds each comment, saves the sidecar and reports ids back to the agent', async () => {
      writePending({
        file: 'notes/doc.md',
        comments: [
          { anchor_text: 'Alpha', body: 'First' },
          { anchor_text: 'beta', body: 'Second one', occurrence: 2 },
        ],
      });

      await processPendingCommentFile(PENDING, ROOT);

      const comments = storeComments();
      expect(comments.map((c) => [c.anchorText, c.body, c.author, c.status])).toEqual([
        ['Alpha', 'First', 'AI', 'open'],
        ['beta', 'Second one', 'AI', 'open'],
      ]);
      expect(comments[0].from).toBe(0);
      expect(comments[1].from).toBe(DOC_TEXT.indexOf('beta', DOC_TEXT.indexOf('beta') + 1));
      expect(sidecar()).toContain('Second one');

      const result = readPending();
      expect(result).toMatchObject({ file: 'notes/doc.md', status: 'processed', added: 2, skipped: 0 });
      expect(resultComments().map((c) => [c.status, c.comment_id])).toEqual([
        ['added', comments[0].id],
        ['added', comments[1].id],
      ]);
    });

    it('accepts an absolute path that is inside the project', async () => {
      writePending({ file: DOC, comments: [{ anchor_text: 'gamma', body: 'B' }] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(storeComments()).toHaveLength(1);
      expect(readPending()).toMatchObject({ status: 'processed', added: 1 });
    });

    it('keys the comments on the frontmatter id when the document has one', async () => {
      files.set(DOC, `---\nid: doc-uuid-1\n---\n${DOC_TEXT}`);
      writePending({ file: 'notes/doc.md', comments: [{ anchor_text: 'gamma', body: 'B' }] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(storeComments('doc-uuid-1')).toHaveLength(1);
      expect(sidecar('doc-uuid-1')).toBeDefined();
    });

    it('falls back to the path hash when the frontmatter id is not usable as a file name', async () => {
      files.set(DOC, `---\nid: ../../escape\n---\n${DOC_TEXT}`);
      writePending({ file: 'notes/doc.md', comments: [{ anchor_text: 'gamma', body: 'B' }] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(storeComments()).toHaveLength(1);
      expect(writes.every((p) => p === PENDING || p.startsWith(`${ROOT}/.notesage/comments/path-`))).toBe(true);
    });

    it('skips an anchor that is not in the document and still adds the rest', async () => {
      writePending({
        file: 'notes/doc.md',
        comments: [
          { anchor_text: 'not in the text', body: 'A' },
          { anchor_text: 'beta', body: 'B', occurrence: 3 },
          { anchor_text: 'gamma', body: 'C' },
        ],
      });

      await processPendingCommentFile(PENDING, ROOT);

      expect(storeComments().map((c) => c.body)).toEqual(['C']);
      expect(readPending()).toMatchObject({ status: 'processed', added: 1, skipped: 2 });
      expect(resultComments().map((c) => [c.status, c.reason])).toEqual([
        ['skipped', 'text not found in document'],
        ['skipped', 'text not found in document'],
        ['added', undefined],
      ]);
    });

    it('marks every comment skipped when the target file does not exist', async () => {
      writePending({ file: 'notes/missing.md', comments: [{ anchor_text: 'a', body: 'b' }] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(readPending()).toMatchObject({ status: 'processed', added: 0, skipped: 1 });
      expect(resultComments()[0]).toMatchObject({ status: 'skipped', reason: 'target file not found' });
      expect(useCommentStore.getState().commentsByDocument).toEqual({});
    });
  });

  describe('idempotency', () => {
    it('does nothing for a file already marked processed', async () => {
      writePending({ file: 'notes/doc.md', status: 'processed', comments: [{ anchor_text: 'Alpha', body: 'A' }] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(writes).toEqual([]);
      expect(storeComments()).toEqual([]);
    });

    it('adds nothing the second time the same file is processed', async () => {
      writePending({ file: 'notes/doc.md', comments: [{ anchor_text: 'Alpha', body: 'A' }] });

      await processPendingCommentFile(PENDING, ROOT);
      await processPendingCommentFile(PENDING, ROOT);

      expect(storeComments()).toHaveLength(1);
    });
  });

  describe('malformed input', () => {
    it('ignores an empty file: the agent has created it but not written it yet', async () => {
      writePending('  \n');

      await processPendingCommentFile(PENDING, ROOT);

      expect(writes).toEqual([]);
    });

    it.each([
      ['invalid JSON', '{ "file": "notes/doc.md", "comments": [', 'invalid JSON'],
      ['null', 'null', 'expected a JSON object'],
      ['an array', '[1, 2]', 'expected a JSON object'],
      ['a string', '"hello"', 'expected a JSON object'],
      ['no file field', '{"comments":[{"anchor_text":"Alpha","body":"A"}]}', 'missing file field'],
      ['a non-string file', '{"file":{"path":"notes/doc.md"},"comments":[]}', 'missing file field'],
      ['neither comments nor resolve', '{"file":"notes/doc.md"}', 'no comments or resolve actions'],
      ['comments that is not a list', '{"file":"notes/doc.md","comments":"Alpha"}', 'no comments or resolve actions'],
    ])('marks %s as processed with a reason instead of throwing', async (_label, raw, reason) => {
      writePending(raw);

      await expect(processPendingCommentFile(PENDING, ROOT)).resolves.toBeUndefined();

      expect(readPending()).toMatchObject({ status: 'processed', reason });
      expect(useCommentStore.getState().commentsByDocument).toEqual({});
      // Marked, so the watcher's next event for this file is a no-op.
      const before = writes.length;
      await processPendingCommentFile(PENDING, ROOT);
      expect(writes).toHaveLength(before);
    });

    it('skips malformed comment entries one by one and adds the valid ones', async () => {
      writePending({
        file: 'notes/doc.md',
        comments: [
          null,
          'just a string',
          { anchor_text: 42, body: 'number anchor' },
          { anchor_text: 'Alpha', body: { nested: true } },
          { anchor_text: 'Alpha' },
          { anchor_text: 'beta', body: 'bad occurrence', occurrence: '2' },
          { anchor_text: 'beta', body: 'fractional', occurrence: 1.5 },
          { anchor_text: 'gamma', body: 'the good one' },
        ],
      });

      await expect(processPendingCommentFile(PENDING, ROOT)).resolves.toBeUndefined();

      expect(storeComments().map((c) => c.body)).toEqual(['the good one']);
      expect(readPending()).toMatchObject({ status: 'processed', added: 1, skipped: 7 });
      expect(resultComments().map((c) => c.reason)).toEqual([
        'comment is not an object',
        'comment is not an object',
        'missing anchor_text or body',
        'missing anchor_text or body',
        'missing anchor_text or body',
        'occurrence must be a positive integer',
        'occurrence must be a positive integer',
        undefined,
      ]);
      // Every stored body is a string: nothing an agent wrote reaches render as an object.
      expect(storeComments().every((c) => typeof c.body === 'string')).toBe(true);
    });
  });

  describe('a file outside the project', () => {
    it.each([
      ['an absolute path elsewhere', '/etc/passwd'],
      ['a relative path that climbs out', '../beta/notes/doc.md'],
      ['a path that climbs out and back into a sibling', 'notes/../../alpha-other/doc.md'],
      ['an absolute path that climbs out', `${ROOT}/../beta/doc.md`],
      ['the project root itself', ROOT],
    ])('rejects %s without reading it', async (_label, file) => {
      const reads: string[] = [];
      setMockInvokeHandler('read_file', (args) => {
        const path = String(args?.path);
        reads.push(path);
        return files.get(path) ?? 'Alpha outside';
      });
      writePending({ file, comments: [{ anchor_text: 'Alpha', body: 'A' }] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(reads).toEqual([PENDING]);
      expect(readPending()).toMatchObject({ status: 'processed', reason: 'file is outside the project' });
      expect(useCommentStore.getState().commentsByDocument).toEqual({});
      expect(writes).toEqual([PENDING]);
    });

    it('rejects a resolve action aimed outside the project too', async () => {
      writePending({ file: '../beta/doc.md', resolve: ['c1'] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(readPending()).toMatchObject({ status: 'processed', reason: 'file is outside the project' });
    });

    it('accepts a path with harmless dot segments that stays inside', async () => {
      writePending({ file: './notes/../notes/doc.md', comments: [{ anchor_text: 'Alpha', body: 'A' }] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(storeComments()).toHaveLength(1);
    });
  });

  describe('resolve actions', () => {
    function seedComments() {
      const add = useCommentStore.getState().addComment;
      const a = add({ documentId: DOC_KEY, anchorText: 'Alpha', from: 0, to: 5, body: 'A', author: 'You' });
      const b = add({ documentId: DOC_KEY, anchorText: 'gamma', from: 11, to: 16, body: 'B', author: 'You' });
      return { a, b };
    }

    it('resolves the listed comments, saves and reports the count', async () => {
      const { a, b } = seedComments();
      writePending({ file: 'notes/doc.md', resolve: [a.id, 'unknown-id'] });

      await processPendingCommentFile(PENDING, ROOT);

      const byId = new Map(storeComments().map((c) => [c.id, c.status]));
      expect(byId.get(a.id)).toBe('resolved');
      expect(byId.get(b.id)).not.toBe('resolved');
      expect(sidecar()).toContain('"resolved"');
      expect(readPending()).toMatchObject({ status: 'processed', resolved: 1 });
    });

    it('ignores ids that are not strings', async () => {
      const { a } = seedComments();
      writePending({ file: 'notes/doc.md', resolve: [null, 7, { id: a.id }, [a.id]] });

      await expect(processPendingCommentFile(PENDING, ROOT)).resolves.toBeUndefined();

      expect(storeComments().some((c) => c.status === 'resolved')).toBe(false);
      expect(readPending()).toMatchObject({ status: 'processed', resolved: 0 });
    });

    it('reports zero when the target file is missing', async () => {
      writePending({ file: 'notes/missing.md', resolve: ['c1'] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(readPending()).toMatchObject({ status: 'processed', resolved: 0 });
    });
  });

  describe('the active file', () => {
    let editor: Editor;

    function openEditor(filePath: string, html: string) {
      const el = document.createElement('div');
      document.body.appendChild(el);
      editor = new Editor({ element: el, extensions: [StarterKit, CommentMark], content: html });
      setEditorRef(editor);
      useEditorStore.setState({
        openDocuments: [{
          id: 'tab-1',
          filePath,
          fileName: filePath.split('/').pop() ?? '',
          isDirty: false,
          content: '',
          frontmatter: null,
          fileType: 'markdown' as const,
          contentLoaded: true,
        }],
        activeTabId: 'tab-1',
      });
    }

    function decoratedIds(): string[] {
      const state = CommentMarkPluginKey.getState(editor.state) as { comments: Array<{ commentId: string }> };
      return state.comments.map((c) => c.commentId);
    }

    afterEach(() => {
      editor?.destroy();
      setEditorRef(null);
    });

    it('anchors with ProseMirror positions and strips markdown syntax from the anchor', async () => {
      files.set(DOC, '## Heading here\n\nSome **bold** words.\n');
      openEditor(DOC, '<h2>Heading here</h2><p>Some <strong>bold</strong> words.</p>');
      writePending({
        file: 'notes/doc.md',
        comments: [
          { anchor_text: '## Heading here', body: 'H' },
          { anchor_text: 'Some **bold** words', body: 'B' },
        ],
      });

      await processPendingCommentFile(PENDING, ROOT);

      const comments = storeComments();
      expect(comments.map((c) => c.anchorText)).toEqual(['Heading here', 'Some bold words']);
      for (const c of comments) {
        expect(editor.state.doc.textBetween(c.from, c.to, '\n')).toBe(c.anchorText);
      }
      expect(decoratedIds()).toEqual(comments.map((c) => c.id));
    });

    it('does not decorate, or take positions from, another document that is showing', async () => {
      // The open tab is a different file that happens to contain the same words.
      openEditor(`${ROOT}/notes/other.md`, '<p>padding padding Alpha</p>');
      writePending({ file: 'notes/doc.md', comments: [{ anchor_text: 'Alpha', body: 'A' }] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(storeComments()[0].from).toBe(0); // raw-file offset, not the other editor's position
      expect(decoratedIds()).toEqual([]);
    });

    it('uses the tab that is active after loading, not the one active when the run began', async () => {
      // doc.md is showing when the run starts; the user switches to other.md
      // while the comment sidecar is being loaded.
      openEditor(DOC, '<p>Alpha beta gamma.</p>');
      setMockInvokeHandler('path_exists', (args) => {
        if (String(args?.path).endsWith(`${DOC_KEY}.json`)) {
          editor.commands.setContent('<p>padding padding Alpha</p>');
          useEditorStore.setState((s) => ({
            openDocuments: s.openDocuments.map((d) => ({ ...d, filePath: `${ROOT}/notes/other.md` })),
          }));
        }
        return false;
      });
      writePending({ file: 'notes/doc.md', comments: [{ anchor_text: 'Alpha', body: 'A' }] });

      await processPendingCommentFile(PENDING, ROOT);

      expect(storeComments()[0].from).toBe(0);
      expect(decoratedIds()).toEqual([]);
    });
  });
});

describe('schedulePendingCommentFile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFs();
    files.set(DOC, DOC_TEXT);
    useCommentStore.setState({ commentsByDocument: {}, loadFailedByDocument: {}, activeCommentId: null });
    useEditorStore.setState({ openDocuments: [], activeTabId: null });
    setEditorRef(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const pendingOne = { file: 'notes/doc.md', comments: [{ anchor_text: 'Alpha', body: 'A' }] };

  it('coalesces a create followed by a modify into one run', async () => {
    writePending(pendingOne);

    schedulePendingCommentFile(PENDING, ROOT); // create
    await vi.advanceTimersByTimeAsync(100);
    schedulePendingCommentFile(PENDING, ROOT); // modify, same batch window
    await vi.advanceTimersByTimeAsync(1000);

    expect(storeComments()).toHaveLength(1);
  });

  it('does not start a second run for a path while one is in flight', async () => {
    writePending(pendingOne);
    // Hold the first run inside its read of the target document.
    let releaseRead: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseRead = resolve; });
    setMockInvokeHandler('read_file', async (args) => {
      const path = String(args?.path);
      if (path === DOC) await gate;
      const content = files.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    });

    schedulePendingCommentFile(PENDING, ROOT);
    await vi.advanceTimersByTimeAsync(300); // run 1 is now waiting on the read
    schedulePendingCommentFile(PENDING, ROOT); // a later modify event
    await vi.advanceTimersByTimeAsync(300); // its timer fires while run 1 is in flight

    releaseRead();
    await vi.advanceTimersByTimeAsync(1000);

    // The deferred run happened after run 1 marked the file processed.
    expect(storeComments()).toHaveLength(1);
    expect(readPending()).toMatchObject({ status: 'processed', added: 1 });
  });

  it('runs different paths independently', async () => {
    const other = `${ROOT}/.notesage/pending-comments/second.json`;
    writePending(pendingOne);
    files.set(other, JSON.stringify({ file: 'notes/doc.md', comments: [{ anchor_text: 'gamma', body: 'G' }] }));

    schedulePendingCommentFile(PENDING, ROOT);
    schedulePendingCommentFile(other, ROOT);
    await vi.advanceTimersByTimeAsync(1000);

    expect(storeComments().map((c) => c.body).sort()).toEqual(['A', 'G']);
  });

  it('never rejects unhandled when processing throws', async () => {
    writePending(pendingOne);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const saveComments = useCommentStore.getState().saveComments;
    useCommentStore.setState({ saveComments: async () => { throw new Error('disk full'); } });

    try {
      schedulePendingCommentFile(PENDING, ROOT);
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      useCommentStore.setState({ saveComments });
    }
  });
});
