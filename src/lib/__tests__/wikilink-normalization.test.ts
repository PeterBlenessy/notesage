/**
 * Wikilink normalization round-trip tests (OKF wiki-navigation, task #13).
 *
 * Proves that `[[ ]]` authoring NEVER reaches disk: the `[[` suggestion inserts
 * a standard Link mark whose href is a relative path, so serialization is the
 * existing Link path (ADR 0001). A picked target serializes to an explicit
 * relative link; a dangling target serializes to a slugified filename in the
 * current document's directory (ADR 0007). Nothing else about serialization
 * changes — the existing `markdown-roundtrip.test.ts` suite is the broad gate;
 * this file asserts the specific normalization contract.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import {
  slugifyTitle,
  danglingWikiLinkHref,
  resolvedWikiLinkHref,
} from "@/lib/link-utils";

// ---------------------------------------------------------------------------
// jsdom bootstrap (ProseMirror needs a global DOM)
// ---------------------------------------------------------------------------

beforeAll(() => {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="editor"></div></body></html>'
  );
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.navigator = dom.window.navigator as unknown as Navigator;
  globalThis.Node = dom.window.Node as unknown as typeof Node;
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
  globalThis.getComputedStyle =
    dom.window.getComputedStyle as unknown as typeof getComputedStyle;
});

// ---------------------------------------------------------------------------
// Minimal editor (StarterKit's Link mark + Markdown serializer — the exact path
// a picked/dangling wikilink takes once it has been inserted as a Link mark).
// ---------------------------------------------------------------------------

function makeEditor(content: string): Editor {
  const el = document.createElement("div");
  return new Editor({
    element: el,
    extensions: [
      StarterKit,
      Markdown.configure({ html: true, linkify: false, transformPastedText: true }),
    ],
    content,
    editable: false,
  });
}

function serialize(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown();
}

/**
 * Replicates exactly what `wiki-link.tsx`'s `insertWikiLink` puts into the
 * document model: a single text node carrying a `link` mark with the computed
 * href, followed by a trailing space. We build it as ProseMirror JSON so the
 * test exercises the real serializer, not a string template.
 */
function insertLinkAndSerialize(href: string, text: string): string {
  const editor = makeEditor({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", marks: [{ type: "link", attrs: { href } }], text },
          { type: "text", text: " " },
        ],
      },
    ],
  } as unknown as string);
  const md = serialize(editor).trim();
  editor.destroy();
  return md;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("slugifyTitle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyTitle("Quarterly Plan")).toBe("quarterly-plan.md");
  });

  it("collapses runs of punctuation/whitespace into a single hyphen", () => {
    expect(slugifyTitle("Q4 / 2026  Review!")).toBe("q4-2026-review.md");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyTitle("  --Hello--  ")).toBe("hello.md");
  });

  it("falls back to 'untitled' for an empty slug", () => {
    expect(slugifyTitle("!!!")).toBe("untitled.md");
  });
});

describe("danglingWikiLinkHref", () => {
  it("produces a current-dir relative path (ADR 0007)", () => {
    expect(danglingWikiLinkHref("Quarterly Plan")).toBe("./quarterly-plan.md");
    expect(danglingWikiLinkHref("New Concept")).toBe("./new-concept.md");
  });
});

describe("resolvedWikiLinkHref", () => {
  it("expresses the absolute target relative to the active dir (ADR 0001/0002)", () => {
    expect(
      resolvedWikiLinkHref("/home/user/Notesage/proj/quarterly-plan.md", "/home/user/Notesage/proj")
    ).toBe("./quarterly-plan.md");
  });

  it("uses parent traversal across directories", () => {
    expect(
      resolvedWikiLinkHref("/home/user/Notesage/docs/editor.md", "/home/user/Notesage/proj/sub")
    ).toBe("../../docs/editor.md");
  });

  it("falls back to a ./basename without an active dir", () => {
    expect(resolvedWikiLinkHref("/anywhere/orders.md")).toBe("./orders.md");
  });
});

// ---------------------------------------------------------------------------
// Serialization contract: a picked / dangling wikilink → standard Link markdown
// ---------------------------------------------------------------------------

describe("wikilink → standard relative link serialization", () => {
  it("a PICKED target serializes to a standard relative link (ADR 0001)", () => {
    const href = resolvedWikiLinkHref(
      "/home/user/Notesage/proj/quarterly-plan.md",
      "/home/user/Notesage/proj"
    );
    const md = insertLinkAndSerialize(href, "Quarterly Plan");
    expect(md).toBe("[Quarterly Plan](./quarterly-plan.md)");
    // No `[[ ]]` ever reaches the on-disk form.
    expect(md).not.toContain("[[");
    expect(md).not.toContain("]]");
  });

  it("a DANGLING target serializes to a current-dir relative link (ADR 0007)", () => {
    const href = danglingWikiLinkHref("New Concept");
    const md = insertLinkAndSerialize(href, "New Concept");
    expect(md).toBe("[New Concept](./new-concept.md)");
    expect(md).not.toContain("[[");
  });

  it("is idempotent: re-parsing the serialized link yields the same markdown", () => {
    const md1 = insertLinkAndSerialize("./quarterly-plan.md", "Quarterly Plan");
    const editor = makeEditor(md1);
    const md2 = serialize(editor).trim();
    editor.destroy();
    expect(md2).toBe(md1);
  });
});
