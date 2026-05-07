// @vitest-environment jsdom

/**
 * Regression-watch for the worker extension list + cache schema fingerprint.
 *
 * Phase 3b — IndexedDB viewport cache (PRD `docs/prds/2026-05-03-large-file-instant-load.md`).
 *
 * The viewport cache stores `editor.getHTML()` for the visible window of each
 * recently-saved doc, keyed by the SHA-256 of
 * `CACHE_SCHEMA_VERSION + sorted extension names`. If the extension list changes
 * (add / remove / rename) without bumping the version constant, cached HTML can
 * still mount as static content but may render incorrectly under updated CSS or
 * extension behaviour. Pure attribute / parseHTML changes leave the name list
 * unchanged and the hash stable — that's why the snapshot pairs the constant
 * with the sorted name list, so any drift in either is forced through this test.
 *
 * If this test fails:
 *
 *   1. Decide whether the extension change affects rendered HTML (attribute
 *      affecting how the node renders, parseHTML rule changing how the node is
 *      reconstructed, or a name change).
 *   2. If yes — bump `CACHE_SCHEMA_VERSION` in `src/workers/worker-extensions.ts`.
 *   3. Update the inline snapshot below to the new combined value.
 *
 * Needs jsdom because `worker-extensions.ts` transitively imports Tiptap
 * extensions whose `parseHTML` rules reference `HTMLElement`. Same setup as
 * the parity test in `markdown-parse.core.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { CACHE_SCHEMA_VERSION, workerExtensions } from "../worker-extensions";

describe("worker-extensions schema fingerprint", () => {
  it("matches the inline snapshot — bump CACHE_SCHEMA_VERSION before updating", () => {
    const names = workerExtensions.map((e) => e.name).slice().sort();
    const fingerprint = `${CACHE_SCHEMA_VERSION}|${names.join("|")}`;

    expect(fingerprint).toMatchInlineSnapshot(
      `"1|callout|chart|codeBlock|color|drawing|heading|highlight|image|linkPreview|mermaidBlock|pageBreak|paragraph|starterKit|subscript|superscript|table|tableCell|tableHeader|tableOfContents|tableRow|taskItem|taskList|textAlign|textStyle|uniqueID"`,
    );
  });
});
