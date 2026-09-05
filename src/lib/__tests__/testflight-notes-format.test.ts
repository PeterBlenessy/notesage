import { describe, it, expect } from "vitest";
// The sender's pure half; the script itself talks to App Store Connect.
import { isStructuralLine, prepareNote, SCREENFUL, unwrap } from "../../../scripts/testflight-notes-format.mjs";

describe("TestFlight notes: tagline, headings and bullets survive unwrapping", () => {
  it("joins soft-wrapped prose but keeps headings and bullets on their own lines", () => {
    const source = [
      "Read-aloud follows along in notes too, and the Mac's",
      "mark as unread reaches the phone.",
      "",
      "NEW",
      "• Listening highlights the paragraph and word in markdown",
      "  and text notes, not only saved pages.",
      "• A second feature.",
      "",
      "TRY",
      "• Read a note aloud.",
    ].join("\n");
    expect(unwrap(source)).toBe(
      [
        "Read-aloud follows along in notes too, and the Mac's mark as unread reaches the phone.",
        "",
        "NEW",
        "• Listening highlights the paragraph and word in markdown and text notes, not only saved pages.",
        "• A second feature.",
        "",
        "TRY",
        "• Read a note aloud.",
      ].join("\n"),
    );
  });

  it("treats a heading in either language as structural, and a sentence as not", () => {
    for (const h of ["NEW", "FIXED", "TRY", "NYTT", "FIXAT", "TESTA", "KNOWN ISSUES"]) expect(isStructuralLine(h)).toBe(true);
    expect(isStructuralLine("A sentence that happens to be short")).toBe(false);
    expect(isStructuralLine("NEW: everything")).toBe(false);
    expect(isStructuralLine("• bullet")).toBe(true);
    expect(isStructuralLine("- dash bullet")).toBe(true);
    expect(isStructuralLine("1. numbered")).toBe(true);
  });

  it("strips the HTML comment that carries the instructions and trims", () => {
    expect(prepareNote("<!-- how to write this -->\nTagline.\n\nNEW\n• One.\n")).toBe("Tagline.\n\nNEW\n• One.");
  });

  it("a screenful is bigger than the old 50-word rule, still far under Apple's 4000", () => {
    expect(SCREENFUL).toBeGreaterThan(350);
    expect(SCREENFUL).toBeLessThan(1000);
  });
});
