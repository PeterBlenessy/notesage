/**
 * Render the real app chart node-views (Recharts) to PNGs — the "screenshot
 * exception" for React node-views the deterministic pipeline can't serialize.
 *
 *   node scripts/gen-site/render-charts.mjs
 *
 * Bundles `chart-entry.tsx` (the actual `ChartRenderer` + recharts + theme)
 * with esbuild, mounts it in headless Chromium against the compiled app CSS,
 * and screenshots each chart's SVG into content/site/assets/. Run BEFORE the
 * vitest generator so the landing page can embed the images.
 */
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const OUT = path.join(REPO, "content/site/assets");
mkdirSync(OUT, { recursive: true });

// 1. Bundle the standalone chart entry with the real app components.
const bundle = path.join(REPO, "content/site/_chart-bundle.js");
execFileSync(
  path.join(REPO, "node_modules/.bin/esbuild"),
  [
    "scripts/gen-site/chart-entry.tsx",
    "--bundle",
    "--format=iife",
    "--jsx=automatic",
    "--alias:@=./src",
    '--define:process.env.NODE_ENV="production"',
    "--outfile=" + bundle,
  ],
  { cwd: REPO, stdio: "inherit" },
);
const js = readFileSync(bundle, "utf8");

// 2. Compiled app CSS — provides base tokens (axis text, grid) in light mode.
const cssDir = path.join(REPO, "dist/assets");
const css = readdirSync(cssDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(path.join(cssDir, f), "utf8"))
  .join("\n");

// 3. Charts to render — data mirrors the demo docs' `chart` blocks.
const charts = [
  {
    name: "chart-revenue",
    width: 520,
    height: 300,
    data: {
      type: "bar",
      title: "Revenue by quarter",
      data: [
        { category: "Q1", value: 82 },
        { category: "Q2", value: 104 },
        { category: "Q3", value: 138 },
        { category: "Q4", value: 171 },
      ],
      config: { xLabel: "", yLabel: "", showGrid: true, showLegend: false, colorScheme: "neutral" },
    },
  },
];

const browser = await chromium.launch();
for (const c of charts) {
  const p = await browser.newPage({
    viewport: { width: c.width + 64, height: c.height + 140 },
    deviceScaleFactor: 2,
  });
  await p.setContent(
    `<!doctype html><html class="accent-orange"><head><meta charset="utf-8">
     <style>${css}</style>
     <style>html,body{margin:0;background:#fff}#chart{width:${c.width}px;padding:10px 12px}</style>
     </head><body class="app"><div id="chart"></div></body></html>`,
    { waitUntil: "load" },
  );
  await p.addScriptTag({ content: js });
  await p.evaluate(
    ([data, height]) => window.renderChart(document.getElementById("chart"), data, height),
    [c.data, c.height],
  );
  await p.waitForSelector("#chart svg", { timeout: 5000 });
  await p.waitForTimeout(1600); // let the recharts mount animation settle
  await p.locator("#chart").screenshot({ path: path.join(OUT, `${c.name}.png`) });
  await p.close();
  // eslint-disable-next-line no-console
  console.log("[chart]", c.name);
}
await browser.close();
rmSync(bundle, { force: true });
