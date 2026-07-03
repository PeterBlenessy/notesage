/**
 * Site generator (run via vitest so the `@/` alias + ESM resolve):
 *   npx vitest run scripts/gen-site/gen.test.ts
 * Writes standalone, pixel-match marketing HTML into content/site/ using the
 * app's COMPILED stylesheet (dist/assets/index-*.css) — real tokens, real
 * editor.css, real Tailwind utilities — so the output matches the app exactly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderProseMirrorHtml } from "./render-doc";
import { appWindow } from "./frame";
import { landingHtml } from "./landing";
import { featuresHtml } from "./features";
import { privacyHtml } from "./privacy";

const REPO = process.cwd();

function compiledCss(): string {
  const dir = path.join(REPO, "dist", "assets");
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  if (!files.length) throw new Error("no compiled CSS in dist/assets — run `pnpm build` first");
  return files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
}

/** A standalone page: app compiled CSS + a centered doc column + theme toggle. */
function page(title: string, proseMirrorHtml: string, css: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
<style>
  /* Theme is driven purely by the .dark class on <html> — exactly as the app
     does it (no in-app toggle; the marketing SITE will control theme globally). */
  html, body { margin: 0; background: var(--color-background); color: var(--color-foreground); }
  .stage { min-height: 100vh; }
  .doc-col { max-width: 860px; margin: 0 auto; width: 100%; }
</style>
</head>
<body>
<div class="app stage">
  <div class="doc-col">
    <div class="ProseMirror" translate="no">${proseMirrorHtml}</div>
  </div>
</div>
</body>
</html>`;
}

// Every demo doc → a standalone pixel-match page. slug drives the output file.
const DOCS: Array<{ rel: string; slug: string; title: string }> = [
  { rel: "Essays/On Attention.md", slug: "hero", title: "On Attention" },
  { rel: "Guides/Formatting.md", slug: "formatting", title: "Formatting" },
  { rel: "Data/Quarterly review.md", slug: "quarterly-review", title: "Quarterly review" },
  { rel: "Drafts/Weekly Review.md", slug: "weekly-review", title: "Weekly Review" },
  { rel: "Essays/Notes on Craft.md", slug: "notes-on-craft", title: "Notes on Craft" },
  { rel: "Research/Attention and Devotion.md", slug: "attention-and-devotion", title: "Attention and Devotion" },
  { rel: "Prompt library.md", slug: "prompt-library", title: "Prompt library" },
];

/** Full app-window page: the Quiet Composer shell + generated editor content. */
function windowPage(title: string, appHtml: string, css: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
<style>
  html, body { margin: 0; background: oklch(93% 0 0); }
  html.dark, html.dark body { background: oklch(11% 0 0); }
  .frame-stage { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 48px; box-sizing: border-box; }
  .app-window { width: 1200px; height: 760px; border-radius: 12px; overflow: hidden;
    box-shadow: 0 30px 80px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.08);
    border: 1px solid var(--color-border); background: var(--color-background); }
  .app-window .ProseMirror { padding: 0 !important; }
</style>
</head>
<body>
<div class="app stage frame-stage">${appHtml}</div>
</body>
</html>`;
}

describe("marketing site generation", () => {
  it("renders every demo doc + the full app-window hero", () => {
    const css = compiledCss();
    const htmlBySlug: Record<string, string> = {};
    for (const { rel, slug, title } of DOCS) {
      const md = readFileSync(path.join(REPO, "content/demo", rel), "utf8");
      const html = renderProseMirrorHtml(md);
      expect(html.length).toBeGreaterThan(0);
      htmlBySlug[slug] = html;
      writeFileSync(path.join(REPO, "content/site", `${slug}.html`), page(`Notesage — ${title}`, html, css));
    }
    // App-window mockups: the editor inside the real Quiet Composer frame.
    const windows: Array<[string, string]> = [
      ["window", windowPage("Notesage", appWindow(htmlBySlug.hero, { active: "On Attention.md" }), css)],
      ["window-rich", windowPage("Notesage — data", appWindow(htmlBySlug["quarterly-review"], { active: "Quarterly review.md" }), css)],
      ["window-quiet", windowPage("Notesage — quiet composer", appWindow(htmlBySlug.hero, { sidebar: false }), css)],
      ["window-focus", windowPage("Notesage — focus", appWindow(htmlBySlug.hero, { focus: true }), css)],
      ["window-ai", windowPage("Notesage — AI", appWindow(htmlBySlug.hero, { cmdBar: "expanded" }), css)],
      ["window-ai-pinned", windowPage("Notesage — AI pinned", appWindow(htmlBySlug.hero, { cmdBar: "pinned", sidebar: false }), css)],
      ["window-settings", windowPage("Notesage — settings", appWindow(htmlBySlug.hero, { modal: "settings" }), css)],
    ];
    for (const [name, html] of windows) writeFileSync(path.join(REPO, "content/site", `${name}.html`), html);
    // Step 4 — assemble the plain-static landing page from the editor atoms.
    const index = landingHtml(css, htmlBySlug);
    expect(index).toContain("<!DOCTYPE html>");
    writeFileSync(path.join(REPO, "content/site", "index.html"), index);
    // Secondary pages (shared shell): Features + Privacy.
    const pages: Array<[string, string]> = [
      ["features.html", featuresHtml(css)],
      ["privacy.html", privacyHtml(css)],
    ];
    for (const [name, html] of pages) {
      expect(html).toContain("<!DOCTYPE html>");
      writeFileSync(path.join(REPO, "content/site", name), html);
    }
    // eslint-disable-next-line no-console
    console.log(`[gen] ${DOCS.length} docs + ${windows.length} app windows + index + ${pages.length} pages`);
  });
});
