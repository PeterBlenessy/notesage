/**
 * Regression guard for the streamingHydrate performance budget.
 *
 * Context: The naive fix for issue #220 (toolbar alignment on embedded blocks)
 * is to expand TextAlign.addGlobalAttributes to include image/chart/drawing/
 * linkPreview node types. That approach was tried and reverted in commit
 * ba4fe785 because it inflated each node's attr set and slowed setContent from
 * ~3 s to ~12 s on a 494 KB book. The correct fix is a custom Extension that
 * only touches the selection when invoked — zero per-node schema overhead.
 *
 * This test feeds the 100KB fixture through parseMarkdownToProseMirrorJson and
 * then streamingHydrate, asserting that the hydration step finishes within the
 * budget. A 4x regression (the kind caused by the forbidden approach) would
 * immediately fail this test even on the text-only fixture.
 *
 * This test is a REGRESSION GUARD, not a new-feature test — it must be GREEN
 * both before and after the EmbeddedBlockAlign implementation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import UniqueID from '@tiptap/extension-unique-id';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Node, mergeAttributes } from '@tiptap/core';
import { benchmark, setupJSDOM } from './harness';
import { parseMarkdownToProseMirrorJson } from '@/workers/markdown-parse.core';
import { streamingHydrate } from '@/lib/markdown';

// ---------------------------------------------------------------------------
// jsdom bootstrap
// ---------------------------------------------------------------------------

beforeAll(() => {
  setupJSDOM();
  // requestAnimationFrame is needed by streamingHydrate between chunks.
  // jsdom provides a real-ish rAF that fires via microtask/timeout — wire it
  // if it's missing so the streaming loop can run to completion in tests.
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = setTimeout(() => cb(performance.now()), 0);
      return id as unknown as number;
    };
    globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
});

// ---------------------------------------------------------------------------
// Minimal React-free shims for embedded block nodes (same schema as production)
// ---------------------------------------------------------------------------

const lowlight = createLowlight(common);

const DrawingShim = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      drawingId: { default: null },
      width: { default: null },
      height: { default: 600 },
      drawingJson: { default: null },
      blockWidth: { default: null },
      align: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'div[data-drawing-json]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawing' })];
  },
});

const ChartShim = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      chartId: { default: null },
      width: { default: null },
      height: { default: 300 },
      chartJson: { default: null },
      blockWidth: { default: null },
      align: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'div[data-chart-json]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'chart' })];
  },
});

const LinkPreviewShim = Node.create({
  name: 'linkPreview',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: '' },
      title: { default: null },
      description: { default: null },
      siteName: { default: null },
      imageUrl: { default: null },
      faviconUrl: { default: null },
      blockWidth: { default: null },
      align: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'div[data-link-preview]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'linkPreview' })];
  },
});

// ---------------------------------------------------------------------------
// Fixture + editor factory
// ---------------------------------------------------------------------------

const fixturesDir = join(__dirname, '../../tests/fixtures/perf');
const fixture100KB = readFileSync(join(fixturesDir, 'perf-100kb.md'), 'utf-8');

function createHydrateEditor(): Editor {
  const el = document.createElement('div');
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Subscript,
      Superscript,
      UniqueID.configure({ types: ['heading', 'paragraph'] }),
      DrawingShim,
      ChartShim,
      LinkPreviewShim,
    ],
    content: '',
    editable: true,
  });
}

// ---------------------------------------------------------------------------
// Benchmark — streamingHydrate on the 100KB fixture
// ---------------------------------------------------------------------------

// Budget: ~1500ms for 100KB in jsdom.
// Rationale: The forbidden TextAlign.addGlobalAttributes expansion caused a
// ~4x slowdown on 494 KB. Even on 100 KB text-only content, a 4x regression
// would push past this budget (text-only baseline is well under 400ms).
// The 1.5x CI multiplier gives a ceiling of 2250ms.
const STREAM_BUDGET_MS = 1500;

describe('streamingHydrate performance regression guard', () => {
  it(`streams 100KB fixture within ${STREAM_BUDGET_MS}ms`, async () => {
    // Parse once outside the benchmark loop — we're measuring hydration, not parse.
    const { doc, annotations, nodeIds, tableMetadata } =
      parseMarkdownToProseMirrorJson(fixture100KB);

    const editor = createHydrateEditor();

    const result = await benchmark(
      'streamingHydrate 100KB',
      async () => {
        const controller = new AbortController();
        const out = await streamingHydrate(
          editor,
          doc,
          { annotations, nodeIds, tableMetadata },
          controller.signal,
        );
        // Prevent dead-code elimination — touch the result.
        if (out.ms < 0) throw new Error('unreachable');
      },
      STREAM_BUDGET_MS,
    );

    editor.destroy();
    expect(result.passed).toBe(true);
  });
});
