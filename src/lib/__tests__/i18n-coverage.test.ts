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
 * RAISED ONCE, on 2026-09-10, from 376 to 1407, then DOWN to 917 as the settings panel was translated — the only legitimate reason to
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
 * RAISED AGAIN, on 2026-09-11, from 917 to 1032, for the same reason and none
 * other: three more blind spots closed, so the number now counts text that was
 * always there. Review found all three, none of them by reading the tool:
 *
 *   - A string literal inside a JSX expression CHILD —
 *     `<Button>{saving ? 'Saving…' : 'Save'}</Button>`. Rule 1 reads JsxText,
 *     and a ternary between two labels is code, not text. That idiom is how
 *     most buttons in this app say two things, and it is why a directory this
 *     file certified at HARD ZERO was still rendering English.
 *   - A 120-character cap in `looksTranslatable`, which excluded exactly the
 *     longest sentences in the app: the explanatory paragraph under a settings
 *     toggle. Thirty of those were invisible. The cap is now 400 — a rail
 *     against data URIs, not a judgement about prose.
 *   - `MODEL_NAME`, which exempted anything STARTING with a model family, so
 *     "Whisper model is downloading…" was read as a product name. It now has
 *     to look like a name: short, no function words, no sentence punctuation.
 *   - `PROSE`, which required an alphanumeric after the first word's
 *     separator, so every parenthesised qualifier — `Local (command)`,
 *     `Remote (URL)`, `Auto (720px)`, `Icon (emoji)` — read as not-prose.
 *
 * A ceiling that cannot see the thing it counts is worse than no ceiling: it
 * reports success while the work goes backwards. Move it DOWN from here.
 */
const CEILING = 1038;

/**
 * Directories that ARE finished. These get a hard zero — once an area is fully
 * translated it must not silently regress when someone adds a control there.
 *
 * Both entries are here on measurement, not on memory. `src/components/mobile`
 * and `src/components/settings` each audit at 0 against the current detector —
 * the one that reads the whole syntax tree, sees a literal inside a JSX
 * expression child, and has no length cap worth speaking of.
 *
 * `src/components/settings` has now been certified twice and been wrong once.
 * The first certification was made by a detector that could not see a text node
 * Prettier had wrapped; fixing that exposed 232 strings the promise had been
 * covering. The second was made by one that could not see
 * `{saving ? 'Saving…' : 'Save'}` or any sentence over 120 characters; fixing
 * that exposed 114 more, including every explanatory paragraph in
 * `SystemSettings`. Both times the code had not regressed — the instrument had
 * been looking the other way, and the hard zero said so with confidence.
 *
 * So: this list is a claim about the DETECTOR as much as about the directory.
 * When you add an entry, the honest question is not "is this area translated?"
 * but "what shape of user-visible text can this scanner still not see?" —
 * `scripts/__tests__/i18n-audit.test.ts` plants one file per shape precisely so
 * the answer is testable rather than asserted. #991.
 */
const COMPLETED = ['src/components/mobile', 'src/components/settings'];

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
    // Tightened from 25 and kept there: `src/components/settings` has now had
    // its hard zero broken twice by a better detector, so the ratchet is what
    // catches the next shape of text neither guard can see yet, and 25 strings
    // of slack is most of a panel.
    const findings = scan('src') as Finding[];
    expect(
      CEILING - findings.length,
      `Lower CEILING in this file to ${findings.length}.`,
    ).toBeLessThanOrEqual(10);
  });
});
