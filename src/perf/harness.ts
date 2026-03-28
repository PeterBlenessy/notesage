/**
 * Performance benchmark harness for Notesage.
 *
 * Provides utilities for measuring and asserting performance:
 * - benchmark() — run a function and assert it completes within a budget
 * - generateMarkdown() — create synthetic markdown at a target size
 * - createTestEditor() — create a Tiptap editor with the same extensions as the real app
 * - DOC_SIZES — standard document size constants
 *
 * @vitest-environment jsdom
 */

import { beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";

// ---------------------------------------------------------------------------
// Standard document sizes (in KB)
// ---------------------------------------------------------------------------

export const DOC_SIZES = {
  small: 1,
  medium: 10,
  large: 50,
  extraLarge: 100,
} as const;

// ---------------------------------------------------------------------------
// jsdom bootstrap — call setupJSDOM() in beforeAll()
// ---------------------------------------------------------------------------

let domInitialized = false;

export function setupJSDOM(): void {
  if (domInitialized) return;

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

  domInitialized = true;
}

/**
 * Call this in a `beforeAll()` block to set up JSDOM globals for ProseMirror.
 */
export function useJSDOMSetup(): void {
  beforeAll(() => {
    setupJSDOM();
  });
}

// ---------------------------------------------------------------------------
// Editor factory
// ---------------------------------------------------------------------------

const lowlight = createLowlight(common);

/**
 * Create a headless Tiptap editor with the same content extensions as the real
 * editor (useEditor.ts), minus decoration-only plugins that don't affect
 * markdown serialization.
 */
export function createTestEditor(content: string): Editor {
  const el = document.createElement("div");

  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Image.configure({
        HTMLAttributes: {
          class: "rounded-lg max-w-full",
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
        linkify: false,
      }),
    ],
    content,
    editable: false,
  });
}

/**
 * Get the serialized markdown from a tiptap editor instance.
 */
export function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown();
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

export interface BenchmarkResult {
  name: string;
  elapsed: number;
  budget: number;
  passed: boolean;
}

/**
 * Budget multiplier for CI environments.
 * Set PERF_BUDGET_MULTIPLIER=1.5 to widen budgets (e.g., 3x baseline for CI).
 */
const BUDGET_MULTIPLIER = parseFloat(process.env.PERF_BUDGET_MULTIPLIER || "1");

/**
 * Run a function and assert it completes within the given budget.
 *
 * Runs the function `iterations` times and uses the median elapsed time.
 * The budget is multiplied by PERF_BUDGET_MULTIPLIER (default 1, set higher for CI).
 * Returns the result for structured logging.
 */
export async function benchmark(
  name: string,
  fn: () => void | Promise<void>,
  budgetMs: number,
  iterations = 3
): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];

  const result: BenchmarkResult = {
    name,
    elapsed: Math.round(median * 100) / 100,
    budget: Math.round(budgetMs * BUDGET_MULTIPLIER),
    passed: median < budgetMs * BUDGET_MULTIPLIER,
  };

  console.log(
    `[perf] ${result.passed ? "PASS" : "FAIL"} ${name}: ${result.elapsed}ms (budget: ${budgetMs}ms)`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Synthetic document generator
// ---------------------------------------------------------------------------

const WORDS = [
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "it",
  "for", "not", "on", "with", "he", "as", "you", "do", "at", "this",
  "but", "his", "by", "from", "they", "we", "say", "her", "she", "or",
  "an", "will", "my", "one", "all", "would", "there", "their", "what",
  "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
  "when", "make", "can", "like", "time", "no", "just", "him", "know",
  "take", "people", "into", "year", "your", "good", "some", "could",
  "them", "see", "other", "than", "then", "now", "look", "only", "come",
  "its", "over", "think", "also", "back", "after", "use", "two", "how",
  "our", "work", "first", "well", "way", "even", "new", "want", "because",
  "any", "these", "give", "day", "most", "us", "great", "between", "need",
];

const TAG_NAMES = [
  "project", "idea", "todo", "review", "important", "research",
  "meeting", "draft", "archive", "personal", "work", "followup",
];

const MENTION_NAMES = [
  "alice", "bob", "charlie", "dana", "eve", "frank", "grace", "heidi",
];

const CODE_LANGUAGES = ["javascript", "python", "rust", "typescript"];

function randomWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function randomSentence(minWords = 5, maxWords = 15): string {
  const count = minWords + Math.floor(Math.random() * (maxWords - minWords + 1));
  const words = Array.from({ length: count }, () => randomWord());
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(" ") + ".";
}

function randomParagraph(sentences = 4): string {
  return Array.from({ length: sentences }, () => randomSentence()).join(" ");
}

/**
 * Generate synthetic markdown with realistic content at approximately
 * the target size in KB.
 *
 * Includes a mix of all supported syntax: headings (H1-H4), paragraphs,
 * bold, italic, inline code, bullet lists, ordered lists, task lists,
 * blockquotes, code blocks with language, tables, horizontal rules,
 * links, #tags, and @mentions.
 */
export function generateMarkdown(sizeKB: number): string {
  const targetBytes = sizeKB * 1024;
  const blocks: string[] = [];
  let currentSize = 0;
  let sectionCounter = 0;

  function addBlock(block: string): boolean {
    blocks.push(block);
    currentSize += block.length + 1; // +1 for newline
    return currentSize >= targetBytes;
  }

  // Start with an H1
  if (addBlock(`# Document ${sizeKB}KB`)) return blocks.join("\n\n");

  while (currentSize < targetBytes) {
    sectionCounter++;
    const blockType = sectionCounter % 12;

    switch (blockType) {
      case 0: {
        // H2 heading
        const heading = `## Section ${sectionCounter}: ${randomSentence(3, 6).slice(0, -1)}`;
        if (addBlock(heading)) break;
        break;
      }
      case 1: {
        // Paragraph with inline formatting
        const words = randomParagraph(3).split(" ");
        // Add bold
        if (words.length > 3) words[2] = `**${words[2]}**`;
        // Add italic
        if (words.length > 6) words[5] = `*${words[5]}*`;
        // Add inline code
        if (words.length > 9) words[8] = `\`${words[8]}\``;
        if (addBlock(words.join(" "))) break;
        break;
      }
      case 2: {
        // Bullet list
        const items = Array.from(
          { length: 3 + Math.floor(Math.random() * 3) },
          () => `- ${randomSentence(4, 8)}`
        );
        if (addBlock(items.join("\n"))) break;
        break;
      }
      case 3: {
        // H3 heading
        if (addBlock(`### ${randomSentence(2, 5).slice(0, -1)}`)) break;
        break;
      }
      case 4: {
        // Ordered list
        const items = Array.from(
          { length: 3 + Math.floor(Math.random() * 3) },
          (_, i) => `${i + 1}. ${randomSentence(4, 8)}`
        );
        if (addBlock(items.join("\n"))) break;
        break;
      }
      case 5: {
        // Paragraph with tags and mentions
        const p = randomParagraph(2);
        const tag = TAG_NAMES[sectionCounter % TAG_NAMES.length];
        const mention = MENTION_NAMES[sectionCounter % MENTION_NAMES.length];
        if (addBlock(`${p} #${tag} @${mention}`)) break;
        break;
      }
      case 6: {
        // Code block
        const lang = CODE_LANGUAGES[sectionCounter % CODE_LANGUAGES.length];
        const lines = Array.from({ length: 3 + Math.floor(Math.random() * 5) }, (_, i) =>
          lang === "python"
            ? `  result_${i} = compute(${i}, "${randomWord()}")`
            : `  const result${i} = compute(${i}, "${randomWord()}");`
        );
        if (addBlock(`\`\`\`${lang}\n${lines.join("\n")}\n\`\`\``)) break;
        break;
      }
      case 7: {
        // Blockquote
        if (addBlock(`> ${randomParagraph(2)}`)) break;
        break;
      }
      case 8: {
        // Task list
        const items = Array.from(
          { length: 3 + Math.floor(Math.random() * 3) },
          (_, i) => `- [${i % 3 === 0 ? "x" : " "}] ${randomSentence(4, 8)}`
        );
        if (addBlock(items.join("\n"))) break;
        break;
      }
      case 9: {
        // Table
        const rows = [
          "| Column A | Column B | Column C |",
          "| --- | --- | --- |",
          ...Array.from(
            { length: 3 + Math.floor(Math.random() * 3) },
            () => `| ${randomWord()} | ${randomWord()} | ${randomWord()} |`
          ),
        ];
        if (addBlock(rows.join("\n"))) break;
        break;
      }
      case 10: {
        // H4 heading + paragraph with link
        if (addBlock(`#### ${randomSentence(2, 4).slice(0, -1)}`)) break;
        if (addBlock(`${randomParagraph(2)} [${randomWord()}](https://example.com/${randomWord()})`)) break;
        break;
      }
      case 11: {
        // Horizontal rule + plain paragraph
        if (addBlock("---")) break;
        if (addBlock(randomParagraph(4))) break;
        break;
      }
    }
  }

  return blocks.join("\n\n");
}
