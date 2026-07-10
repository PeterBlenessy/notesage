#!/usr/bin/env bash
#
# Coverage regression check — compares current coverage against committed baseline.
# For files changed in the PR, flags any line coverage drop.
# Currently warning-only (always exits 0). After 2-week observation, change to exit 1 on regression.
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$REPO_ROOT/coverage-baseline.json"
CURRENT="$REPO_ROOT/coverage/coverage-summary.json"

# --- Preflight checks ---

if [ ! -f "$BASELINE" ]; then
  echo "::warning::No coverage baseline found at coverage-baseline.json. Run 'pnpm coverage:update-baseline' to create one."
  exit 0
fi

if [ ! -f "$CURRENT" ]; then
  echo "::warning::No coverage summary found. Run 'pnpm test:coverage' first."
  exit 0
fi

# --- Determine changed files ---

# In GitHub Actions, use the PR base ref; locally fall back to origin/main
if [ -n "${GITHUB_BASE_REF:-}" ]; then
  BASE_REF="origin/$GITHUB_BASE_REF"
else
  BASE_REF="origin/main"
fi

# Get changed .ts/.tsx files (relative to repo root)
CHANGED_FILES=$(git diff --name-only "$BASE_REF"...HEAD -- '*.ts' '*.tsx' 2>/dev/null || git diff --name-only HEAD~1 -- '*.ts' '*.tsx' 2>/dev/null || echo "")

if [ -z "$CHANGED_FILES" ]; then
  echo "No .ts/.tsx files changed — skipping coverage regression check."
  exit 0
fi

echo "Checking coverage for changed files:"
echo "$CHANGED_FILES" | sed 's/^/  /'
echo ""

# --- Compare coverage ---

REGRESSIONS=0
CHECKED=0

# Use node to parse JSON and compare (jq may not be available everywhere in CI)
node -e "
const fs = require('fs');
const path = require('path');

const baseline = JSON.parse(fs.readFileSync('$BASELINE', 'utf8'));
const current = JSON.parse(fs.readFileSync('$CURRENT', 'utf8'));
const repoRoot = '$REPO_ROOT';

// Normalize current coverage keys to relative paths
const currentNormalized = {};
for (const [key, value] of Object.entries(current)) {
  if (key === 'total') {
    currentNormalized['total'] = value;
  } else {
    const relPath = path.relative(repoRoot, key);
    currentNormalized[relPath] = value;
  }
}

const changedFiles = \`$CHANGED_FILES\`.trim().split('\n').filter(Boolean);
let regressions = 0;
let newUncovered = 0;
let checked = 0;

// Only source files that coverage actually instruments are comparable. With
// coverage.all=true, every src/**/*.{ts,tsx} (minus the config's exclude list)
// appears in the current summary \u2014 so a changed source file that is present in
// CURRENT but absent from the BASELINE is a genuinely new file that arrived
// without being added to the baseline. Flag it (previously such files were
// silently skipped, which is how untested modules escaped the gate entirely).
for (const file of changedFiles) {
  const baseEntry = baseline[file];
  const currEntry = currentNormalized[file];

  // Not instrumented at all (test file, excluded path, deleted, or non-src) \u2014
  // nothing to compare.
  if (!currEntry) continue;

  if (!baseEntry) {
    newUncovered++;
    const pct = currEntry.lines.pct;
    console.log('::warning file=' + file + '::New source file not in coverage baseline (' + pct.toFixed(2) + '% lines). Add tests, then run \`pnpm coverage:update-baseline\` to record it.');
    continue;
  }

  checked++;
  const basePct = baseEntry.lines.pct;
  const currPct = currEntry.lines.pct;
  const diff = currPct - basePct;

  if (diff < 0) {
    regressions++;
    console.log('::warning file=' + file + '::Line coverage dropped: ' + basePct.toFixed(2) + '% -> ' + currPct.toFixed(2) + '% (' + diff.toFixed(2) + '%)');
  } else if (diff > 0) {
    console.log('  \u2705 ' + file + ': ' + basePct.toFixed(2) + '% -> ' + currPct.toFixed(2) + '% (+' + diff.toFixed(2) + '%)');
  } else {
    console.log('  \u2796 ' + file + ': ' + currPct.toFixed(2) + '% (unchanged)');
  }
}

// Also check total coverage
if (baseline.total && currentNormalized.total) {
  const baseTotalPct = baseline.total.lines.pct;
  const currTotalPct = currentNormalized.total.lines.pct;
  const totalDiff = currTotalPct - baseTotalPct;
  console.log('');
  console.log('Total line coverage: ' + baseTotalPct.toFixed(2) + '% -> ' + currTotalPct.toFixed(2) + '% (' + (totalDiff >= 0 ? '+' : '') + totalDiff.toFixed(2) + '%)');
}

console.log('');
console.log('Checked ' + checked + ' file(s), found ' + regressions + ' regression(s) and ' + newUncovered + ' new file(s) missing from the baseline.');

if (regressions > 0 || newUncovered > 0) {
  console.log('');
  if (regressions > 0) {
    console.log('::warning::Coverage regression detected in ' + regressions + ' file(s). Consider adding tests for changed code.');
  }
  if (newUncovered > 0) {
    console.log('::warning::' + newUncovered + ' new source file(s) are not in the coverage baseline. Add tests and run \`pnpm coverage:update-baseline\`.');
  }
  // WARNING-ONLY: exit 0 during observation period.
  // After 2-week observation, change to: process.exit(1);
}
"

exit 0
