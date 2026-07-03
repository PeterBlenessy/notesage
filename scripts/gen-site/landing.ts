/**
 * Marketing landing page assembler. Composes the generated app-window mockups
 * and content close-ups with copy from the content atoms (pitch.md,
 * use-cases.md), wrapped in the shared site chrome (shell.ts) and styled by the
 * app's compiled CSS. No framework, no build step.
 */
import { appWindow, type WindowOpts } from "./frame";
import { APPLE, icon, page, closingCta, htmlDoc, DOWNLOAD_URL } from "./shell";

/** A scaled device frame around an app-window mockup, wrapped in a glow stage. */
function device(editorHtml: string, opts: WindowOpts, scale = 0.62, dark = false): string {
  const w = Math.round(1200 * scale);
  const h = Math.round(760 * scale);
  // The mockup is a decorative illustration of the app — hide its (fake) menu
  // items and icons from assistive tech.
  const shot = `<div class="shot" aria-hidden="true"><div class="device" style="width:${w}px;height:${h}px"><div class="device-inner" style="transform:scale(${scale})">${appWindow(editorHtml, opts)}</div></div></div>`;
  return dark ? `<div class="dark">${shot}</div>` : shot;
}

/**
 * A content close-up: a floating rounded card showing the top of a rendered
 * document at full editor size (no window chrome, no scale-down) — a distinct
 * composition from the full-window `device()` shots, to show off rich content
 * large and legible. `offset` nudges the content up to bring a lower block in.
 */
function contentCardInner(editorHtml: string, offset = 0): string {
  return `<div class="content-card"><div class="cc-scroll" style="transform:translateY(${offset}px)"><div class="ProseMirror" translate="no">${editorHtml}</div></div><div class="cc-fade"></div></div>`;
}
function contentCard(editorHtml: string, offset = 0): string {
  return `<div class="shot" aria-hidden="true">${contentCardInner(editorHtml, offset)}</div>`;
}

/**
 * A chart figure — a PNG screenshot of the REAL app Recharts node-view rendered
 * headlessly by render-charts.mjs (the screenshot exception for React node-views
 * the deterministic pipeline can't serialize). Run render-charts.mjs first.
 */
function chartCard(src: string, caption: string): string {
  return `<figure class="chart-card"><figcaption>${caption}</figcaption><img src="${src}" alt="${caption}"></figure>`;
}

/**
 * Mark the top-level block containing `needle` as the cursor's block. The app's
 * Focus extension adds `has-focus` at runtime; statically we add it ourselves so
 * `.focus-mode .ProseMirror > .has-focus { opacity: 1 }` keeps that block crisp
 * while its siblings dim to 0.3 — the real focus-mode look, plus a blinking caret.
 */
function focusBlock(html: string, needle: string): string {
  const open = `<p>${needle}`;
  const start = html.indexOf(open);
  if (start === -1) return html;
  const end = html.indexOf("</p>", start);
  if (end === -1) return html.replace(open, `<p class="has-focus">${needle}`);
  const para = html.slice(start, end).replace("<p>", '<p class="has-focus">');
  const caret = '<span class="ns-caret" aria-hidden="true"></span>';
  return html.slice(0, start) + para + caret + html.slice(end);
}

function heroSection(editorHtml: string): string {
  return `<header class="hero" id="top">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="wrap hero-copy">
      <div class="eyebrow">Markdown editor · AI you control</div>
      <h1>The writing tool that<br><span class="accent-word">thinks</span> with you.</h1>
      <p class="lede">A fast, private desktop app that pairs a beautiful markdown editor with AI you control. Write your ideas, bring any model you already use, and let the two work together — without your notes ever leaving your computer.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${DOWNLOAD_URL}">${APPLE}<span>Download for Mac</span></a>
        <a class="btn btn-ghost" href="#editor">See how it works</a>
      </div>
      <div class="trust">Private by default<i></i>Local-first<i></i>Bring any model</div>
    </div>
    <div class="hero-shot" aria-hidden="true">${device(editorHtml, { active: "On Attention.md" }, 0.86)}</div>
    <div class="works">
      <span class="works-label">Works with the models you already use</span>
      <div class="works-row">
        <span>Claude</span><span>GPT‑4o</span><span>Gemini</span><span>Copilot</span><span>Ollama</span><span>Local models</span>
      </div>
    </div>
  </header>`;
}

interface FeatureOpts { id?: string; title: string; body: string; mockup: string; flip?: boolean; dark?: boolean }
function feature({ id, title, body, mockup, flip, dark }: FeatureOpts): string {
  return `<section class="feature${flip ? " flip" : ""}${dark ? " section-dark dark" : ""}"${id ? ` id="${id}"` : ""}>
    ${dark ? '<div class="sect-glow" aria-hidden="true"></div>' : ""}
    <div class="wrap grid">
      <div class="copy"><h2>${title}</h2><p>${body}</p></div>
      <div class="art">${mockup}</div>
    </div>
  </section>`;
}

function cardsBand(): string {
  const cards: Array<[string, string, string]> = [
    [icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'), "Comments you can delegate", "Select a line, leave a comment, hand it to an agent — the reply threads inline, right where the question was asked."],
    [icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'), "Export anywhere", "One document to PDF, Word, PowerPoint, or HTML — typeset with your own presets, not dumped through a converter."],
    [icon('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'), "Wiki-links & backlinks", "Link between notes with [[…]], hover to preview, and see everything that links back — a folder of notes reads like a wiki."],
  ];
  return `<section class="cards-band" aria-label="Highlights"><h2 class="visually-hidden">Highlights</h2><div class="wrap cards">
    ${cards.map(([ic, t, b]) => `<div class="card"><div class="card-ic">${ic}</div><h3>${t}</h3><p>${b}</p></div>`).join("")}
  </div></section>`;
}

/** Use-case band — activities anyone can recognize (vs. named personas). */
function useCasesBand(): string {
  const cases: Array<[string, string, string]> = [
    [icon('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'), "Turn conversations into notes", "Record a meeting or a quick thought — Notesage transcribes it on your own device into a note you can edit, tag, and act on."],
    [icon('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'), "Make sense of what you read", "Open PDFs, ebooks, and papers in place, highlight a passage, and hand it to the assistant to explain or summarise."],
    [icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'), "Find everything on a topic", "Tags, @mentions, and backlinks pull related notes together — one click gathers everything on an idea across your whole library."],
    [icon('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.84z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'), "Keep every client separate", "Give each project its own space and its own AI, so confidential work stays sealed off from everything else."],
  ];
  return `<section class="usecases"><div class="wrap">
    <div class="uc-head"><div class="eyebrow">Made for the way you work</div><h2>However you work, it keeps up.</h2></div>
    <div class="uc-grid">
      ${cases.map(([ic, t, b]) => `<div class="uc-item"><div class="card-ic">${ic}</div><h3>${t}</h3><p>${b}</p></div>`).join("")}
    </div>
  </div></section>`;
}

/** Privacy statement band — icon trio, no mockup (breaks the shot cadence). */
function privacyBand(): string {
  const items: Array<[string, string, string]> = [
    [icon('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'), "Local-first files", "Every note is a plain .md on your disk — open them in any editor, sync them however you like."],
    [icon('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'), "No account, no lock-in", "Nothing uploaded behind your back. API keys live in the OS keychain, never in a config file."],
    [icon('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>'), "Provider isolation", "Lock a project to one model; its material never mixes with another's or widens into AI context."],
  ];
  return `<section class="privacy-band" id="privacy"><div class="wrap">
    <div class="pb-head"><div class="eyebrow">Private by default</div><h2>Your work stays yours.</h2></div>
    <div class="pb-grid">
      ${items.map(([ic, t, b]) => `<div class="pb-item"><div class="card-ic">${ic}</div><h3>${t}</h3><p>${b}</p></div>`).join("")}
    </div>
  </div></section>`;
}

export function landingHtml(css: string, editors: Record<string, string>): string {
  // Each section shows a DIFFERENT document AND a different composition
  // (dark chat panel / content close-up / focus window) so the product never
  // repeats the same essay in the same frame.
  const aiFeature = feature({
    id: "ai",
    title: "Work with any AI, your way.",
    body: "Bring your own key, use your Claude, Copilot, or Gemini subscription, or run a model fully offline. Watch it think, call tools, and ask permission before it ever touches your files — the assistant works beside your writing, never behind your back.",
    mockup: device(editors.hero, { cmdBar: "pinned", sidebar: false }, 0.56, true),
    dark: true,
  });
  const richFeature = feature({
    id: "editor",
    title: "Rich blocks, clean markdown.",
    body: "Callouts, task lists, syntax-highlighted code, tags and @mentions, wiki-links between notes — write in rich text and save an ordinary .md file you own. Nothing proprietary, nothing to migrate off later.",
    mockup: contentCard(editors.formatting, -46),
    flip: true,
  });
  const dataFeature = feature({
    title: "Tables that compute, charts that explain.",
    body: "Give a column a type — currency, percentage, date — then sort, filter, and total it with an aggregation footer. Turn any series into a live chart in a click. It looks like a small spreadsheet; it's still plain GitHub-flavoured markdown.",
    mockup: `<div class="shot data-stack" aria-hidden="true">${contentCardInner(editors["quarterly-review"])}${chartCard("assets/chart-revenue.png", "Revenue by quarter")}</div>`,
  });
  const focusFeature = feature({
    title: "Write without distraction.",
    body: "Focus mode softly dims every block but the one you're writing — no sidebar, no toolbars, just the sentence in front of you. When a thought needs a second opinion, summon the assistant with a keystroke, ask, and send it away again.",
    mockup: device(focusBlock(editors["notes-on-craft"], "Revision is not fixing mistakes"), { focus: true }, 0.56),
    flip: true,
  });

  const body = page("", `${heroSection(editors.hero)}
  ${cardsBand()}
  ${aiFeature}
  ${richFeature}
  ${dataFeature}
  ${focusFeature}
  ${useCasesBand()}
  ${privacyBand()}
  ${closingCta()}`);

  return htmlDoc({ title: "Notesage — the writing tool that thinks with you", appCss: css, body });
}
