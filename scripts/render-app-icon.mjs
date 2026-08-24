#!/usr/bin/env node
/**
 * Rasterise the app icon from its SVG source.
 *
 *   node scripts/render-app-icon.mjs
 *   npx tauri icon src-tauri/icons/icon-1024.png
 *
 * Why a script rather than pointing `tauri icon` at the SVG directly
 * ------------------------------------------------------------------
 * The icon's letterform is a `<text>` element, so the render depends on Source
 * Serif 4 resolving. Left to chance that means the shipped icon looks like
 * whatever serif happened to be installed on the machine that built it — and
 * differs between a developer's Mac and CI.
 *
 * This inlines the bundled face (src-tauri/fonts/source-serif) as a data URI
 * before rasterising, so the output is byte-identical wherever it runs. The
 * SVG in the repo stays clean and editable; the font only rides along at
 * render time.
 *
 * Chromium comes from Playwright, already a dev dependency for the e2e suite,
 * so this adds no new tooling.
 */
// From `@playwright/test`, which is what the repo actually depends on — the
// bare `playwright` package is not installed.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `--active` renders the lit-orb variant instead. That one is not part of the
// generated platform set — it exists for a possible runtime Dock swap, so it
// is rendered on demand rather than on every run.
const ACTIVE = process.argv.includes("--active");
const SVG = resolve(ROOT, `src-tauri/icons/icon${ACTIVE ? "-active" : ""}.svg`);
const OUT = resolve(ROOT, `src-tauri/icons/icon${ACTIVE ? "-active" : ""}-1024.png`);
const SIZE = 1024;

const FACES = [
  { file: "SourceSerif4-It.ttf", weight: 400, style: "italic" },
  { file: "SourceSerif4-Regular.ttf", weight: 400, style: "normal" },
  { file: "SourceSerif4-Bold.ttf", weight: 700, style: "normal" },
];

function fontFaceCss() {
  return FACES.map(({ file, weight, style }) => {
    const path = resolve(ROOT, "src-tauri/fonts/source-serif", file);
    if (!existsSync(path)) {
      throw new Error(`Missing bundled font: ${path}`);
    }
    const b64 = readFileSync(path).toString("base64");
    return `@font-face{font-family:'Source Serif 4';font-style:${style};font-weight:${weight};src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
  }).join("\n");
}

const svg = readFileSync(SVG, "utf8");
if (!svg.includes("Source Serif 4")) {
  // A rename would silently fall back to Georgia and nobody would notice until
  // the icon shipped looking subtly wrong.
  throw new Error("icon.svg no longer references 'Source Serif 4' — update this script's font list.");
}

const html = `<!doctype html><meta charset="utf-8">
<style>
  ${fontFaceCss()}
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block;width:${SIZE}px;height:${SIZE}px}
</style>
${svg}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: "load" });
// Fonts load from data URIs, but `load` can still fire a tick early.
await page.evaluate(() => document.fonts.ready);

const png = await page.locator("svg").screenshot({ omitBackground: true });
writeFileSync(OUT, png);
await browser.close();

console.log(`Rendered ${SIZE}×${SIZE} → ${OUT.replace(ROOT + "/", "")}`);
console.log("Next: npx tauri icon src-tauri/icons/icon-1024.png");
