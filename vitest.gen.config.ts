import { defineConfig } from 'vitest/config';
import path from 'path';

// Dedicated config for the marketing-site generator (scripts/gen-site). Kept
// OUT of the default `pnpm test` run (`scripts/**` is excluded in
// vitest.config.ts) because gen.test.ts is a content generator, not a unit
// test: it reads the compiled app CSS (dist/assets — a `vite build` output that
// CI's unit-test job never produces) and writes HTML into content/site.
//
// Usage (needs a prior `vite build` for dist/assets):
//   node scripts/gen-site/render-charts.mjs   # real Recharts node-view screenshots
//   pnpm gen:site                             # docs + app-window mockups + landing
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    include: ['scripts/gen-site/**/*.test.ts'],
  },
});
