// @vitest-environment jsdom

/**
 * Benchmarks for opening a saved web page in the HTML viewer: a 3 MB
 * self-contained capture whose images are inlined as base64 `data:` URIs.
 *
 * The timings are jsdom's, and INDICATIVE ONLY. jsdom's parser and
 * serialiser are JavaScript; WKWebView's are native and have a different cost
 * profile, so no number here says how long the app takes. What carries over
 * is the shape: the old pipeline's work grows with the size of the file, the
 * new one's with the size of the text around the images. The
 * machine-independent pins (characters sanitised, whole-document passes) are
 * in `src/components/editor/viewers/__tests__/html-large-capture.test.tsx`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { benchmark } from "./harness";
import {
  prepareHtmlBody,
  mountPreparedHtml,
  preparedHtmlCost,
  htmlSanitiseCache,
  htmlSanitiseVariant,
} from "@/lib/html-viewer-sanitise";
import { buildCapture, legacySanitisedBody } from "@/lib/__tests__/html-legacy-sanitise-reference";

const CAPTURE = buildCapture(3_000_000, 6);
const PATH = "/inbox/capture.html";

/** Budgets in ms, on jsdom. Widened on CI by PERF_BUDGET_MULTIPLIER. */
const FIRST_OPEN_BUDGET_MS = 600;
const REOPEN_BUDGET_MS = 100;

/** The share of the file DOMPurify may be handed: a twentieth. */
const SANITISED_SHARE_LIMIT = CAPTURE.html.length / 20;

beforeEach(() => {
  htmlSanitiseCache.clear();
});

describe("HTML viewer — opening a 3 MB capture", () => {
  it("first open: prepare and mount", async () => {
    const result = await benchmark(
      "html-viewer first open (3 MB, 6 inlined images)",
      () => {
        const host = document.createElement("div");
        mountPreparedHtml(host, prepareHtmlBody(CAPTURE.html, false), true);
        expect(host.querySelectorAll("img").length).toBe(6);
      },
      FIRST_OPEN_BUDGET_MS,
    );
    expect(result.passed).toBe(true);
  });

  it("reopen: cache hit and mount", async () => {
    const prepared = prepareHtmlBody(CAPTURE.html, false);
    const variant = htmlSanitiseVariant(false);
    htmlSanitiseCache.set(PATH, variant, CAPTURE.html, prepared, preparedHtmlCost(CAPTURE.html, prepared));
    const result = await benchmark(
      "html-viewer reopen (3 MB, cached)",
      () => {
        // A re-read file is a different string with the same characters.
        const reread = (" " + CAPTURE.html).slice(1);
        const hit = htmlSanitiseCache.get(PATH, variant, reread);
        expect(hit).not.toBeNull();
        const host = document.createElement("div");
        mountPreparedHtml(host, hit!, true);
        expect(host.querySelectorAll("img").length).toBe(6);
      },
      REOPEN_BUDGET_MS,
    );
    expect(result.passed).toBe(true);
  });

  it("the sanitiser sees a small fraction of the file", () => {
    const prepared = prepareHtmlBody(CAPTURE.html, false);
    expect(prepared.sanitisedChars).toBeLessThan(SANITISED_SHARE_LIMIT);
    expect(prepared.lifted.chars).toBeGreaterThan(CAPTURE.html.length - SANITISED_SHARE_LIMIT);
  });

  it("reports the old pipeline alongside, for comparison only (no budget)", async () => {
    const t0 = performance.now();
    const host = document.createElement("div");
    host.innerHTML = legacySanitisedBody(CAPTURE.html, false);
    const legacyMs = performance.now() - t0;

    const t1 = performance.now();
    const fresh = document.createElement("div");
    mountPreparedHtml(fresh, prepareHtmlBody(CAPTURE.html, false));
    const currentMs = performance.now() - t1;

    console.log(
      `[perf] INFO html-viewer 3 MB open on jsdom: old pipeline ${Math.round(legacyMs)}ms, new ${Math.round(currentMs)}ms`,
    );
    expect(fresh.innerHTML).toBe(host.innerHTML);
  });
});
