/**
 * Shared site chrome for the marketing pages (landing, features, privacy, …).
 * Holds the nav, footer, closing CTA, base design-system CSS, and the HTML
 * document wrapper so every page is byte-consistent. Page-specific builders
 * (heroes, feature grids, product shots) live in each page's own module.
 *
 * Design language (ref: granola.ai, openknowledge.ai, mossnotes.app): premium
 * through restraint — warm-neutral base, one opt-in accent (Notesage's shipped
 * "orange", resolved via `class="accent-orange"` on <html>), generous space.
 */

/** Real download target — the GitHub releases page. */
export const DOWNLOAD_URL = "https://github.com/PeterBlenessy/notesage/releases/latest";
const GITHUB_URL = "https://github.com/PeterBlenessy/notesage";

export const APPLE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>`;

/** A 20px lucide-style stroked icon from raw path markup. */
export function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/** Sticky top nav. `active` highlights the current page ("features"|"privacy"). */
export function nav(active = ""): string {
  const link = (href: string, label: string, key: string) =>
    `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="nav"><div class="wrap nav-in">
    <a class="brand" href="index.html"><span class="brand-mark">N</span><span class="brand-name">Notesage</span></a>
    <div class="nav-links">
      ${link("features.html", "Features", "features")}
      ${link("getting-started.html", "Get started", "getting-started")}
      ${link("privacy.html", "Privacy", "privacy")}
      <a class="btn btn-primary btn-sm" href="${DOWNLOAD_URL}">${APPLE}<span>Download</span></a>
    </div>
  </div></nav>`;
}

/** Closing download call-to-action band. */
export function closingCta(): string {
  return `<section class="cta-band">
    <div class="cta-glow" aria-hidden="true"></div>
    <div class="wrap cta-in">
      <h2>Write with a clearer head.</h2>
      <p>Free, private, and yours. No account required.</p>
      <a class="btn btn-primary btn-lg" href="${DOWNLOAD_URL}">${APPLE}<span>Download for Mac</span></a>
      <div class="cta-meta">macOS 13+ · Apple silicon &amp; Intel · Free while in alpha</div>
    </div>
  </section>`;
}

export function footer(): string {
  return `<footer class="footer"><div class="wrap footer-in">
    <div class="footer-brand">
      <div class="brand"><span class="brand-mark">N</span><span class="brand-name">Notesage</span></div>
      <p>The writing tool that thinks with you. Private by default, on your device.</p>
    </div>
    <div class="footer-cols">
      <div><h4>Product</h4><a href="features.html">Features</a><a href="getting-started.html">Get started</a><a href="privacy.html">Privacy</a><a href="${DOWNLOAD_URL}">Download</a></div>
      <div><h4>Company</h4><a href="about.html">About</a><a href="${GITHUB_URL}">GitHub</a><a href="${GITHUB_URL}/releases">Releases</a><a href="${GITHUB_URL}/issues">Report an issue</a></div>
    </div>
  </div>
  <div class="wrap footer-legal">© Notesage · Your notes, on your device. · MIT-licensed &amp; open source.</div>
  </footer>`;
}

/** Wrap page `body` in the full HTML document with the shared base CSS. */
export function htmlDoc(opts: { title: string; appCss: string; body: string; extraCss?: string }): string {
  return `<!DOCTYPE html>
<html lang="en" class="accent-orange">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<style>${opts.appCss}</style>
<style>${BASE_CSS}</style>${opts.extraCss ? `\n<style>${opts.extraCss}</style>` : ""}
</head>
<body class="app">
${opts.body}
</body>
</html>`;
}

/** The shared design-system stylesheet (everything except the compiled app CSS). */
export const BASE_CSS = `
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
  .nav-links a:not(.btn):hover, .nav-links a[aria-current="page"] { color: var(--color-foreground); }

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

  /* ---- Hero (landing) --------------------------------------------------- */
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
  .hero-shot { position: relative; z-index: 1; margin-top: 54px; display: flex; justify-content: center; }

  /* ---- Sub-page hero (compact, no product shot) ------------------------- */
  .subhero { position: relative; text-align: center; padding: 76px 0 20px; overflow: hidden; }
  .subhero .hero-bg { height: 520px; }
  .subhero h1 { font-size: clamp(36px, 5vw, 62px); line-height: 1.04; letter-spacing: -0.026em; font-weight: 700; margin: 14px 0 16px; position: relative; z-index: 1; }
  .subhero .eyebrow, .subhero .lede { position: relative; z-index: 1; }

  /* ---- Product shot framing (shared) ------------------------------------ */
  .shot { position: relative; display: flex; justify-content: center; }
  .shot::before { content: ""; position: absolute; z-index: 0; left: 50%; top: 46%; transform: translate(-50%, -50%);
    width: 92%; height: 78%; border-radius: 40%;
    background: radial-gradient(closest-side, var(--accent-soft), transparent 72%); filter: blur(26px); }
  .device { position: relative; z-index: 1; overflow: hidden; }
  .device-inner { transform-origin: top left; position: absolute; top: 0; left: 0; width: 1200px; height: 760px; }
  .app-window { width: 100%; height: 100%; border-radius: 14px; overflow: hidden;
    background: var(--color-background); border: 1px solid var(--color-border);
    box-shadow: 0 2px 6px rgba(0,0,0,.06), 0 40px 90px -30px rgba(0,0,0,.35); }
  .app-window .ProseMirror { padding: 0 !important; }
  .dark .app-window { border-color: color-mix(in oklch, var(--color-border) 80%, transparent);
    box-shadow: 0 2px 6px rgba(0,0,0,.4), 0 50px 110px -30px rgba(0,0,0,.7); }

  /* Content close-up — full-size rendered blocks in a floating card. */
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

  /* ---- Feature sections (landing) --------------------------------------- */
  .feature { position: relative; padding: 84px 0; }
  .grid { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(0, 640px); gap: 56px; align-items: center; }
  .feature.flip .grid { grid-template-columns: minmax(0, 640px) minmax(300px, 1fr); }
  .feature.flip .copy { order: 2; }
  .feature.flip .art { order: 1; }
  .feature h2 { font-size: clamp(30px, 3.6vw, 44px); line-height: 1.08; letter-spacing: -0.022em; font-weight: 700; margin: 0 0 18px; }
  .feature .copy p { font-size: clamp(15px, 1.55vw, 18px); line-height: 1.62; color: var(--color-muted-foreground); margin: 0; }
  .feature .art { display: flex; justify-content: center; min-width: 0; }

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

  /* ---- Use-case band ---------------------------------------------------- */
  .usecases { padding: 88px 0; }
  .uc-head { text-align: center; margin-bottom: 48px; }
  .uc-head h2 { font-size: clamp(30px, 3.6vw, 44px); line-height: 1.08; letter-spacing: -0.022em; font-weight: 700; margin: 8px 0 0; }
  .uc-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 26px; max-width: 1000px; margin: 0 auto; }
  .uc-item h3 { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; }
  .uc-item p { font-size: 14px; line-height: 1.5; color: var(--color-muted-foreground); margin: 0; }

  /* ---- Privacy band (landing icon trio) --------------------------------- */
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

  /* ---- Features page: category + item grid ------------------------------ */
  .feat-cat { padding: 46px 0; }
  .feat-cat + .feat-cat { border-top: 1px solid color-mix(in oklch, var(--color-border) 55%, transparent); }
  .feat-cat-head { margin-bottom: 28px; max-width: 720px; }
  .feat-cat-head h2 { font-size: clamp(22px, 2.6vw, 30px); letter-spacing: -0.02em; font-weight: 700; margin: 0; }
  .feat-cat-head p { margin: 8px 0 0; color: var(--color-muted-foreground); font-size: 15.5px; line-height: 1.55; }
  .feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px 28px; }
  .feat-item { display: flex; gap: 13px; }
  .feat-item .fi-ic { flex: none; color: var(--color-accent-primary); margin-top: 1px; }
  .feat-item h3 { font-size: 15.5px; font-weight: 600; letter-spacing: -0.006em; margin: 0 0 5px; }
  .feat-item p { font-size: 14px; line-height: 1.5; color: var(--color-muted-foreground); margin: 0; }

  /* ---- Doc / prose page (privacy) --------------------------------------- */
  .doc { max-width: 720px; margin: 0 auto; padding: 8px 0 32px; }
  .doc-sec { padding: 32px 0; border-top: 1px solid color-mix(in oklch, var(--color-border) 55%, transparent); }
  .doc-sec:first-child { border-top: 0; padding-top: 8px; }
  .doc-sec h2 { font-size: 21px; letter-spacing: -0.015em; font-weight: 700; margin: 0 0 12px; display: flex; align-items: center; gap: 11px; }
  .doc-sec h2 .fi-ic { color: var(--color-accent-primary); flex: none; }
  .doc-sec p { font-size: 15.5px; line-height: 1.62; color: var(--color-muted-foreground); margin: 0 0 12px; }
  .doc-sec p:last-child { margin-bottom: 0; }
  /* Restore list markers — the compiled app CSS (Tailwind preflight) resets them. */
  .doc-sec ul { margin: 0; padding-left: 22px; list-style: disc; color: var(--color-muted-foreground); font-size: 15px; line-height: 1.6; }
  .doc-sec li { margin: 5px 0; padding-left: 4px; }
  .doc-sec li::marker { color: var(--color-accent-primary); }
  .doc-sec strong { color: var(--color-foreground); font-weight: 600; }

  /* ---- Shared centered section head ------------------------------------ */
  .sec-head { text-align: center; max-width: 640px; margin: 0 auto 38px; }
  .sec-head h2 { font-size: clamp(24px, 2.8vw, 34px); letter-spacing: -0.02em; font-weight: 700; margin: 0 0 8px; }
  .sec-head p { margin: 0; color: var(--color-muted-foreground); font-size: 15.5px; }

  /* ---- Getting-started steps -------------------------------------------- */
  .steps { max-width: 760px; margin: 0 auto; }
  .step { display: flex; gap: 20px; padding: 28px 0; border-top: 1px solid color-mix(in oklch, var(--color-border) 55%, transparent); }
  .step:first-child { border-top: 0; padding-top: 8px; }
  .step-num { flex: none; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-weight: 650; font-size: 16px; background: var(--accent-soft); color: var(--color-accent-primary); }
  .step-body h2 { font-size: 20px; letter-spacing: -0.015em; font-weight: 700; margin: 5px 0 8px; }
  .step-body p { font-size: 15.5px; line-height: 1.6; color: var(--color-muted-foreground); margin: 0 0 8px; }
  .step-body ol { list-style: decimal; }
  .step-body ul { list-style: disc; }
  .step-body ol, .step-body ul { margin: 0; padding-left: 20px; color: var(--color-muted-foreground); font-size: 15px; line-height: 1.6; }
  .step-body li { margin: 5px 0; padding-left: 3px; }
  .step-body li::marker { color: color-mix(in oklch, var(--color-accent-primary) 70%, var(--color-muted-foreground)); }
  .step-body strong { color: var(--color-foreground); font-weight: 600; }
  .step-tip { margin-top: 12px; padding: 11px 15px; border-radius: 10px; background: var(--accent-soft);
    font-size: 14px; line-height: 1.5; color: var(--color-foreground); }

  /* keyboard chips + shortcut table */
  kbd { display: inline-block; font: 600 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 2px 7px; border-radius: 6px;
    background: var(--color-muted); border: 1px solid var(--color-border-strong); color: var(--color-foreground);
    box-shadow: 0 1px 0 color-mix(in oklch, var(--color-border-strong) 55%, transparent); }
  .sc-wrap { max-width: 620px; margin: 0 auto; }
  .sc-table { width: 100%; border-collapse: collapse; }
  .sc-table td { padding: 12px 4px; border-top: 1px solid color-mix(in oklch, var(--color-border) 55%, transparent);
    font-size: 15px; color: var(--color-muted-foreground); vertical-align: middle; }
  .sc-table tr:first-child td { border-top: 0; }
  .sc-table td:first-child { width: 118px; white-space: nowrap; }

  /* tips grid + about links (shared card look) */
  .tips, .about-links { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; max-width: 760px; margin: 0 auto; }
  .about-links { max-width: 640px; }
  .tip-card, .about-link { display: flex; gap: 13px; align-items: flex-start; padding: 16px 18px; border-radius: 12px;
    border: 1px solid var(--color-border); background: var(--color-card); transition: border-color .15s ease; }
  .about-link:hover { border-color: var(--color-border-strong); }
  .tip-card .fi-ic, .about-link .fi-ic { flex: none; color: var(--color-accent-primary); margin-top: 1px; }
  .tip-card p { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--color-muted-foreground); }
  .about-link h3 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.005em; }
  .about-link p { margin: 2px 0 0; font-size: 13px; color: var(--color-muted-foreground); }
  .tip-card strong, .tip-card kbd { color: var(--color-foreground); }

  /* ---- Closing CTA ------------------------------------------------------ */
  .cta-band { position: relative; overflow: hidden; text-align: center; padding: 110px 0; margin-top: 40px;
    background: color-mix(in oklch, var(--color-accent-primary) 7%, var(--page-bg)); border-top: 1px solid color-mix(in oklch, var(--color-border) 60%, transparent); }
  .cta-glow { position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(50% 120% at 50% 0%, var(--accent-soft), transparent 60%); }
  .cta-in { position: relative; z-index: 1; }
  .cta-band h2 { font-size: clamp(32px, 4.2vw, 50px); line-height: 1.06; letter-spacing: -0.024em; font-weight: 700; margin: 0 0 14px; }
  .cta-in p { font-size: 18px; color: var(--color-muted-foreground); margin: 0 0 28px; }
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
    .cards, .pb-grid, .uc-grid, .feat-grid, .tips, .about-links { grid-template-columns: 1fr; }
    .nav-links a:not(.btn) { display: none; }
  }
`;
