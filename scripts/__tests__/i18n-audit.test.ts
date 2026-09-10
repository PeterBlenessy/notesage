import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no type declarations by design.
import { scan } from "../i18n-audit.mjs";

/**
 * The detector's own tests (#989).
 *
 * `i18n-coverage.test.ts` grants `COMPLETED` directories a HARD ZERO on this
 * scanner's word, and the scanner had no tests. Every blind spot it has ever
 * had was therefore silent twice over: the string shipped untranslated, and
 * the guard reported success. Four were found by review in one sitting —
 * wrapped text nodes, contractions, parentheticals, expression props — each
 * one a shape of ordinary English the tool simply could not see.
 *
 * So each shape it claims to detect is planted here and checked. A rule that
 * regresses fails a test rather than quietly widening a promise.
 */
let dir: string;

const CASES: Record<string, string> = {
  // Prettier wraps any element with a className of real length — which is most
  // of them — so this is the common shape, not an exotic one.
  "wrapped.tsx": 'export const A = () => (\n  <p className="x">\n    Nothing here yet\n  </p>\n);\n',
  "contraction.tsx": "export const B = () => (\n  <p className=\"x\">\n    Couldn't open this folder\n  </p>\n);\n",
  "paren.tsx": "export const C = () => (\n  <span>Terminal output (not yet supported)</span>\n);\n",
  "ternary.tsx":
    'export const D = () => (\n  <X\n    aria-label={\n      cond ? "Switch to list view" : "Switch to gallery view"\n    }\n  />\n);\n',
  // One branch translated must not hide the other.
  "half.tsx": 'export const E = () => (\n  <X label={cond ? t("a11y.switchToList") : "Switch to gallery view"} />\n);\n',
  // Native menus and action sheets are object literals, not JSX at all.
  "objtitle.ts": 'export const F = [{ id: "a", title: "Couldn\'t share that file" }];\n',
  "assign.ts": 'const frame = {};\nframe.title = "Mermaid diagram";\n',
  // A `/*` inside a string is four characters, not a comment.
  "stringcomment.tsx":
    'export const G = () => (\n  <X placeholder="**/*.md (optional)" />\n);\nexport const H = () => (\n  <p>\n    Only run on weekdays\n  </p>\n);\n',
  // ...and a `>` inside one must not drag the following code into a finding.
  "code-noise.tsx": 'const msg = "Open Settings > AI & Agents.";\nexport const I = () => (\n  <button>ok</button>\n);\n',
  // "verb + ellipsis" is the standard idiom for an in-progress toast and for a
  // menu item that opens something; an anchored single-word rule rejected all
  // of them, so `<p>Saving…</p>` passed a hard-zero directory.
  "ellipsis.tsx": 'export const J = () => (\n  <p>Saving…</p>\n);\nexport const K = () => {\n  toast.success("Transcribing…");\n};\n',
  // Proper nouns are not translatable in any language; counting them forever
  // makes the ratchet fail on unrelated work.
  "brands.tsx": 'export const L = () => (\n  <span>Anthropic</span>\n);\n',
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "i18n-audit-"));
  for (const [name, body] of Object.entries(CASES)) writeFileSync(join(dir, name), body);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const texts = () => (scan(dir) as { text: string }[]).map((f) => f.text);

describe("i18n audit detects every shape it claims to", () => {
  it.each([
    ["a text node Prettier wrapped", "Nothing here yet"],
    ["a contraction in a text node", "Couldn't open this folder"],
    ["prose ending in a parenthetical", "Terminal output"],
    ["a wrapped expression prop", "Switch to list view"],
    ["the untranslated half of a ternary", "Switch to gallery view"],
    ["an object-literal title holding an apostrophe", "Couldn't share that file"],
    ["a .title assignment", "Mermaid diagram"],
    ["text after a string containing /*", "Only run on weekdays"],
    ["a single word wearing an ellipsis", "Saving…"],
    ["a toast that is one word and an ellipsis", "Transcribing…"],
  ])("sees %s", (_name, needle) => {
    expect(texts().some((t) => t.includes(needle))).toBe(true);
  });

  it("does not report code after a string containing >", () => {
    // The span from a `>` inside a literal used to run through the closing
    // quote and the following statement, producing findings like
    // `AI & Agents."; return (` — noise no translator can action.
    expect(texts().some((t) => /return|;/.test(t))).toBe(false);
  });

  it("does not report a brand name nobody can translate", () => {
    expect(texts().some((t) => t === "Anthropic")).toBe(false);
  });

  it("reports each finding once", () => {
    const all = scan(dir) as { file: string; line: number; text: string }[];
    const keys = all.map((f) => `${f.file}:${f.line}:${f.text}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("points at the line the string is on", () => {
    const all = scan(dir) as { file: string; line: number; text: string }[];
    const wrapped = all.find((f) => f.text === "Nothing here yet");
    // The text is on line 3; the opening tag is on line 2.
    expect(wrapped?.line).toBe(3);
  });
});

describe("i18n audit is not fooled by things that merely look like code", () => {
  let dir2: string;
  beforeAll(() => {
    dir2 = mkdtempSync(join(tmpdir(), "i18n-audit-parse-"));
    const files: Record<string, string> = {
      // An apostrophe in JSX text used to open a phantom string that desynced
      // quote tracking to the end of the file — eleven files in `src` were
      // affected, one of them inside a hard-zero directory.
      "apostrophe.tsx":
        "export const A = () => (\n  <>\n    <p>Previous messages won't be shared.</p>\n    <input placeholder={'**/*.md'} />\n    <p>\n      Nothing here yet\n    </p>\n  </>\n);\n",
      // A regex literal holding backticks and quotes is not a string.
      "regex.ts": 'export const R = /^```[\\s\\S]*?^```\\s*$/gm;\nexport const menu = [{ title: "Open in browser" }];\n',
      // Straight quotes and an equals sign are ordinary punctuation in prose.
      "quotes.tsx":
        'export const B = () => (\n  <p>\n    Tap "Allow" to continue\n  </p>\n);\n',
      // A t() call with options must not truncate the expression around it.
      "options.tsx":
        'export const C = () => (\n  <X title={cond ? t("a11y.back", { n: 1 }) : "Switch to gallery view"} />\n);\n',
    };
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir2, name), body);
  });
  afterAll(() => rmSync(dir2, { recursive: true, force: true }));

  const found = () => (scan(dir2) as { text: string }[]).map((f) => f.text);

  it.each([
    ["text after an apostrophe and a glob", "Nothing here yet"],
    ["a title beside a regex literal", "Open in browser"],
    ["prose containing straight quotes", 'Tap "Allow" to continue'],
    ["the untranslated branch beside a parameterised t()", "Switch to gallery view"],
  ])("still sees %s", (_name, needle) => {
    expect(found().some((t) => t.includes(needle))).toBe(true);
  });
});
