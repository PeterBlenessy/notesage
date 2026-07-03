/**
 * Marketing landing page assembler (step 4). Plain static HTML: composes the
 * generated app-window mockups (scaled "device" frames, some forced dark via a
 * `.dark` wrapper) with copy from the content atoms (pitch.md, use-cases.md),
 * styled by the app's compiled CSS. No framework, no build step.
 *
 * Design language (ref: granola.ai, openknowledge.ai): premium through
 * restraint — a warm-neutral base, generous whitespace, a single opt-in accent
 * (Notesage's shipped "orange" — `class="accent-orange"` on <html> resolves
 * `--color-accent-primary`), and product shots floated over soft radial glows
 * with layered shadows. Dark sections flip the app tokens via a `.dark` wrapper.
 */
import { appWindow, type WindowOpts } from "./frame";

const APPLE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>`;

/** A scaled device frame around an app-window mockup, wrapped in a glow stage. */
function device(editorHtml: string, opts: WindowOpts, scale = 0.62, dark = false): string {
  const w = Math.round(1200 * scale);
  const h = Math.round(760 * scale);
  const shot = `<div class="shot"><div class="device" style="width:${w}px;height:${h}px"><div class="device-inner" style="transform:scale(${scale})">${appWindow(editorHtml, opts)}</div></div></div>`;
  return dark ? `<div class="dark">${shot}</div>` : shot;
}

/**
 * A content close-up: a floating rounded card showing the top of a rendered
 * document at full editor size (no window chrome, no scale-down). A distinct
 * composition from the full-window `device()` shots — used to show off rich
 * content (callouts, tables, code) large and legible. `offset` nudges the
 * content up to bring a lower block into the crop.
 */
function contentCardInner(editorHtml: string, offset = 0): string {
  return `<div class="content-card"><div class="cc-scroll" style="transform:translateY(${offset}px)"><div class="ProseMirror" translate="no">${editorHtml}</div></div><div class="cc-fade"></div></div>`;
}
function contentCard(editorHtml: string, offset = 0): string {
  return `<div class="shot">${contentCardInner(editorHtml, offset)}</div>`;
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
 * while its siblings dim to 0.3 — the real focus-mode look, not a flat wash.
 */
function focusBlock(html: string, needle: string): string {
  const open = `<p>${needle}`;
  const start = html.indexOf(open);
  if (start === -1) return html;
  const end = html.indexOf("</p>", start);
  if (end === -1) return html.replace(open, `<p class="has-focus">${needle}`);
  const para = html.slice(start, end).replace("<p>", '<p class="has-focus">');
  // A blinking caret at the end of the block signals "you're writing here".
  const caret = '<span class="ns-caret" aria-hidden="true"></span>';
  return html.slice(0, start) + para + caret + html.slice(end);
}

function nav(): string {
  return `<nav class="nav">
    <div class="wrap nav-in">
      <a class="brand" href="#top">
        <span class="brand-mark">N</span><span class="brand-name">Notesage</span>
      </a>
      <div class="nav-links">
        <a href="#editor">Editor</a>
        <a href="#ai">AI</a>
        <a href="#privacy">Privacy</a>
        <a class="btn btn-primary btn-sm" href="#download">${APPLE}<span>Download</span></a>
      </div>
    </div>
  </nav>`;
}

function heroSection(editorHtml: string): string {
  return `<header class="hero" id="top">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="wrap hero-copy">
      <div class="eyebrow">Markdown editor · AI you control</div>
      <h1>The writing tool that<br><span class="accent-word">thinks</span> with you.</h1>
      <p class="lede">A fast, private desktop app that pairs a beautiful markdown editor with AI you control. Write your ideas, bring any model you already use, and let the two work together — without your notes ever leaving your computer.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="#download">${APPLE}<span>Download for Mac</span></a>
        <a class="btn btn-ghost" href="#editor">See how it works</a>
      </div>
      <div class="trust">Private by default<i></i>Local-first<i></i>Bring any model</div>
    </div>
    <div class="hero-shot">${device(editorHtml, { active: "On Attention.md" }, 0.86)}</div>
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

function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
function cardsBand(): string {
  const cards: Array<[string, string, string]> = [
    [icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'), "Comments you can delegate", "Select a line, leave a comment, hand it to an agent — the reply threads inline, right where the question was asked."],
    [icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'), "Export anywhere", "One document to PDF, Word, PowerPoint, or HTML — typeset with your own presets, not dumped through a converter."],
    [icon('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'), "Wiki-links & backlinks", "Link between notes with [[…]], hover to preview, and see everything that links back — a folder of notes reads like a wiki."],
  ];
  return `<section class="cards-band"><div class="wrap cards">
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

function closingCta(): string {
  return `<section class="cta-band" id="download">
    <div class="cta-glow" aria-hidden="true"></div>
    <div class="wrap cta-in">
      <h2>Write with a clearer head.</h2>
      <p>Free, private, and yours. No account required.</p>
      <a class="btn btn-primary btn-lg" href="#top">${APPLE}<span>Download for Mac</span></a>
      <div class="cta-meta">macOS 13+ · Apple silicon &amp; Intel · Free while in alpha</div>
    </div>
  </section>`;
}

function footer(): string {
  return `<footer class="footer"><div class="wrap footer-in">
    <div class="footer-brand">
      <div class="brand"><span class="brand-mark">N</span><span class="brand-name">Notesage</span></div>
      <p>The writing tool that thinks with you. Private by default, on your device.</p>
    </div>
    <div class="footer-cols">
      <div><h4>Product</h4><a href="#editor">Editor</a><a href="#ai">AI</a><a href="#privacy">Privacy</a></div>
      <div><h4>Platform</h4><a href="#download">Download</a><a href="#top">macOS</a></div>
    </div>
  </div>
  <div class="wrap footer-legal">© Notesage · Your notes, on your device.</div>
  </footer>`;
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
    mockup: `<div class="shot data-stack">${contentCardInner(editors["quarterly-review"])}${chartCard("assets/chart-revenue.png", "Revenue by quarter")}</div>`,
  });
  const focusFeature = feature({
    title: "Write without distraction.",
    body: "Focus mode softly dims every block but the one you're writing — no sidebar, no toolbars, just the sentence in front of you. When a thought needs a second opinion, summon the assistant with a keystroke, ask, and send it away again.",
    mockup: device(focusBlock(editors["notes-on-craft"], "Revision is not fixing mistakes"), { focus: true }, 0.56),
    flip: true,
  });

  return `<!DOCTYPE html>
<html lang="en" class="accent-orange">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notesage — the writing tool that thinks with you</title>
<style>${css}</style>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--page-bg); color: var(--color-foreground);
    font-family: "SF Pro Display", -apple-system, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  /* Warm-neutral page base + a soft accent tint mixed in — not pure grey. */
  :root { --page-bg: oklch(98.6% 0.006 70); --accent-soft: color-mix(in oklch, var(--color-accent-primary) 12%, transparent); }
  a { color: inherit; text-decoration: none; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }

  /* ---- Nav -------------------------------------------------------------- */
  .nav { position: sticky; top: 0; z-index: 50; backdrop-filter: saturate(1.2) blur(12px);
    background: color-mix(in oklch, var(--page-bg) 78%, transparent); border-bottom: 1px solid color-mix(in oklch, var(--color-border) 60%, transparent); }
  .nav-in { display: flex; align-items: center; justify-content: space-between; height: 60px; }
  .brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 600; letter-spacing: -0.01em; }
  .brand-mark { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 7px;
    background: var(--color-foreground); color: var(--color-background); font-family: Georgia, "Times New Roman", serif; font-style: italic; font-weight: 700; font-size: 15px; }
  .brand-name { font-size: 16px; }
  .nav-links { display: flex; align-items: center; gap: 26px; font-size: 14px; color: var(--color-muted-foreground); }
  .nav-links a:not(.btn):hover { color: var(--color-foreground); }

  /* ---- Buttons ---------------------------------------------------------- */
  .btn { display: inline-flex; align-items: center; gap: 8px; border-radius: 10px; font-weight: 550; font-size: 15px;
    padding: 11px 18px; transition: transform .15s ease, box-shadow .15s ease, background .15s ease; cursor: pointer; white-space: nowrap; }
  .btn svg { flex: none; }
  .btn-primary { background: var(--color-accent-primary); color: var(--color-on-accent, oklch(100% 0 0));
    box-shadow: 0 1px 2px rgba(0,0,0,.12), 0 8px 24px -8px var(--color-accent-primary); }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 2px 4px rgba(0,0,0,.14), 0 14px 34px -8px var(--color-accent-primary); }
  .btn-ghost { background: transparent; color: var(--color-foreground); border: 1px solid var(--color-border-strong); }
  .btn-ghost:hover { background: color-mix(in oklch, var(--color-foreground) 5%, transparent); }
  .btn-sm { padding: 7px 13px; font-size: 14px; border-radius: 9px; }
  .btn-lg { padding: 14px 24px; font-size: 16px; border-radius: 12px; }

  /* ---- Hero ------------------------------------------------------------- */
  .hero { position: relative; text-align: center; padding: 84px 0 0; overflow: hidden; }
  .hero-bg { position: absolute; inset: -10% -10% auto -10%; height: 780px; z-index: 0; pointer-events: none;
    background:
      radial-gradient(60% 52% at 50% 0%, var(--accent-soft), transparent 70%),
      radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--color-foreground) 8%, transparent) 1px, transparent 0);
    background-size: auto, 26px 26px;
    -webkit-mask-image: radial-gradient(70% 60% at 50% 12%, #000 30%, transparent 78%);
            mask-image: radial-gradient(70% 60% at 50% 12%, #000 30%, transparent 78%); }
  .hero-copy { position: relative; z-index: 1; }
  .eyebrow { display: inline-block; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    color: var(--color-accent-primary); margin-bottom: 20px; }
  .hero h1 { font-size: clamp(42px, 6.6vw, 78px); line-height: 1.02; letter-spacing: -0.028em; font-weight: 700; margin: 0 0 22px; }
  .accent-word { font-family: Charter, "Source Serif 4", Georgia, serif; font-style: italic; font-weight: 600; }
  .lede { max-width: 620px; margin: 0 auto; font-size: clamp(16px, 1.9vw, 20px); line-height: 1.55; color: var(--color-muted-foreground); }
  .cta-row { display: flex; gap: 12px; justify-content: center; margin-top: 30px; flex-wrap: wrap; }
  .trust { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 22px;
    font-size: 13.5px; color: var(--color-muted-foreground); }
  .trust i { width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: .5; }

  /* Hero product shot — floated on the glow, rising into the page. */
  .hero-shot { position: relative; z-index: 1; margin-top: 54px; display: flex; justify-content: center; }

  /* ---- Product shot framing (shared) ------------------------------------ */
  .shot { position: relative; display: flex; justify-content: center; }
  .shot::before { content: ""; position: absolute; z-index: 0; left: 50%; top: 46%; transform: translate(-50%, -50%);
    width: 92%; height: 78%; border-radius: 40%;
    background: radial-gradient(closest-side, var(--accent-soft), transparent 72%); filter: blur(26px); }
  .device { position: relative; z-index: 1; overflow: hidden; }
  .device-inner { transform-origin: top left; position: absolute; top: 0; left: 0; width: 1200px; height: 760px; }
  /* Window chrome (landing owns this — appWindow only tags .app-window). */
  .app-window { width: 100%; height: 100%; border-radius: 14px; overflow: hidden;
    background: var(--color-background); border: 1px solid var(--color-border);
    box-shadow: 0 2px 6px rgba(0,0,0,.06), 0 40px 90px -30px rgba(0,0,0,.35); }
  .app-window .ProseMirror { padding: 0 !important; }
  .dark .app-window { border-color: color-mix(in oklch, var(--color-border) 80%, transparent);
    box-shadow: 0 2px 6px rgba(0,0,0,.4), 0 50px 110px -30px rgba(0,0,0,.7); }

  /* Content close-up — full-size rendered blocks in a floating card, cropped
     with a soft bottom fade so the crop reads as intentional, not cut off. */
  .content-card { position: relative; z-index: 1; width: 100%; max-width: 560px; height: 452px; overflow: hidden;
    border-radius: 14px; background: var(--color-background); border: 1px solid var(--color-border);
    box-shadow: 0 2px 6px rgba(0,0,0,.06), 0 40px 90px -30px rgba(0,0,0,.32); }
  .content-card .cc-scroll { padding: 30px 40px; }
  .content-card .ProseMirror { padding: 0 !important; max-width: none !important; }
  .content-card .cc-fade { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; pointer-events: none;
    background: linear-gradient(transparent, var(--color-background)); }

  /* Data section stack: computing table close-up + a real chart figure. */
  .data-stack { flex-direction: column; gap: 20px; width: 100%; max-width: 560px; }
  .data-stack .content-card { height: 300px; max-width: none; width: 100%; }
  .chart-card { position: relative; z-index: 1; margin: 0; width: 100%; border-radius: 14px; overflow: hidden;
    background: var(--color-background); border: 1px solid var(--color-border);
    box-shadow: 0 2px 6px rgba(0,0,0,.06), 0 40px 90px -30px rgba(0,0,0,.32); padding: 16px 18px 10px; }
  .chart-card figcaption { font-size: 12.5px; font-weight: 600; letter-spacing: -0.005em; color: var(--color-foreground); margin-bottom: 6px; }
  .chart-card img { display: block; width: 100%; height: auto; }

  /* Blinking caret at the end of the focused block (focus-mode shot). */
  .ns-caret { display: inline-block; width: 2px; height: 1.05em; margin-left: 1.5px; vertical-align: -0.16em;
    border-radius: 1px; background: var(--color-accent-primary); animation: ns-blink 1.1s steps(1) infinite; }
  @keyframes ns-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .ns-caret { animation: none; } }

  /* ---- Feature sections ------------------------------------------------- */
  .feature { position: relative; padding: 84px 0; }
  /* Art track is capped at the scaled device width (624px @ .52) so the shot
     never overflows/clips its column; copy takes the flexible remainder. */
  .grid { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(0, 640px); gap: 56px; align-items: center; }
  .feature.flip .grid { grid-template-columns: minmax(0, 640px) minmax(300px, 1fr); }
  .feature.flip .copy { order: 2; }
  .feature.flip .art { order: 1; }
  .feature h2 { font-size: clamp(30px, 3.6vw, 44px); line-height: 1.08; letter-spacing: -0.022em; font-weight: 700; margin: 0 0 18px; }
  .feature .copy p { font-size: clamp(15px, 1.55vw, 18px); line-height: 1.62; color: var(--color-muted-foreground); margin: 0; }
  .feature .art { display: flex; justify-content: center; min-width: 0; }
  .feature.flip .art { order: 1; }

  /* Dark section: flip app tokens + a warm accent glow behind the shot. */
  .section-dark { background: var(--color-background); color: var(--color-foreground); }
  .section-dark h2 { color: var(--color-foreground); }
  .sect-glow { position: absolute; inset: 0; z-index: 0; pointer-events: none;
    background: radial-gradient(46% 60% at 78% 40%, color-mix(in oklch, var(--color-accent-primary) 18%, transparent), transparent 68%); }
  .section-dark .wrap { position: relative; z-index: 1; }

  /* ---- Cards band ------------------------------------------------------- */
  .cards-band { padding: 24px 0 44px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .card { padding: 26px 24px; border-radius: 16px; background: var(--color-card);
    border: 1px solid var(--color-border); box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  .card-ic { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 11px;
    background: var(--accent-soft); color: var(--color-accent-primary); margin-bottom: 16px; }
  .card h3 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; }
  .card p { font-size: 14.5px; line-height: 1.55; color: var(--color-muted-foreground); margin: 0; }

  /* ---- Use-case band (what you'll do with it) --------------------------- */
  .usecases { padding: 88px 0; }
  .uc-head { text-align: center; margin-bottom: 48px; }
  .uc-head h2 { font-size: clamp(30px, 3.6vw, 44px); line-height: 1.08; letter-spacing: -0.022em; font-weight: 700; margin: 8px 0 0; }
  .uc-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 26px; max-width: 1000px; margin: 0 auto; }
  .uc-item h3 { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; }
  .uc-item p { font-size: 14px; line-height: 1.5; color: var(--color-muted-foreground); margin: 0; }
  @media (max-width: 980px) { .uc-grid { grid-template-columns: repeat(2, 1fr); } }

  /* ---- Privacy band (icon trio, no mockup) ------------------------------ */
  .privacy-band { padding: 88px 0; background: color-mix(in oklch, var(--color-foreground) 3%, var(--page-bg));
    border-block: 1px solid color-mix(in oklch, var(--color-border) 60%, transparent); }
  .pb-head { text-align: center; margin-bottom: 44px; }
  .pb-head h2 { font-size: clamp(30px, 3.6vw, 44px); line-height: 1.08; letter-spacing: -0.022em; font-weight: 700; margin: 8px 0 0; }
  .pb-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; max-width: 940px; margin: 0 auto; }
  .pb-item h3 { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; }
  .pb-item p { font-size: 14.5px; line-height: 1.55; color: var(--color-muted-foreground); margin: 0; }

  /* ---- Works-with row --------------------------------------------------- */
  .works { position: relative; z-index: 1; margin-top: 68px; padding: 40px 0 8px; text-align: center; }
  .works-label { font-size: 13px; letter-spacing: .02em; color: var(--color-muted-foreground); }
  .works-row { display: flex; align-items: center; justify-content: center; gap: 40px; flex-wrap: wrap;
    margin-top: 18px; font-size: 17px; font-weight: 600; color: color-mix(in oklch, var(--color-foreground) 55%, transparent); }

  /* ---- Closing CTA ------------------------------------------------------ */
  .cta-band { position: relative; overflow: hidden; text-align: center; padding: 110px 0; margin-top: 40px;
    background: color-mix(in oklch, var(--color-accent-primary) 7%, var(--page-bg)); border-top: 1px solid color-mix(in oklch, var(--color-border) 60%, transparent); }
  .cta-glow { position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(50% 120% at 50% 0%, var(--accent-soft), transparent 60%); }
  .cta-in { position: relative; z-index: 1; }
  .cta-band h2 { font-size: clamp(32px, 4.2vw, 50px); line-height: 1.06; letter-spacing: -0.024em; font-weight: 700; margin: 0 0 14px; }
  .cta-band > .wrap > p, .cta-in p { font-size: 18px; color: var(--color-muted-foreground); margin: 0 0 28px; }
  .cta-meta { margin-top: 18px; font-size: 13px; color: var(--color-muted-foreground); }

  /* ---- Footer ----------------------------------------------------------- */
  .footer { padding: 60px 0 40px; border-top: 1px solid color-mix(in oklch, var(--color-border) 60%, transparent); }
  .footer-in { display: flex; justify-content: space-between; gap: 40px; flex-wrap: wrap; }
  .footer-brand { max-width: 320px; }
  .footer-brand p { margin: 14px 0 0; font-size: 14px; line-height: 1.55; color: var(--color-muted-foreground); }
  .footer-cols { display: flex; gap: 64px; }
  .footer-cols h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--color-muted-foreground); margin: 0 0 14px; }
  .footer-cols a { display: block; font-size: 14.5px; margin-bottom: 9px; color: var(--color-foreground); opacity: .82; }
  .footer-cols a:hover { opacity: 1; }
  .footer-legal { margin-top: 44px; font-size: 13px; color: var(--color-muted-foreground); }

  @media (max-width: 900px) {
    .grid, .feature.flip .grid { grid-template-columns: 1fr; gap: 40px; }
    .feature.flip .copy, .feature.flip .art { order: 0; }
    .cards, .pb-grid { grid-template-columns: 1fr; }
    .nav-links a:not(.btn) { display: none; }
  }
</style>
</head>
<body class="app">
  ${nav()}
  ${heroSection(editors.hero)}
  ${cardsBand()}
  ${aiFeature}
  ${richFeature}
  ${dataFeature}
  ${focusFeature}
  ${useCasesBand()}
  ${privacyBand()}
  ${closingCta()}
  ${footer()}
</body>
</html>`;
}
