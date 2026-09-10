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
 *
 * RAISED ONCE, on 2026-09-10, from 376 to 1407 — the only legitimate reason to
 * raise it: the DETECTOR got better, not the app worse. Its JSX rule required
 * the `>` and the `<` on one line, so every text node Prettier had wrapped —
 * which is every element with a className of any length — was invisible. Four
 * such strings in `src/components/mobile` shipped untranslated and were found
 * by reading the UI in Swedish (#989); fixing them did not move this number,
 * because they had never been inside it.
 *
 * Three more blind spots were closed in the same pass, each found by review
 * rather than by the tool: `label={cond ? "a" : "b"}` (the rule required the
 * quote straight after `=`), object-literal `title:` (the native menus and
 * action sheets are not JSX at all), and `\blabel=` matching inside
 * `aria-label=`, which double-counted 44 findings. Netting the noise out —
 * a `>` inside a string literal used to drag the following code into a
 * finding — the honest number is 1173.
 *
 * Two further blindnesses were mine, introduced while fixing the first and
 * caught in review: the predicate that rejects code rejected APOSTROPHES and
 * trailing parens too, so every contraction ("Couldn't open this folder") and
 * every parenthetical ("Terminal output (not yet supported)") stayed
 * invisible — including inside a directory this file certifies at zero.
 *
 * Review found four more in the same rules: an object-title pattern that
 * double-counted every `aria-label`, a literal class that could not cross an
 * apostrophe, a comment-blanker that treated `/*` inside a string as a comment
 * and blanked whatever followed, and prop rules still scanning line-by-line
 * while the JSX rule scanned whole files. The scan now also covers `.ts`, not
 * only `.tsx` — the native menus this audit learned to read are plain
 * TypeScript. `scripts/__tests__/i18n-audit.test.ts` plants one of every shape
 * so the next blind spot fails a test instead of widening a promise.
 *
 * Finally the scanner was rewritten onto the TypeScript parser. Six review
 * rounds had found six tokenizer bugs in the hand-rolled version — the last
 * being an apostrophe in `won't` opening a phantom string that desynced quote
 * state to end of file, in eleven files, one of them inside a hard-zero
 * directory. Comment-versus-string, apostrophe-versus-delimiter and
 * regex-versus-division are things a parser already knows; the walk asks it
 * instead of guessing. It immediately found two sentences no regex version
 * could see — JSX text split around an interpolation, in the reader.
 *
 * Last: the rewrite had routed toasts through the prose filter, whose
 * single-word rule was anchored and so rejected `Transcribing…`, `Saved!` and
 * `Note:` — "verb + ellipsis" being the standard idiom for an in-progress
 * toast. Proper nouns (`Anthropic`, `Gemini CLI`) are now excluded instead:
 * they are not translatable in any language, and counting them forever made a
 * PR adding a provider fail a test whose only sound remedy this comment
 * forbids.
 *
 * A ceiling that cannot see the thing it counts is worse than no ceiling: it
 * reports success while the work goes backwards. Move it DOWN from here.
 */
const CEILING = 1407;

/**
 * Directories that ARE finished. These get a hard zero — once an area is fully
 * translated it must not silently regress when someone adds a control there.
 *
 * `src/components/settings` was here and has been REMOVED, which is not a
 * regression in that code: the detector that certified it could not see a text
 * node Prettier had wrapped, and with that fixed the area holds 232
 * untranslated strings across 50 files — `Tools` on a badge, `Add model` on a
 * button, whole sentences of help text. It was never at zero; it was measured
 * by something looking the other way. Tracked in #991, and it goes back in
 * this list when `node scripts/i18n-audit.mjs src/components/settings` prints
 * nothing.
 *
 * `src/components/mobile` is added on the opposite evidence: it audits at 0
 * with the fixed detector.
 */
const COMPLETED = ['src/components/mobile'];

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
    // unnoticed. Keep it within 10 of reality.
    //
    // Tightened from 25 while #991 is open: `src/components/settings` lost its
    // hard zero when the detector learned to see the 232 strings it had been
    // certified without, so the ratchet is the ONLY thing guarding that area
    // now, and 25 strings of slack is most of a panel.
    const findings = scan('src') as Finding[];
    expect(
      CEILING - findings.length,
      `Lower CEILING in this file to ${findings.length}.`,
    ).toBeLessThanOrEqual(10);
  });
});
