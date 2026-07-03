/**
 * Getting Started page — install → first AI-assisted note, plus the top
 * keyboard shortcuts. Built from content/pages/getting-started.md and
 * shortcuts-highlights.md, in the shared site chrome.
 */
import { nav, footer, closingCta, htmlDoc, DOWNLOAD_URL } from "./shell";

interface Step { title: string; body: string }
function step(n: number, { title, body }: Step): string {
  return `<div class="step"><div class="step-num">${n}</div><div class="step-body"><h2>${title}</h2>${body}</div></div>`;
}

const STEPS: Step[] = [
  {
    title: "Install Notesage",
    body: `<ol>
      <li>Download the latest <strong>.dmg</strong> from the <a href="${DOWNLOAD_URL}">releases page</a>.</li>
      <li>Open it, drag Notesage to your <strong>Applications</strong> folder, and launch it.</li>
      <li>On first launch, macOS may ask you to confirm — click <strong>Open</strong>.</li>
    </ol>`,
  },
  {
    title: "Open a folder",
    body: `<p>Notesage works with folders of markdown files — your existing notes, a new folder, anything.</p>
      <ol>
        <li>Press <kbd>⌘O</kbd> (or click <strong>Open Folder</strong> on the welcome screen).</li>
        <li>Choose any folder on your computer. Its files appear in the sidebar.</li>
      </ol>
      <div class="step-tip">No folder yet? Create a new one anywhere — Desktop, Documents, wherever. Notesage will make notes inside it.</div>`,
  },
  {
    title: "Connect an AI provider",
    body: `<p>You can write without any AI, but to use chat and assistance you'll add a connection.</p>
      <ol>
        <li>Open <strong>Settings</strong> (<kbd>⌘,</kbd>) and click <strong>Connections</strong>.</li>
        <li>Click <strong>Add Connection</strong> and choose your provider — paste an API key (Anthropic, OpenAI), sign in with a subscription (Copilot, Gemini, Codex), point at Ollama, or enable the bundled local model with no account at all.</li>
        <li>Click <strong>Save</strong>. The connection is ready to use.</li>
      </ol>`,
  },
  {
    title: "Take your first note",
    body: `<ol>
        <li>Press <kbd>⌘N</kbd> to create a new note.</li>
        <li>Start typing. Use the toolbar to format, or type <kbd>/</kbd> to insert a callout, table, or drawing.</li>
        <li>Press <kbd>⌘K</kbd> to open the AI command bar — ask a question and the assistant replies inline.</li>
        <li>Your note saves automatically as you type.</li>
      </ol>
      <div class="step-tip">That's it — your note is a plain <strong>.md</strong> file in your folder, ready to open in any editor.</div>`,
  },
];

const TIPS: Array<[string, string]> = [
  ["⌘⇧K", "See the full keyboard-shortcut reference."],
  ["⌘⇧N", "Create a project — a folder with its own AI context."],
  ["⌘.", "Toggle focus mode and just write."],
  ["⌘⇧E", "Export to PDF, Word, or PowerPoint."],
];

const SHORTCUTS: Array<[string, string]> = [
  ["⌘K", "Open the AI command bar (or double-tap ⌘)"],
  ["⌘S", "Save the current note"],
  ["⌘N", "New note"],
  ["⌘⇧E", "Export to PDF, Word, or PowerPoint"],
  ["⌘F", "Find text in the current note"],
  ["⌘.", "Toggle focus mode"],
  ["⌘⇧R", "Start / stop meeting recording"],
  ["⌘⌥C", "Add an inline comment to the selection"],
  ["⌘⇧K", "Show the full shortcut reference"],
  ["⌘,", "Open Settings"],
];

const BOLT = '<span class="fi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>';

export function gettingStartedHtml(css: string): string {
  const hero = `<header class="subhero">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="wrap">
      <div class="eyebrow">Getting started</div>
      <h1>From download to your first note.</h1>
      <p class="lede">Five minutes, four steps — then a few shortcuts that change how you work.</p>
    </div>
  </header>`;

  const steps = `<section class="feat-cat"><div class="wrap"><div class="steps">${STEPS.map((s, i) => step(i + 1, s)).join("")}</div></div></section>`;

  const tips = `<section class="feat-cat"><div class="wrap">
    <div class="sec-head"><h2>What's next</h2><p>A few things worth trying once you're in.</p></div>
    <div class="tips">${TIPS.map(([k, t]) => `<div class="tip-card">${BOLT}<p><kbd>${k}</kbd> &nbsp;${t}</p></div>`).join("")}</div>
  </div></section>`;

  const rows = SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join("");
  const shortcuts = `<section class="feat-cat"><div class="wrap">
    <div class="sec-head"><h2>Top keyboard shortcuts</h2><p>The ten that will change how you use Notesage.</p></div>
    <div class="sc-wrap"><table class="sc-table"><tbody>${rows}</tbody></table></div>
  </div></section>`;

  const body = `${nav("getting-started")}
  ${hero}
  ${steps}
  ${tips}
  ${shortcuts}
  ${closingCta()}
  ${footer()}`;

  return htmlDoc({ title: "Getting started — Notesage", appCss: css, body });
}
