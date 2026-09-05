/**
 * The shape of a TestFlight "What to Test" note, shared by the sender
 * (`asc-set-testflight-notes.mjs`) and its test.
 *
 * TestFlight shows the note as plain text: no bold, no italics, no Markdown.
 * What survives is line breaks and characters, so the structure is made of
 * those alone — a one-line tagline, short upper-case headings (NEW, FIXED,
 * TRY) and "•" bullets. Unicode "bold" letters would look the part but a
 * screen reader spells them out letter by letter and search cannot match
 * them, so they are not used.
 */

/** A phone screen of structured notes; Apple's own limit is 4000. */
export const SCREENFUL = 600;

/** A line that keeps its own line when paragraphs are unwrapped. */
export function isStructuralLine(line) {
  const t = line.trim();
  // A bullet: "•", "-", "*", "+" or "1." / "1)".
  if (/^([•\-*+]|\d+[.)])\s/.test(t)) return true;
  // A heading: a few upper-case words on their own — NEW, FIXED, TRY,
  // KNOWN ISSUES. Letters only (no sentence ends in a colon-free shout).
  return /^[A-ZÅÄÖ][A-ZÅÄÖ ]{1,23}$/.test(t);
}

/**
 * Join the soft-wrapped lines of each paragraph into one line.
 *
 * The source is wrapped at ~80 columns so it reads in a diff. App Store
 * Connect stores `whatsNew` VERBATIM, newlines included, and TestFlight then
 * wraps it again for the device — so the source wrap and the phone's wrap
 * compound, and the tester sees ragged half-lines breaking mid-sentence
 * ("...med systemets egen / sökruta. Öppna en..."). Observed on build 19.
 *
 * Blank lines are the paragraph separator and are preserved. A bullet or a
 * heading keeps its own line, and so does the line after a bullet (an
 * indented continuation of the bullet joins the bullet, not the next one).
 */
export function unwrap(md) {
  return md
    .split(/\n{2,}/)
    .map((para) =>
      para
        .split("\n")
        .reduce((acc, line) => {
          const trimmed = line.trim();
          if (!acc.length) return [trimmed];
          const prev = acc[acc.length - 1];
          if (isStructuralLine(trimmed)) return [...acc, trimmed];
          // Text under a heading starts its own line; text under a bullet
          // is that bullet's continuation.
          if (isStructuralLine(prev) && !/^([•\-*+]|\d+[.)])\s/.test(prev)) return [...acc, trimmed];
          return [...acc.slice(0, -1), `${prev} ${trimmed}`.trim()];
        }, [])
        .join("\n"),
    )
    .join("\n\n");
}

/** The note as sent: comments stripped, paragraphs unwrapped, trimmed. */
export function prepareNote(source) {
  return unwrap(source.replace(/<!--[\s\S]*?-->/g, "").trim());
}
