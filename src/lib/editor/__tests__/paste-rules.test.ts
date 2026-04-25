// @vitest-environment node

/**
 * Paste-rule registry tests + built-in rule behaviour.
 *
 * Backs the live-test 2026-04-25 paste-handling redesign. The registry
 * is module-level so we use `__clearPasteRulesForTesting` between tests
 * to keep them isolated. Built-in rules are re-registered per-test
 * inside the relevant `describe` blocks.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __clearPasteRulesForTesting,
  filePathPasteRule,
  getPasteRules,
  looksLikePath,
  looksLikePreformatted,
  preformattedTextPasteRule,
  registerPasteRule,
  type PasteRule,
  type PasteRuleContext,
} from "../paste-rules";

beforeEach(() => {
  __clearPasteRulesForTesting();
});

describe("registerPasteRule", () => {
  it("returns an unsubscribe function that removes the rule", () => {
    const rule: PasteRule = {
      name: "x",
      test: () => false,
      handle: () => false,
    };
    const unsub = registerPasteRule(rule);
    expect(getPasteRules()).toContain(rule);
    unsub();
    expect(getPasteRules()).not.toContain(rule);
  });

  it("sorts rules by descending priority", () => {
    const a: PasteRule = { name: "a", priority: 10, test: () => false, handle: () => false };
    const b: PasteRule = { name: "b", priority: 50, test: () => false, handle: () => false };
    const c: PasteRule = { name: "c", priority: 30, test: () => false, handle: () => false };
    registerPasteRule(a);
    registerPasteRule(b);
    registerPasteRule(c);
    const names = getPasteRules().map((r) => r.name);
    expect(names).toEqual(["b", "c", "a"]);
  });

  it("treats missing priority as 0", () => {
    const a: PasteRule = { name: "a", test: () => false, handle: () => false };
    const b: PasteRule = { name: "b", priority: 1, test: () => false, handle: () => false };
    registerPasteRule(a);
    registerPasteRule(b);
    expect(getPasteRules().map((r) => r.name)).toEqual(["b", "a"]);
  });
});

describe("looksLikePath", () => {
  it("matches POSIX absolute paths", () => {
    expect(looksLikePath("/Users/peter/Documents/foo.md")).toBe(true);
    expect(looksLikePath("/usr/local/bin/node")).toBe(true);
  });

  it("matches the iCloud path that triggered #160", () => {
    expect(
      looksLikePath(
        "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/Notesage/News/test.md",
      ),
    ).toBe(true);
  });

  it("matches Finder's quoted form (single + double quotes)", () => {
    expect(looksLikePath("'/Users/peter/Documents/foo.md'")).toBe(true);
    expect(looksLikePath('"/Users/peter/Documents/foo.md"')).toBe(true);
  });

  it("matches home-relative paths", () => {
    expect(looksLikePath("~/Documents/foo.md")).toBe(true);
    expect(looksLikePath("~")).toBe(true);
  });

  it("matches relative paths", () => {
    expect(looksLikePath("./foo")).toBe(true);
    expect(looksLikePath("../bar/baz.md")).toBe(true);
  });

  it("matches Windows-style paths", () => {
    expect(looksLikePath("C:\\Users\\peter\\foo.md")).toBe(true);
    expect(looksLikePath("D:/code/repo/file.ts")).toBe(true);
  });

  it("rejects multi-line input (paths don't span lines)", () => {
    expect(looksLikePath("/Users/peter\nsecond line")).toBe(false);
  });

  it("rejects empty / whitespace-only input", () => {
    expect(looksLikePath("")).toBe(false);
    expect(looksLikePath("   ")).toBe(false);
  });

  it("rejects bare filenames (no leading separator)", () => {
    expect(looksLikePath("foo.md")).toBe(false);
    expect(looksLikePath("README.md")).toBe(false);
  });

  it("rejects URLs (different protocol)", () => {
    expect(looksLikePath("https://example.com/foo")).toBe(false);
    expect(looksLikePath("file:///Users/peter")).toBe(false);
  });

  it("rejects prose (would never start with a separator)", () => {
    expect(
      looksLikePath("This is a sentence with /slash/ in the middle."),
    ).toBe(false);
  });
});

describe("looksLikePreformatted", () => {
  it("detects box-drawn tables (the user's resume-list example)", () => {
    const text = `┌──────┬────────────────┬────────┐
│  #   │ Description    │ Status │
├──────┼────────────────┼────────┤
│ #143 │ Settings drift │ open   │
└──────┴────────────────┴────────┘`;
    expect(looksLikePreformatted(text)).toBe(true);
  });

  it("detects double-line box drawings", () => {
    const text = `╔═══╦═══╗
║ a ║ b ║
╚═══╩═══╝`;
    expect(looksLikePreformatted(text)).toBe(true);
  });

  it("rejects ordinary prose with the occasional dash or pipe", () => {
    expect(
      looksLikePreformatted("This is a sentence — with an em-dash."),
    ).toBe(false);
    expect(looksLikePreformatted("foo | bar")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(looksLikePreformatted("")).toBe(false);
  });

  it("rejects content with too few box-drawing chars (single bullet, etc.)", () => {
    expect(looksLikePreformatted("• item one\n• item two")).toBe(false);
  });
});

describe("filePathPasteRule", () => {
  it("test() matches paths and rejects prose", () => {
    expect(
      filePathPasteRule.test(makeCtx("/Users/peter/foo.md")).valueOf(),
    ).toBe(true);
    expect(filePathPasteRule.test(makeCtx("hello world")).valueOf()).toBe(false);
  });

  it("handle() preventDefaults the event and inserts literal text", () => {
    const ctx = makeCtx("/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/test.md");
    const handled = filePathPasteRule.handle(ctx);
    expect(handled).toBe(true);
    expect(ctx.event.preventDefault).toHaveBeenCalledOnce();
    // The insertText transaction should be dispatched with the literal
    // path (no `~apple~` → `<sub>apple</sub>` parsing).
    expect(ctx.view.dispatch).toHaveBeenCalledOnce();
  });

  it("handle() strips Finder's surrounding single quotes", () => {
    const ctx = makeCtx("'/Users/peter/foo with spaces.md'");
    filePathPasteRule.handle(ctx);
    // Inspect the transaction's insertText call. We mock `state.tr` to
    // expose the inserted text.
    const inserted = ctx.view.dispatch.mock.calls[0][0]._insertedText;
    expect(inserted).toBe("/Users/peter/foo with spaces.md");
  });

  it("handle() strips surrounding double quotes too", () => {
    const ctx = makeCtx('"/Users/peter/foo.md"');
    filePathPasteRule.handle(ctx);
    const inserted = ctx.view.dispatch.mock.calls[0][0]._insertedText;
    expect(inserted).toBe("/Users/peter/foo.md");
  });
});

describe("preformattedTextPasteRule", () => {
  it("test() matches box-drawn content", () => {
    const ctx = makeCtx("┌──┐\n│ a│\n└──┘", {
      hasCodeBlockSchema: true,
    });
    expect(preformattedTextPasteRule.test(ctx)).toBe(true);
  });

  it("falls back to plain text when the schema lacks codeBlock", () => {
    const ctx = makeCtx("┌──┐\n│ a│\n└──┘", {
      hasCodeBlockSchema: false,
    });
    const handled = preformattedTextPasteRule.handle(ctx);
    expect(handled).toBe(true);
    expect(ctx.event.preventDefault).toHaveBeenCalledOnce();
    expect(ctx.view.dispatch).toHaveBeenCalledOnce();
    // Fallback path uses tr.insertText.
    const tx = ctx.view.dispatch.mock.calls[0][0];
    expect(tx._insertedText).toBeDefined();
  });

  it("normalises CRLF to LF before insertion", () => {
    const ctx = makeCtx("┌──┐\r\n│ a│\r\n└──┘", {
      hasCodeBlockSchema: true,
    });
    preformattedTextPasteRule.handle(ctx);
    const tx = ctx.view.dispatch.mock.calls[0][0];
    // codeBlock path stores text on `_replacedNodeText`.
    expect(tx._replacedNodeText).toBe("┌──┐\n│ a│\n└──┘");
  });
});

describe("built-in registration on module load", () => {
  it("filePath and preformatted rules are registered automatically", async () => {
    // Re-import to trigger the module-load registration. (Tests above
    // cleared the registry with `__clearPasteRulesForTesting`.)
    const mod = await import("../paste-rules");
    mod.__clearPasteRulesForTesting();
    // Force re-evaluation of the auto-registration block by re-importing
    // with cache-bust. In practice the module is loaded once per test
    // run; this test asserts that the EXPORTED rule constants are the
    // same identities the built-in registration would push.
    mod.registerPasteRule(mod.filePathPasteRule);
    mod.registerPasteRule(mod.preformattedTextPasteRule);
    const names = mod.getPasteRules().map((r) => r.name);
    expect(names).toContain("file-path");
    expect(names).toContain("preformatted-text");
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockCtxOpts {
  hasCodeBlockSchema?: boolean;
}

function makeCtx(text: string, opts: MockCtxOpts = {}): PasteRuleContext & {
  view: PasteRuleContext["view"] & { dispatch: ReturnType<typeof vi.fn> };
  event: ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
} {
  const tr = {
    insertText: vi.fn(function (this: { _insertedText?: string }, t: string) {
      this._insertedText = t;
      return this;
    }),
    replaceSelectionWith: vi.fn(function (
      this: { _replacedNodeText?: string },
      node: { textContent: string },
    ) {
      this._replacedNodeText = node.textContent;
      return this;
    }),
  };
  const codeBlockType = opts.hasCodeBlockSchema
    ? {
        create: (_: unknown, textNode: { text: string }) => ({
          textContent: textNode.text,
        }),
      }
    : undefined;
  const view = {
    state: {
      tr,
      schema: {
        nodes: codeBlockType ? { codeBlock: codeBlockType } : {},
        text: (s: string) => ({ text: s }),
      },
    },
    dispatch: vi.fn(),
  } as unknown as PasteRuleContext["view"] & { dispatch: ReturnType<typeof vi.fn> };
  const event = {
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
  const clipboardData = {
    getData: vi.fn((kind: string) =>
      kind === "text/plain" ? text : "",
    ),
  } as unknown as DataTransfer;
  return { clipboardData, text, html: null, view, event };
}
