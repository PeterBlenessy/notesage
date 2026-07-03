/**
 * About page — a compact page from content/pages/about-copy.md: what Notesage
 * is, where to find it, and credits. Shared site chrome.
 */
import { page, closingCta, htmlDoc } from "./shell";

const GITHUB = "https://github.com/PeterBlenessy/notesage";

function fi(paths: string): string {
  return `<span class="fi-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg></span>`;
}

const LINKS: Array<[string, string, string, string]> = [
  ['<path d="M2 12h20"/><circle cx="12" cy="12" r="10"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>', "Website", "notesage.io", "https://notesage.io"],
  ['<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5a5 5 0 0 0-1.4-3.5A4.7 4.7 0 0 0 19 3s-1.2-.4-4 1.5a13 13 0 0 0-6 0C6.2 2.6 5 3 5 3a4.7 4.7 0 0 0-.6 2.5A5 5 0 0 0 3 9c0 3.5 3 5.5 6 5.5a4.8 4.8 0 0 0-1 3.5v4"/>', "GitHub", "Source & builds", GITHUB],
  ['<path d="M12 2v6"/><path d="m9 5 3-3 3 3"/><path d="M20 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6"/>', "Releases & changelog", "Every version", `${GITHUB}/releases`],
  ['<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', "Report an issue", "Bugs & requests", `${GITHUB}/issues`],
];

export function aboutHtml(css: string): string {
  const hero = `<header class="subhero">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="wrap">
      <div class="eyebrow">About</div>
      <h1>A private, local-first writing tool.</h1>
      <p class="lede">Notesage pairs a beautiful markdown editor with built-in AI collaboration. Write in rich markdown, connect any AI you already use, and keep your notes on your own device.</p>
    </div>
  </header>`;

  const links = `<section class="feat-cat"><div class="wrap">
    <div class="about-links">
      ${LINKS.map(([ic, t, d, href]) => `<a class="about-link" href="${href}">${fi(ic)}<div><span class="al-title">${t}</span><p>${d}</p></div></a>`).join("")}
    </div>
  </div></section>`;

  const credits = `<section class="feat-cat"><div class="wrap"><div class="doc"><div class="doc-sec">
    <h2>${fi('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>')}Credits</h2>
    <p>Built with a lot of open-source software — special thanks to the teams behind the editor engine, the AI integrations, and the desktop framework that make Notesage possible.</p>
    <p>Notesage is open source and licensed under the MIT License. You can read the code, audit exactly what it does, and build it yourself.</p>
  </div></div></div></section>`;

  const body = page("about", `${hero}
  ${links}
  ${credits}
  ${closingCta()}`);

  return htmlDoc({ title: "About — Notesage", appCss: css, body });
}
