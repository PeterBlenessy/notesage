/**
 * Privacy page — a prose/doc layout built from content/pages/privacy.md, in the
 * shared site chrome. Plain, specific, section-per-topic. Copy stays faithful to
 * the source atom (and to the app's actual behaviour in docs/architecture.md).
 */
import { page, closingCta, htmlDoc } from "./shell";

function di(paths: string): string {
  return `<span class="fi-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg></span>`;
}

function sec(iconPaths: string, title: string, body: string): string {
  return `<section class="doc-sec"><h2>${di(iconPaths)}${title}</h2>${body}</section>`;
}

export function privacyHtml(css: string): string {
  const hero = `<header class="subhero">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="wrap">
      <div class="eyebrow">Privacy</div>
      <h1>Your notes are yours.</h1>
      <p class="lede">Here is exactly how Notesage handles your data — in plain language, no dark patterns.</p>
    </div>
  </header>`;

  const sections = [
    sec(
      '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
      "Local-first by default",
      `<p>Every note you write is saved as a plain text file on your device. Notesage never uploads your notes to our servers — because we don't have any. Your files live in a folder you choose, on your computer, under your control.</p>
       <p>When you close Notesage, your notes are just files on your Mac. You can back them up, version-control them, or move them anywhere.</p>`,
    ),
    sec(
      '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
      "API keys stay in your system keychain",
      `<p>If you connect an AI provider with an API key (Anthropic, OpenAI, or a compatible service), that key is stored in your <strong>system keychain</strong> — the same secure storage your Mac uses for passwords. It is never written to a plain text file, never stored in a browser, and never transmitted to Notesage's servers.</p>
       <p>When you remove a connection, the key is deleted from your keychain immediately.</p>`,
    ),
    sec(
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
      "AI agents run in a restricted sandbox",
      `<p>When you use an AI agent (like Claude Code or Codex), Notesage runs it in a <strong>restricted environment</strong>:</p>
       <ul>
         <li>The agent can only read and write files inside the projects you have open in that chat session.</li>
         <li>Network access is filtered — the agent can only reach the domains it needs. Unknown domains are blocked and shown to you for approval.</li>
         <li>On macOS the sandbox is enforced at the operating-system level: the agent physically cannot reach your other files, even if it tries.</li>
       </ul>`,
    ),
    sec(
      '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
      "iCloud sync is optional",
      `<p>Notesage can sync your notes via iCloud, but it is <strong>opt-in per project</strong>. If you don't turn it on, nothing is synced. If you do, your files travel through Apple's encrypted iCloud infrastructure — the same path used by apps like Pages and Notes.</p>
       <p>The local index Notesage builds for search is excluded from iCloud sync; each device rebuilds its own index from the synced files.</p>`,
    ),
    sec(
      '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="14" width="3" height="4"/>',
      "Telemetry is opt-out — and off in stable builds",
      `<p>Stable releases collect no usage data or crash reports. Pre-release (alpha) builds turn on basic, anonymous diagnostics by default to catch problems early — and you can switch both usage and crash reporting off at any time in Settings, with a first-run notice when they're on. Whatever the build, the contents of your notes are never collected, and the app otherwise makes only the network connections you set up yourself (your AI provider, iCloud if enabled).</p>
       <p>Some third-party AI providers may collect data under their own policies — check your provider's documentation for details.</p>`,
    ),
    sec(
      '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
      "Open source",
      `<p>Notesage is open source. You can read the code, audit exactly what it does, and build it yourself. There is no hidden behaviour.</p>`,
    ),
  ].join("\n");

  const body = page("privacy", `${hero}
  <div class="wrap"><div class="doc">${sections}</div></div>
  ${closingCta()}`);

  return htmlDoc({ title: "Privacy — Notesage", appCss: css, body });
}
