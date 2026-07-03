/**
 * Render a generated site page to light + dark PNGs for validation.
 * Sizes the viewport to the content height (reliable — Playwright `fullPage`
 * is flaky at rendering static content below the fold).
 *   node scripts/gen-site/preview.mjs content/site/hero.html
 */
import { chromium } from '@playwright/test';
import path from 'node:path';
const REPO = process.cwd();
const target = process.argv[2] || 'content/site/hero.html';
const url = 'file://' + path.join(REPO, target);
const base = target.replace(/\.html$/, '');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle' });
const h = await page.evaluate(() => Math.ceil(document.body.scrollHeight));
await page.setViewportSize({ width: 1200, height: h });
await page.waitForTimeout(150);
await page.screenshot({ path: `${base}-preview-light.png` });
await page.evaluate(() => document.documentElement.classList.add('dark'));
await page.waitForTimeout(150);
await page.screenshot({ path: `${base}-preview-dark.png` });
await browser.close();
console.log('[preview]', base + '-preview-{light,dark}.png');
