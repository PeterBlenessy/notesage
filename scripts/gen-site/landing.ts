/**
 * Marketing landing page assembler (step 4). Plain static HTML: composes the
 * generated app-window mockups (scaled "device" frames, some forced dark via a
 * `.dark` wrapper) with copy from the content atoms (pitch.md, use-cases.md),
 * styled by the app's compiled CSS. No framework, no build step.
 */
import { appWindow, type WindowOpts } from "./frame";

/** A scaled device frame around an app-window mockup. `dark` forces the theme. */
function device(editorHtml: string, opts: WindowOpts, scale = 0.62, dark = false): string {
  const w = Math.round(1200 * scale);
  const h = Math.round(760 * scale);
  const inner = `<div class="device" style="width:${w}px;height:${h}px"><div class="device-inner" style="transform:scale(${scale})">${appWindow(editorHtml, opts)}</div></div>`;
  return dark ? `<div class="dark">${inner}</div>` : inner;
}

function heroSection(editorHtml: string): string {
  return `<header class="hero">
    <div class="wrap">
      <div class="eyebrow">Notesage</div>
      <h1>The writing tool that<br>thinks with you.</h1>
      <p class="lede">A fast, private desktop app that pairs a beautiful markdown editor with AI you control. Write your ideas, connect any model you already use, and let the two work together — without your notes ever leaving your computer.</p>
    </div>
    ${device(editorHtml, { active: "On Attention.md" }, 0.82)}
  </header>`;
}

interface FeatureOpts { title: string; body: string; mockup: string; flip?: boolean }
function feature({ title, body, mockup, flip }: FeatureOpts): string {
  return `<section class="feature ${flip ? "flip" : ""}">
    <div class="wrap grid">
      <div class="copy"><h2>${title}</h2><p>${body}</p></div>
      <div class="art">${mockup}</div>
    </div>
  </section>`;
}

export function landingHtml(css: string, editors: Record<string, string>): string {
  const aiFeature = feature({
    title: "Work with any AI, your way.",
    body: "Bring your own key, use your Claude, Copilot, or Gemini subscription, or run a model fully offline. Watch it think, call tools, and ask permission before it ever touches your files — the AI works beside your writing, never behind your back.",
    mockup: device(editors.hero, { cmdBar: "expanded" }, 0.52, true),
    flip: false,
  });
  const editorFeature = feature({
    title: "Beautiful writing, powerful thinking.",
    body: "Callouts, dynamic tables, syntax-highlighted code, tags, and clean markdown round-tripping — every note is an ordinary .md file you own. Draft in calm simplicity; deliver something that looks finished.",
    mockup: device(editors["quarterly-review"], { active: "Quarterly review.md" }, 0.52),
    flip: true,
  });
  const focusFeature = feature({
    title: "Write without distraction.",
    body: "Focus mode fades everything but your words — no tabs, no toolbars, just the page. When a thought needs a second opinion, summon the assistant with a keystroke, ask, and send it away again.",
    mockup: device(editors.hero, { focus: true }, 0.52),
    flip: false,
  });
  const privacyFeature = feature({
    title: "Your work stays yours.",
    body: "Every note is a plain file on your computer — no account, no lock-in, nothing uploaded behind your back. Tie a project to a single provider and its material never mixes with another's. However you work, your words stay on your device unless you choose to send them.",
    mockup: device(editors.hero, { sidebar: false }, 0.52, true),
    flip: true,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notesage — the writing tool that thinks with you</title>
<style>${css}</style>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; background: oklch(98.5% 0 0); color: var(--color-foreground); font-family: "SF Pro Display", -apple-system, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
  .eyebrow { font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--color-muted-foreground); }
  .hero { text-align: center; padding: 96px 0 8px; overflow: hidden; }
  .hero h1 { font-size: clamp(40px, 6.5vw, 76px); line-height: 1.03; letter-spacing: -0.02em; font-weight: 700; margin: 16px 0 20px; }
  .lede { max-width: 640px; margin: 0 auto; font-size: clamp(16px, 2vw, 20px); line-height: 1.55; color: var(--color-muted-foreground); }
  /* device frame — the app-window is native 1200x760, scaled down in place. */
  .device { margin: 56px auto 0; position: relative; overflow: hidden; }
  .device-inner { transform-origin: top left; position: absolute; top: 0; left: 0; width: 1200px; height: 760px; }
  .feature { padding: 88px 0; }
  .feature:nth-child(even) { background: oklch(96.5% 0 0); }
  .grid { display: grid; grid-template-columns: 0.85fr 1.15fr; gap: 56px; align-items: center; }
  .feature.flip .grid { grid-template-columns: 1.15fr 0.85fr; }
  .feature.flip .copy { order: 2; }
  .feature h2 { font-size: clamp(28px, 3.5vw, 40px); line-height: 1.1; letter-spacing: -0.02em; font-weight: 700; margin: 0 0 16px; }
  .feature .copy p { font-size: clamp(15px, 1.6vw, 18px); line-height: 1.6; color: var(--color-muted-foreground); margin: 0; }
  .feature .art { display: flex; justify-content: center; }
  footer { text-align: center; padding: 72px 0 96px; color: var(--color-muted-foreground); font-size: 14px; }
  @media (max-width: 860px) { .grid, .feature.flip .grid { grid-template-columns: 1fr; } .feature.flip .copy { order: 0; } }
</style>
</head>
<body class="app">
  ${heroSection(editors.hero)}
  ${aiFeature}
  ${editorFeature}
  ${focusFeature}
  ${privacyFeature}
  <footer>Notesage — private by default. Your notes, on your device.</footer>
</body>
</html>`;
}
