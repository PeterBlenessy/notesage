/**
 * Features page — the full capability map, grouped into categories (ref:
 * mossnotes.app/features). Static text + icons only; no product shots. Uses the
 * shared shell (nav, footer, CTA, base CSS). Copy is user-facing and traces to
 * docs/features/* and docs/product-description.md.
 */
import { page, closingCta, htmlDoc } from "./shell";

/** An 18px accent feature icon (decorative). */
function fi(paths: string): string {
  return `<span class="fi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg></span>`;
}

type Item = [string, string, string]; // [iconPaths, title, description]
interface Category { title: string; blurb: string; items: Item[] }

function category({ title, blurb, items }: Category): string {
  const grid = items
    .map(([ic, t, d]) => `<div class="feat-item">${fi(ic)}<div><h3>${t}</h3><p>${d}</p></div></div>`)
    .join("");
  return `<section class="feat-cat"><div class="wrap">
    <div class="feat-cat-head"><h2>${title}</h2><p>${blurb}</p></div>
    <div class="feat-grid">${grid}</div>
  </div></section>`;
}

const CATEGORIES: Category[] = [
  {
    title: "The editor",
    blurb: "A rich writing surface that always saves to clean, ordinary markdown.",
    items: [
      ['<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>', "Rich blocks", "Callouts, code blocks, quotes, dividers, and task lists — every block round-trips losslessly to markdown."],
      ['<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>', "Tables that compute", "Column types, click-to-sort, row filtering, an aggregation footer, and inline sparklines."],
      ['<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="12" y="6" width="3" height="12"/><rect x="17" y="13" width="3" height="5"/>', "Charts & drawings", "Live charts (bar, line, pie, and more) and an Excalidraw canvas for sketches — embedded in the note."],
      ['<line x1="9" y1="20" x2="15" y2="4"/>', "Slash commands", "Type / to insert any block; select text for a bubble menu with AI edits."],
      ['<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>', "Wiki-links & backlinks", "Link between notes with [[…]], hover to preview, and see everything that links back."],
      ['<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', "Focus mode", "Softly dim every block but the one you're writing. Press ⌘. to toggle."],
    ],
  },
  {
    title: "Work with AI",
    blurb: "Connect the models you already use — and keep control of what they touch.",
    items: [
      ['<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/>', "Any provider", "Anthropic, OpenAI, Copilot, Gemini, Ollama, or a bundled local model — a key, a subscription, or nothing."],
      ['<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/><path d="M12 7v4"/><path d="M8 7h8"/><circle cx="12" cy="5" r="2"/>', "Agents that act", "Let an agent read and edit files, run skills, and search the web — it asks before it writes a file or runs a command."],
      ['<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', "Chat beside your writing", "A floating command bar (⌘K) you can pin as a side panel; watch it think, call tools, and cite sources."],
      ['<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>', "Skills & MCP", "Extend the assistant with Agent Skills and MCP servers — the open standards other AI tools use."],
      ['<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>', "Comments → agents", "Delegate a comment to an agent; the reply threads inline and can be applied as a tracked edit."],
      ['<path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.7"/><path d="M19 12.9a10 10 0 0 0-3-2.3"/><path d="M2 8.8a15 15 0 0 1 4.2-2.5"/><path d="M17.8 6.3A15 15 0 0 1 22 8.8"/><line x1="2" y1="2" x2="22" y2="22"/>', "Runs fully offline", "Download a model once and chat, complete, and run local tools entirely on your machine — no account, no cloud."],
    ],
  },
  {
    title: "Read & capture",
    blurb: "Bring the world into your notes — documents, meetings, images, and sources.",
    items: [
      ['<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', "Document viewers", "Open PDFs, EPUBs, Word, and PowerPoint files in place, with in-document search."],
      ['<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>', "Meeting recording", "Record a meeting and transcribe it on-device with Whisper — no audio ever leaves your Mac."],
      ['<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>', "Vision & images", "Paste or drop images into chat and ask a vision-capable model about them."],
      ['<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>', "Research tools", "Save web pages as clean markdown, search your corpus, and synthesize sources with citations."],
    ],
  },
  {
    title: "Organize your library",
    blurb: "Structure that keeps up — without a giant file tree to babysit.",
    items: [
      ['<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>', "Projects", "Dedicated spaces with their own notes, settings, and AI — lock one to a single provider."],
      ['<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>', "Curated sidebar", "Pinned, recent, tags, mentions, and folders — navigate by what matters, not a deep tree."],
      ['<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', "Instant search", "A local index over tags, mentions, tasks, and full text — results as you type."],
      ['<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>', "Git & external changes", "See file status, commit, review a branch diff, and catch edits made in other apps."],
      ['<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>', "iCloud sync", "Optional, per-project sync through Apple's encrypted iCloud — off unless you turn it on."],
      ['<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', "Tags & mentions", "#tags and @mentions light up as you type and gather every related note in one click."],
    ],
  },
  {
    title: "Deliver & share",
    blurb: "Hand off something that looks finished, from the same plain note.",
    items: [
      ['<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>', "Export anywhere", "Typeset PDF, Word, PowerPoint, or a self-contained HTML file — all from one document."],
      ['<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/>', "Your own presets", "Exports use your editor styles and templates — not a generic one-size converter."],
      ['<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>', "Typeset, not dumped", "Headings, tables, and callouts line up; drawings and charts come along as crisp vectors."],
    ],
  },
  {
    title: "Private by default",
    blurb: "Local-first, sandboxed, and open — the details live on the Privacy page.",
    items: [
      ['<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>', "Local-first files", "Every note is a plain .md file in a folder you choose, on your own device."],
      ['<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>', "Keys in the keychain", "API keys live in the OS keychain, never a config file, and are deleted when you disconnect."],
      ['<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>', "Sandboxed agents", "An OS-level file and network sandbox surrounds every agent; unknown domains are blocked for approval."],
      ['<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>', "Open source", "Read the code, audit exactly what it does, and build it yourself. No hidden behaviour."],
    ],
  },
];

export function featuresHtml(css: string): string {
  const hero = `<header class="subhero">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="wrap">
      <div class="eyebrow">Features</div>
      <h1>Everything, in one quiet workspace.</h1>
      <p class="lede">A markdown editor, an AI collaborator you control, document viewers, on-device recording, and one-step export — all local-first and yours. Here's the full picture.</p>
    </div>
  </header>`;

  const body = page("features", `${hero}
  ${CATEGORIES.map(category).join("\n")}
  ${closingCta()}`);

  return htmlDoc({ title: "Features — Notesage", appCss: css, body });
}
