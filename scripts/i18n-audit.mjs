#!/usr/bin/env node
/**
 * Find user-visible English strings that never reach the translation table.
 *
 * Deliberately conservative: it flags only things a user can read — JSX text
 * nodes and the props that render as text — and it ignores anything already
 * wrapped in t(). False negatives are fine; the point is a floor, not a census.
 *
 * Two consumers:
 *   - CLI:  `node scripts/i18n-audit.mjs src/components/settings --detail`
 *   - test: `src/lib/__tests__/i18n-coverage.test.ts` imports `scan()` and
 *           ratchets the count down. See that file for why a ceiling rather
 *           than a hard zero.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import ts from "typescript";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const TEXT_PROPS = [
  "label",
  "title",
  "placeholder",
  "aria-label",
  "description",
  "tooltip",
  "alt",
  "heading",
  "emptyText",
  "confirmLabel",
];

function walk(dir, out = []) {
  // Accept a single file as well as a directory — auditing one file while
  // translating it is the common case, and ENOTDIR is a useless error there.
  if (statSync(dir).isFile()) return [dir];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (/(__tests__|node_modules|\.git)/.test(entry)) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      // `.ts` as well as `.tsx`. The native menus, action sheets and nav shell
      // are plain TypeScript — `src/components/mobile` alone holds seventeen
      // `.ts` files — and `object-title` was added precisely for that
      // non-JSX surface, so scanning only `.tsx` made the rule half blind and
      // the hard zero read broader than it was.
      out.push(full);
    }
  }
  return out;
}

// Two or more words of prose, or one capitalised word of 4+ chars.
//
// The character after the separator admits `(` as well as alphanumerics: a
// parenthesised qualifier is a normal way to label a choice — `Local
// (command)`, `Remote (URL)`, `Auto (all)` — and requiring an alphanumeric
// there made every one of them invisible, inside a directory certified at
// hard zero.
const PROSE =
  /^[A-Z][A-Za-z]{2,}(?:[ ,'’\-—:.!?][A-Za-z0-9(][A-Za-z0-9 ,'’\-—:.!?%()]*)?$/;
const SKIP = /^(true|false|null|undefined|px|rem|auto|none|div|span|button)$/i;

/**
 * Proper nouns that stay in English in every language.
 *
 * Without this the ratchet counts strings nobody can ever action, and a PR
 * that adds a provider called "Mistral AI" pushes the number up and fails a
 * test whose only sound remedy — raising the ceiling — the file forbids.
 */
const BRANDS = new Set([
  "Anthropic",
  "Claude Code",
  "OpenAI",
  "OpenAI Codex",
  "GitHub Copilot",
  "GitHub Copilot CLI",
  "Gemini CLI",
  "Notesage",
  "Ollama",
  "Hugging Face",
  "TestFlight",
  "iCloud",
  "iCloud Drive",
  "Markdown",
  "JSON",
  // Endonyms: a language picker shows each language its own name, in every
  // locale. "Svenska" is not translated into Swedish.
  "English",
  "Svenska",
  "Cursor",
  "Claude Desktop",
  "VS Code",
]);

/**
 * Model names, which are product names and stay as they are.
 *
 * A list would be unmaintainable — the catalog gains models constantly — so
 * this matches the FAMILY, which is the part that is a proper noun.
 * `ModelSelectionForm.tsx` alone carries 35 of them, and counting those as
 * untranslated both inflates the ceiling and invites someone to "translate"
 * GPT-5.1 Codex Mini.
 */
const MODEL_FAMILY =
  /^(Claude|GPT|Gemini|Llama|Mistral|Qwen|DeepSeek|Phi|Gemma|Grok|Codex|Copilot|Whisper|Goose|Ollama)\b/;

/** Function words a product name never contains but a sentence always does. */
const PROSE_WORD =
  /\b(is|are|was|were|the|an?|to|of|for|and|or|in|on|at|with|your|you|this|that|it|its|will|can|could|not|no|has|have|been|from|by|when|while|after|before|than|then|needs?|use|using)\b/i;

/**
 * Is this a model name, or a SENTENCE that happens to start with one?
 *
 * The family prefix alone was too greedy: "Whisper model is downloading…" and
 * "Copilot needs to be signed in" both open with a family name and were
 * silently exempted from the audit — a whole class of user-visible text
 * hidden by a rule meant to exempt thirty-five product names. A name is short,
 * carries no sentence punctuation and no function words, and every one of its
 * tokens starts with a capital, a digit, or punctuation (`(Preview)`).
 */
function looksLikeModelName(t) {
  if (!MODEL_FAMILY.test(t)) return false;
  if (PROSE_WORD.test(t)) return false;
  if (/[,;:!?]|\.\s/.test(t)) return false;
  const tokens = t.split(/\s+/);
  return tokens.length <= 6 && tokens.every((w) => /^[^a-z]*[A-Z0-9]/.test(w));
}

/**
 * A Tailwind class list, not a sentence.
 *
 * The expression-prop rule reads every literal inside `prop={…}`, and a
 * `description={<div className="flex flex-col gap-0.5">…}` puts a class list
 * exactly where a sentence would be. Two or more lowercase tokens carrying a
 * hyphen, colon or bracket is the shape; prose that happens to be all
 * lowercase ("in your project or") has none.
 */
function looksLikeClassNames(t) {
  if (!/^[a-z0-9\s:\-[\]/.%()]+$/.test(t)) return false;
  return t.split(/\s+/).filter((w) => /[-:[]/.test(w)).length >= 2;
}

/**
 * Is this string something a user reads, rather than an id, a path or a class?
 *
 * Unchanged from the regex era, and still the only place a judgement is made:
 * the parser above decides WHERE a string is, this decides whether it is prose.
 * The length rule lives here too — putting a minimum in the matching pattern
 * once made a three-letter literal swallow its own closing quote.
 */
function looksTranslatable(s) {
  const t = s.trim();
  // The upper bound is a sanity rail against minified blobs and data URIs, not
  // a judgement about prose: at 120 it hid the longest sentences in the app —
  // the explanatory paragraphs under a settings toggle, which are exactly the
  // text a Swedish reader most needs and the hardest to notice untranslated.
  if (t.length < 4 || t.length > 400) return false;
  if (SKIP.test(t)) return false;
  if (BRANDS.has(t)) return false;
  if (looksLikeModelName(t)) return false;
  if (looksLikeClassNames(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (/^[a-z-]+$/.test(t)) return false; // css class / kebab id
  if (/^\w+\.\w+/.test(t)) return false; // file.ext, obj.prop
  if (/^(https?:|\/|#|@)/.test(t)) return false; // urls, paths, selectors
  // A single word, with whatever punctuation it wears. The anchored `$` used
  // to reject every one of `Transcribing…`, `Saved!`, `Copied!`, `Note:` —
  // and "verb + ellipsis" is the standard idiom for an in-progress toast and
  // for a menu item that opens something. `<p>Saving…</p>` would have passed
  // a directory certified at hard zero.
  if (!/\s/.test(t) && !/^[A-Z][a-z]{3,}[…:!?.]*$/.test(t)) return false;
  // A single word wearing punctuation is prose and needs no further test —
  // `PROSE` below describes SENTENCES and its character class has no `…`, so
  // `Transcribing…` cleared the gate above only to be rejected here.
  if (/^[A-Z][a-z]{3,}[…:!?.]+$/.test(t)) return true;
  return PROSE.test(t) || /\s[a-z]/.test(t);
}

/**
 * Walk the real syntax tree.
 *
 * This scanner was hand-rolled — regexes, then a small quote-tracking blanker —
 * and review found a tokenizer bug in it six times running: a `>` inside a
 * string literal dragged code into findings; a glob in a placeholder attribute
 * opened a "comment" that blanked thirteen lines out of the scan; an apostrophe in `won't` opened a
 * phantom string that desynced quote state to the end of the file, which
 * happened in eleven files including one in a directory certified at HARD ZERO.
 *
 * Every one of those is a thing a parser already knows. TypeScript is a
 * dependency of this repo and its parser is exact about the distinctions that
 * kept being got wrong: comment vs string, apostrophe vs delimiter, regex
 * literal vs division, template vs quote, JSX text vs code. Nothing below
 * inspects characters.
 */
function findingsIn(file, findings) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const at = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const push = (node, kind, value) => {
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (looksTranslatable(cleaned)) findings.push({ file, line: at(node), kind, text: cleaned });
  };

  
/** Is this text inside an element that marks its content as not-prose? */
function inCodeElement(node) {
  const parent = node.parent;
  if (!parent || !ts.isJsxElement(parent)) return false;
  const tag = parent.openingElement.tagName.getText();
  return tag === "code" || tag === "pre" || tag === "kbd";
}

/** Is this literal an argument to `t(...)`? Then it is a key, not prose. */
  const isTranslationKey = (node) =>
    ts.isCallExpression(node.parent) &&
    ts.isIdentifier(node.parent.expression) &&
    node.parent.expression.text === "t";

  const visit = (node) => {
    // 1. JSX text — the wrapped prose that started all this. Text inside
    //    `<code>`, `<pre>` or `<kbd>` is excluded: `git init`, a path, a key
    //    combination. Those elements exist precisely to say "this is not
    //    prose", and translating what they hold would break the instruction.
    if (ts.isJsxText(node) && node.text.trim() && !inCodeElement(node)) {
      push(node, "jsx-text", node.text);
    }

    // 2. Text-bearing attributes, whether the value is a literal or an
    //    expression: `label="x"`, `label={cond ? "a" : "b"}`. A parser makes
    //    these one case instead of two regexes that disagreed about wrapping.
    if (ts.isJsxAttribute(node) && node.name && TEXT_PROPS.includes(node.name.getText(source))) {
      const kind = node.name.getText(source);
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) push(init, kind, init.text);
      if (init && ts.isJsxExpression(init) && init.expression) {
        const walkExpr = (n) => {
          if (ts.isStringLiteral(n) && !isTranslationKey(n)) push(n, kind, n.text);
          ts.forEachChild(n, walkExpr);
        };
        walkExpr(init.expression);
      }
    }

    // 3. String literals inside a JSX expression CHILD:
    //    `<Button>{saving ? 'Saving…' : 'Save'}</Button>`. Rule 1 sees only
    //    JsxText, and a ternary between two labels is not text — it is code —
    //    so this whole idiom was invisible. It is the commonest way a button
    //    or a status line says two things, and it is why two directories this
    //    audit certified at HARD ZERO still rendered English.
    //
    //    The walk stops at any nested JSX: an element inside the expression
    //    reaches the visitor on its own and is handled by rules 1 and 2, so
    //    descending here would count its text twice.
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      !inCodeElement(node)
    ) {
      const walkChild = (n) => {
        if (
          ts.isJsxElement(n) ||
          ts.isJsxSelfClosingElement(n) ||
          ts.isJsxFragment(n)
        ) {
          return;
        }
        if (ts.isStringLiteral(n) && !isTranslationKey(n)) push(n, "jsx-child", n.text);
        ts.forEachChild(n, walkChild);
      };
      walkChild(node.expression);
    }

    // 4. Object-literal titles and `.title =` assignments — the native menus,
    //    action sheets and accessible names, which are not JSX at all.
    if (
      ts.isPropertyAssignment(node) &&
      OBJECT_TEXT_KEYS.includes(node.name.getText(source)) &&
      ts.isStringLiteral(node.initializer)
    ) {
      push(node.initializer, "object-title", node.initializer.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      OBJECT_TEXT_KEYS.includes(node.left.name.text) &&
      ts.isStringLiteral(node.right)
    ) {
      push(node.right, "object-title", node.right.text);
    }

    // 5. Toasts — user-facing by definition.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "toast" &&
      node.arguments.length &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      push(node.arguments[0], "toast", node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
}

/** Keys whose value is shown to a user when they appear in an object. */
const OBJECT_TEXT_KEYS = ["title", "label", "confirmLabel", "ariaLabel", "note", "hint", "caption"];

/** @returns {{file: string, line: number, kind: string, text: string}[]} */
export function scan(root = "src") {
  const findings = [];
  for (const file of walk(root)) findingsIn(file, findings);
  return findings;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "src";
  const findings = scan(root);

  const byFile = new Map();
  for (const f of findings) {
    const key = relative(process.cwd(), f.file);
    byFile.set(key, (byFile.get(key) || []).concat(f));
  }

  const ranked = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(
    `${findings.length} untranslated user-visible strings across ${byFile.size} files\n`,
  );

  const detail = process.argv.includes("--detail");
  for (const [file, items] of ranked) {
    console.log(`${String(items.length).padStart(4)}  ${file}`);
    if (detail) {
      for (const it of items.slice(0, 40)) {
        console.log(`        ${String(it.line).padStart(4)} [${it.kind}] ${it.text}`);
      }
      if (items.length > 40) console.log(`        … ${items.length - 40} more`);
    }
  }
}
