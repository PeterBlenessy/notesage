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

describe("marketing site generation", () => {
  it("renders every demo doc to a pixel-match .ProseMirror page", () => {
    const css = compiledCss();
    for (const { rel, slug, title } of DOCS) {
      const md = readFileSync(path.join(REPO, "content/demo", rel), "utf8");
      const html = renderProseMirrorHtml(md);
      expect(html.length).toBeGreaterThan(0);
      writeFileSync(path.join(REPO, "content/site", `${slug}.html`), page(`Notesage — ${title}`, html, css));
      // eslint-disable-next-line no-console
      console.log(`[gen] ${slug}.html — ${html.length} chars`);
    }
  });
});
