#!/usr/bin/env node
/**
 * Rasterise the app icons from their SVG sources.
 *
 *   node scripts/render-app-icon.mjs            # every variant + the iOS assets
 *   npx tauri icon src-tauri/icons/icon-1024.png
 *
 * Variants
 * --------
 *   icon.svg         desktop, idle orb
 *   icon-active.svg  desktop, lit orb — for a runtime Dock swap, unwired
 *   icon-ios.svg     iOS, no orb (nothing agentic runs on the phone)
 *
 * Why a script rather than pointing `tauri icon` at the SVG
 * ---------------------------------------------------------
 * The letterform is a `<text>` element, so the render depends on Source Serif 4
 * resolving. Left to chance the shipped icon is whatever serif happened to be
 * installed on the machine that built it, and differs between a laptop and CI.
 * This inlines the bundled face as a data URI first, so output is identical
 * wherever it runs.
 *
 * And the iOS assets
 * ------------------
 * `tauri icon` writes one artwork to every platform, but iOS needs the no-orb
 * variant. So after it runs, this rewrites `AppIcon.appiconset` from
 * `icon-ios.svg`, reading the required sizes out of the set's own
 * `Contents.json` rather than hardcoding a list that would drift.
 *
 * It also rewrites `LaunchLogo.imageset`. That one had been left behind
 * entirely: the splash screen still showed a bare N on flat grey from the old
 * icon, so the app opened onto one identity and settled into another.
 *
 * Note `src-tauri/gen` is gitignored, so the iOS assets are build output, not
 * committed source. Re-run this after `tauri ios init` or the splash reverts.
 *
 * Chromium comes from Playwright, already a dev dependency for the e2e suite.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = resolve(ROOT, "src-tauri/icons");
const APPLE = resolve(ROOT, "src-tauri/gen/apple/Assets.xcassets");

const FACES = [
  { file: "SourceSerif4-It.ttf", weight: 400, style: "italic" },
  { file: "SourceSerif4-Regular.ttf", weight: 400, style: "normal" },
  { file: "SourceSerif4-Bold.ttf", weight: 700, style: "normal" },
];

function fontFaceCss() {
  return FACES.map(({ file, weight, style }) => {
    const path = resolve(ROOT, "src-tauri/fonts/source-serif", file);
    if (!existsSync(path)) throw new Error(`Missing bundled font: ${path}`);
    const b64 = readFileSync(path).toString("base64");
    return `@font-face{font-family:'Source Serif 4';font-style:${style};font-weight:${weight};src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
  }).join("\n");
}

const FONT_CSS = fontFaceCss();

function pageHtml(svg, size) {
  return `<!doctype html><meta charset="utf-8">
<style>
  ${FONT_CSS}
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block;width:${size}px;height:${size}px}
</style>
${svg}`;
}

const browser = await chromium.launch();

async function render(svgPath, size, outPath) {
  const svg = readFileSync(svgPath, "utf8");
  if (!svg.includes("Source Serif 4")) {
    // A rename would silently fall back to Georgia, and nobody would notice
    // until the icon had shipped looking subtly wrong.
    throw new Error(`${svgPath} no longer references 'Source Serif 4'.`);
  }
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(pageHtml(svg, size), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator("svg").screenshot({ omitBackground: true });
  writeFileSync(outPath, png);
  await page.close();
}

// ── 1. the 1024 masters ────────────────────────────────────────────────────
for (const name of ["icon", "icon-active", "icon-ios"]) {
  const src = join(ICONS, `${name}.svg`);
  if (!existsSync(src)) continue;
  const out = join(ICONS, `${name}-1024.png`);
  await render(src, 1024, out);
  console.log(`  ${name}.svg → ${name}-1024.png`);
}

// ── 2. the iOS asset catalogue ─────────────────────────────────────────────
const iosSvg = join(ICONS, "icon-ios.svg");
const appIconSet = join(APPLE, "AppIcon.appiconset");
const LAUNCH_SRC = resolve(ROOT, "src-tauri/ios/LaunchAssets/LaunchLogo.imageset");

if (existsSync(appIconSet)) {
  const manifest = JSON.parse(readFileSync(join(appIconSet, "Contents.json"), "utf8"));
  // Sizes come from the catalogue itself. A hardcoded list would drift the
  // first time Xcode or Tauri changed the required set, and the failure would
  // be a missing icon slot nobody looks at.
  const seen = new Set();
  for (const image of manifest.images) {
    if (!image.filename || seen.has(image.filename)) continue;
    seen.add(image.filename);
    const pt = parseFloat(image.size.split("x")[0]);
    const scale = parseInt(image.scale, 10) || 1;
    const px = Math.round(pt * scale);
    await render(iosSvg, px, join(appIconSet, image.filename));
  }
  console.log(`  icon-ios.svg → AppIcon.appiconset (${seen.size} files)`);
} else {
  console.log("  (no AppIcon.appiconset — run `tauri ios init` first)");
}

// The launch logo's canonical home is `src-tauri/ios/LaunchAssets/`, NOT the
// generated catalogue.
//
// `integrate-share-extension.py`'s `sync_launch_assets()` runs on every build
// and does `rmtree` + `copytree` from LaunchAssets over the generated imageset
// — it has to, because `tauri ios init` would otherwise drop the launch logo
// (#675). So anything written to `gen/` is deleted before the build reads it.
//
// That is exactly how build 13 shipped a new app icon with the OLD splash: the
// render wrote the generated copy, the sync restored the tracked original, and
// because `copytree` preserves mtimes the file still looked untouched
// afterwards. Writing the source is the only thing that survives.
if (existsSync(LAUNCH_SRC)) {
  // The logo is DRAWN at 120pt, but the launch cover grows it to 2.3x while
  // the app loads — 276pt on screen, which needs 828px on a 3x display. The
  // set used to be a 60pt base (60/120/180px), so the peak of that animation
  // magnified 180px across 276pt: about 4.6x, and it looked it (Peter,
  // device, build 50: "the zoomed logo animation looks blurry").
  //
  // A transform does not re-render the artwork, it samples whatever pixels
  // the image already has, so the fix is pixels rather than layout. Base
  // 280pt covers the peak at 3x with a little headroom; every smaller size
  // is a downscale, which is the sharp direction.
  //
  // Size and POSITION on screen must not change: the storyboard's icon and
  // the plugin's launch cover are one continuous image across the launch-
  // screen → webview handoff. Both constrain the view to 120pt explicitly,
  // so a larger intrinsic size changes resolution and nothing else.
  for (const [suffix, px] of [["1x", 280], ["2x", 560], ["3x", 840]]) {
    await render(iosSvg, px, join(LAUNCH_SRC, `logo@${suffix}.png`));
  }
  console.log("  icon-ios.svg → ios/LaunchAssets/LaunchLogo.imageset (3 files, tracked source)");
} else {
  console.log(`  (no ${LAUNCH_SRC} — launch logo not updated)`);
}

await browser.close();
console.log("\nNext: npx tauri icon src-tauri/icons/icon-1024.png");
console.log("      (then re-run this script — tauri icon overwrites the iOS set)");
