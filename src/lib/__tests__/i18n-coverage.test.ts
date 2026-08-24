import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs script, no type declarations by design.
import { scan } from '../../../scripts/i18n-audit.mjs';

interface Finding {
  file: string;
  line: number;
  kind: string;
  text: string;
}

/**
 * A ratchet, not a gate.
 *
 * Translating the whole app is in progress (`docs/history/` records the
 * batches). A hard `toBe(0)` would fail on main for as long as that takes,
 * which trains everyone to ignore the job. A ceiling fails only when someone
 * ADDS untranslated UI text, which is the regression worth catching — and it
 * forces the number down as the work lands, because leaving the ceiling above
 * the real count is a visible lie in the diff.
 *
 * When you translate a batch: run `node scripts/i18n-audit.mjs src`, put the
 * new number here, and note it in the commit. Only ever move it down.
 */
const CEILING = 376;

/**
 * Directories that ARE finished. These get a hard zero — once an area is fully
 * translated it must not silently regress when someone adds a control there.
 */
const COMPLETED = ['src/components/settings'];

describe('i18n coverage', () => {
  it('does not grow the untranslated-string count', () => {
    const findings = scan('src') as Finding[];

    // Report the worst offenders on failure — a bare number tells the next
    // person nothing about where to look.
    if (findings.length > CEILING) {
      const byFile = new Map<string, number>();
      for (const f of findings) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
      const worst = [...byFile.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([file, n]) => `  ${n}  ${file}`)
        .join('\n');
      throw new Error(
        `Untranslated user-visible strings rose to ${findings.length} (ceiling ${CEILING}).\n` +
          `Route new UI text through t() in src/lib/i18n.ts.\n${worst}`,
      );
    }

    expect(findings.length).toBeLessThanOrEqual(CEILING);
  });

  it('keeps finished areas at zero', () => {
    for (const dir of COMPLETED) {
      const findings = scan(dir) as Finding[];
      const detail = findings
        .map((f) => `  ${f.file}:${f.line} [${f.kind}] ${f.text}`)
        .join('\n');
      expect(findings.length, `${dir} regressed:\n${detail}`).toBe(0);
    }
  });

  it('the ceiling is not left stale above the real count', () => {
    // If the count has dropped well below the ceiling, the ceiling stopped
    // doing its job — it would let a whole panel's worth of English back in
    // unnoticed. Keep it within 25 of reality.
    const findings = scan('src') as Finding[];
    expect(
      CEILING - findings.length,
      `Lower CEILING in this file to ${findings.length}.`,
    ).toBeLessThanOrEqual(25);
  });
});
