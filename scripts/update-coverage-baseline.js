/**
 * Reads coverage/coverage-summary.json and writes coverage-baseline.json
 * with relative paths. Run via: pnpm coverage:update-baseline
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const summaryPath = path.join(repoRoot, 'coverage', 'coverage-summary.json');
const baselinePath = path.join(repoRoot, 'coverage-baseline.json');

if (!fs.existsSync(summaryPath)) {
  console.error('Error: coverage/coverage-summary.json not found. Run pnpm test:coverage first.');
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const baseline = {};

for (const [key, value] of Object.entries(summary)) {
  if (key === 'total') {
    baseline.total = value;
  } else {
    const relPath = path.relative(repoRoot, key);
    baseline[relPath] = value;
  }
}

fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
console.log(`Coverage baseline updated: ${Object.keys(baseline).length} entries written to coverage-baseline.json`);
