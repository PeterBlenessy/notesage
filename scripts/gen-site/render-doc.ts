/**
 * Deterministic editor-content renderer for the marketing site.
 *
 * Parse markdown with the app's real worker parser, serialize the ProseMirror
 * doc through `DOMSerializer` (the SAME schema the editor uses), then
 * reconstruct — in `decorate*()` — the pieces the serializer can't emit because
 * they come from main-editor-only extensions or runtime decorations:
 *   - callout node  → real callout.ts DOM (header + icon + label + content)
 *   - #tag / @mention → tag-badge / mention-badge spans
 *   - code blocks    → lowlight `hljs-*` spans (highlight is a decoration)
 *   - `{{spark:…}}`  → inline SVG via the app's `renderSparkline`
 *   - task lists     → checkbox DOM + `data-checked` (state re-read from the raw
 *                       markdown; the worker parser drops it)
 *   - dynamic tables → currency/number formatting + aggregation footer
 *                       (column metadata re-parsed from the `<!-- … -->` header
 *                       comments; the worker uses base TableHeader)
 * Internal links need nothing — `.ProseMirror a:not([href^="http"])` styles them.
 * Chart / drawing node-views are handled by the page assembler (screenshot).
 */
import { getSchema } from "@tiptap/core";
import { Node as PMNode, DOMSerializer } from "@tiptap/pm/model";
import { parseHTML } from "linkedom";
import { common, createLowlight } from "lowlight";
import { workerExtensions } from "@/workers/worker-extensions";
import { parseMarkdownToProseMirrorJson } from "@/workers/markdown-parse.core";
import { parseFrontmatter } from "@/lib/frontmatter";
import { renderSparkline } from "@/lib/sparkline";
import { formatValue, parseNumericValue } from "@/lib/number-format";

const schema = getSchema(workerExtensions);
const lowlight = createLowlight(common);

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;
type Doc = any;

// --------------------------------------------------------------------------
// Callouts
// --------------------------------------------------------------------------
const CALLOUT_LABELS: Record<string, string> = { note: "Note", tip: "Tip", warning: "Warning", important: "Important" };

function decorateCallouts(doc: Doc, root: El): void {
  for (const el of Array.from(root.querySelectorAll("div.callout")) as El[]) {
    const type = el.getAttribute("data-callout-type") || el.getAttribute("type") || "note";
    const label = CALLOUT_LABELS[type] || "Note";
    const content = doc.createElement("div");
    content.setAttribute("class", "callout-content");
    while (el.firstChild) content.appendChild(el.firstChild);
    const header = doc.createElement("div");
    header.setAttribute("class", "callout-header");
    header.setAttribute("contenteditable", "false");
    const icon = doc.createElement("span");
    icon.setAttribute("class", `callout-icon callout-icon-${type}`);
    const lab = doc.createElement("span");
    lab.setAttribute("class", "callout-label");
    lab.textContent = label;
    header.appendChild(icon);
    header.appendChild(lab);
    el.appendChild(header);
    el.appendChild(content);
    el.setAttribute("class", `callout callout-${type}`);
    el.setAttribute("data-callout-type", type);
    el.removeAttribute("type");
    el.removeAttribute("data-type");
  }
}

// --------------------------------------------------------------------------
// Code blocks — lowlight syntax highlighting
// --------------------------------------------------------------------------
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function hastToHtml(node: any): string {
  if (node.type === "text") return escapeHtml(node.value);
  if (node.type === "root") return (node.children || []).map(hastToHtml).join("");
  if (node.type === "element") {
    const cn = node.properties?.className;
    const cls = cn ? ` class="${(Array.isArray(cn) ? cn : [cn]).join(" ")}"` : "";
    return `<${node.tagName}${cls}>${(node.children || []).map(hastToHtml).join("")}</${node.tagName}>`;
  }
  return "";
}
function decorateCodeBlocks(root: El): void {
  for (const code of Array.from(root.querySelectorAll("pre > code")) as El[]) {
    const cls = code.getAttribute("class") || "";
    const lang = (cls.match(/language-(\S+)/) || [])[1];
    if (!lang || !lowlight.registered(lang)) continue;
    try {
      code.innerHTML = hastToHtml(lowlight.highlight(lang, code.textContent || ""));
    } catch {
      /* leave plain */
    }
  }
}

// --------------------------------------------------------------------------
// Sparklines — `{{spark:a,b,c}}` → inline SVG (app's renderSparkline)
// --------------------------------------------------------------------------
const SPARK = /\{\{spark:([-0-9.,\s]+)\}\}/;
function decorateSparklines(doc: Doc, root: El): void {
  const walk = (node: El): void => {
    for (const child of Array.from(node.childNodes) as El[]) {
      if (child.nodeType === 3) {
        const t = child.nodeValue || "";
        const m = t.match(SPARK);
        if (!m) continue;
        const nums = m[1].split(",").map((s: string) => parseFloat(s.trim())).filter((n: number) => !isNaN(n));
        const svg = renderSparkline(nums); // uses globalThis.document (set before)
        const frag = doc.createDocumentFragment();
        if (m.index! > 0) frag.appendChild(doc.createTextNode(t.slice(0, m.index)));
        frag.appendChild(svg);
        const rest = t.slice(m.index! + m[0].length);
        if (rest) frag.appendChild(doc.createTextNode(rest));
        (child as El).replaceWith(frag);
      } else if (child.nodeType === 1) {
        const tag = (child.tagName || "").toUpperCase();
        if (tag === "CODE" || tag === "PRE") continue;
        walk(child);
      }
    }
  };
  walk(root);
}

// --------------------------------------------------------------------------
// Task lists — reconstruct checkbox DOM + checked state from the raw markdown
// --------------------------------------------------------------------------
function decorateTaskLists(doc: Doc, root: El, md: string): void {
  const state = new Map<string, boolean>();
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (m) state.set(m[2].trim(), m[1].toLowerCase() === "x");
  }
  if (!state.size) return;
  for (const li of Array.from(root.querySelectorAll("li")) as El[]) {
    const text = (li.textContent || "").trim();
    if (!state.has(text)) continue;
    const checked = state.get(text)!;
    const ul = li.parentNode as El;
    if (ul && (ul.tagName || "").toLowerCase() === "ul") ul.setAttribute("data-type", "taskList");
    li.setAttribute("data-checked", checked ? "true" : "false");
    const div = doc.createElement("div");
    while (li.firstChild) div.appendChild(li.firstChild);
    const label = doc.createElement("label");
    const input = doc.createElement("input");
    input.setAttribute("type", "checkbox");
    if (checked) input.setAttribute("checked", "checked");
    const span = doc.createElement("span");
    label.appendChild(input);
    label.appendChild(span);
    li.appendChild(label);
    li.appendChild(div);
  }
}

// --------------------------------------------------------------------------
// Dynamic tables — currency/number formatting + aggregation footer
// --------------------------------------------------------------------------
interface ColMeta { type: string; currency: string | null; aggregation: string | null }
const AGG_LABELS: Record<string, string> = { sum: "Sum:", avg: "Avg:", count: "Count:", min: "Min:", max: "Max:" };

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
function parseCellMeta(cell: string): ColMeta {
  const meta: ColMeta = { type: "text", currency: null, aggregation: null };
  const m = cell.match(/<!--\s*(.*?)\s*-->/);
  if (m) {
    for (const pair of m[1].split(",")) {
      const [k, v] = pair.split(":").map((x) => x.trim());
      if (k === "type") meta.type = v;
      else if (k === "currency") meta.currency = v;
      else if (k === "summary") meta.aggregation = v;
    }
  }
  return meta;
}
/** Per-table column metadata parsed from the markdown header rows, in order. */
function parseTableMetas(md: string): ColMeta[][] {
  const lines = md.split("\n");
  const tables: ColMeta[][] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const sep = lines[i + 1];
    if (/\|/.test(lines[i]) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(sep)) {
      tables.push(splitRow(lines[i]).map(parseCellMeta));
      i++;
    }
  }
  return tables;
}
function computeAgg(type: string, vals: number[]): number {
  if (type === "count") return vals.length;
  if (!vals.length) return NaN;
  if (type === "sum") return vals.reduce((a, b) => a + b, 0);
  if (type === "avg") return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (type === "min") return Math.min(...vals);
  if (type === "max") return Math.max(...vals);
  return NaN;
}
const NUMERIC = new Set(["currency", "number", "percentage"]);
function decorateTables(doc: Doc, root: El, md: string): void {
  const metasPerTable = parseTableMetas(md);
  const tables = Array.from(root.querySelectorAll("table")) as El[];
  tables.forEach((table, ti) => {
    const metas = metasPerTable[ti];
    if (!metas) return;
    const rows = Array.from(table.querySelectorAll("tr")) as El[];
    const bodyRows = rows.filter((r) => !r.querySelector("th"));
    // Currency / number / percentage formatting.
    for (const r of bodyRows) {
      const cells = Array.from(r.children) as El[];
      cells.forEach((td, ci) => {
        const meta = metas[ci];
        if (!meta || !NUMERIC.has(meta.type)) return;
        const val = parseNumericValue((td.textContent || "").trim(), meta.type);
        if (isNaN(val)) return;
        const p = td.querySelector("p") || td;
        p.textContent = formatValue(val, meta.type, meta.currency);
      });
    }
    // Aggregation footer.
    if (metas.some((m) => m.aggregation)) {
      const tr = doc.createElement("tr");
      tr.setAttribute("class", "table-aggregation-footer");
      tr.setAttribute("contenteditable", "false");
      metas.forEach((meta, ci) => {
        const td = doc.createElement("td");
        td.setAttribute("class", "table-aggregation-cell");
        if (meta.aggregation) {
          const vals = bodyRows
            .map((r) => (r.children[ci] ? parseNumericValue((r.children[ci].textContent || "").trim(), meta.type) : NaN))
            .filter((n: number) => !isNaN(n));
          const agg = computeAgg(meta.aggregation, vals);
          const formatted = meta.aggregation === "count" ? String(agg) : formatValue(agg, meta.type, meta.currency);
          td.textContent = `${AGG_LABELS[meta.aggregation] || ""} ${formatted}`.trim();
        }
        tr.appendChild(td);
      });
      (table.querySelector("tbody") || table).appendChild(tr);
    }
  });
}

// --------------------------------------------------------------------------
// Tag / mention inline badges (run LAST so structural passes see plain text)
// --------------------------------------------------------------------------
const SKIP_TAGS = new Set(["CODE", "PRE", "A", "SCRIPT", "STYLE", "SVG"]);
const SKIP_CLASSES = ["tag-badge", "mention-badge", "callout-label"];
const TOKEN = /(?<![\w/])([#@])([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;
function decorateTagsAndMentions(doc: Doc, root: El): void {
  const walk = (node: El): void => {
    for (const child of Array.from(node.childNodes) as El[]) {
      if (child.nodeType === 3) {
        const text = child.nodeValue || "";
        if (!/[#@]/.test(text)) continue;
        TOKEN.lastIndex = 0;
        if (!TOKEN.test(text)) continue;
        TOKEN.lastIndex = 0;
        const frag = doc.createDocumentFragment();
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = TOKEN.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
          const [full, sigil, word] = m;
          const span = doc.createElement("span");
          if (sigil === "#") {
            span.setAttribute("class", "tag-badge");
            span.setAttribute("data-tag", word);
          } else {
            span.setAttribute("class", "mention-badge");
            span.setAttribute("data-mention", word);
          }
          span.textContent = full;
          frag.appendChild(span);
          last = m.index + full.length;
        }
        if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
        (child as El).replaceWith(frag);
      } else if (child.nodeType === 1) {
        const tag = (child.tagName || "").toUpperCase();
        const cls = child.getAttribute("class") || "";
        if (SKIP_TAGS.has(tag)) continue;
        if (SKIP_CLASSES.some((c) => cls.includes(c))) continue;
        walk(child);
      }
    }
  };
  walk(root);
}

/** Render a full markdown file (frontmatter stripped) to `.ProseMirror` inner HTML. */
export function renderProseMirrorHtml(rawMarkdown: string): string {
  const { content } = parseFrontmatter(rawMarkdown);
  const { doc } = parseMarkdownToProseMirrorJson(content);
  const node = PMNode.fromJSON(schema, doc);
  const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");
  // `renderSparkline` builds its SVG via the global `document`.
  (globalThis as any).document = document;
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(node.content, { document });
  const wrap = document.createElement("div");
  wrap.appendChild(fragment);
  decorateCallouts(document, wrap);
  decorateCodeBlocks(wrap);
  decorateTaskLists(document, wrap, content);
  decorateTables(document, wrap, content);
  decorateSparklines(document, wrap);
  decorateTagsAndMentions(document, wrap);
  return wrap.innerHTML;
}
