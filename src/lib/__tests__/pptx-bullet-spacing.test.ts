import { describe, it, expect } from "vitest";
import { formatBulletNumber } from "../../components/editor/viewers/PptxSlideRenderer";

// ---------------------------------------------------------------------------
// formatBulletNumber — 1-based index (the caller passes startAt + counter)
// ---------------------------------------------------------------------------

describe("formatBulletNumber", () => {
  describe("arabicPeriod", () => {
    it("1 → '1.'", () => expect(formatBulletNumber("arabicPeriod", 1)).toBe("1."));
    it("2 → '2.'", () => expect(formatBulletNumber("arabicPeriod", 2)).toBe("2."));
    it("10 → '10.'", () => expect(formatBulletNumber("arabicPeriod", 10)).toBe("10."));
  });

  describe("arabicParenR", () => {
    it("1 → '1)'", () => expect(formatBulletNumber("arabicParenR", 1)).toBe("1)"));
    it("2 → '2)'", () => expect(formatBulletNumber("arabicParenR", 2)).toBe("2)"));
  });

  describe("alphaLcPeriod", () => {
    it("1 → 'a.'", () => expect(formatBulletNumber("alphaLcPeriod", 1)).toBe("a."));
    it("2 → 'b.'", () => expect(formatBulletNumber("alphaLcPeriod", 2)).toBe("b."));
    it("26 → 'z.'", () => expect(formatBulletNumber("alphaLcPeriod", 26)).toBe("z."));
    it("27 → 'aa.'", () => expect(formatBulletNumber("alphaLcPeriod", 27)).toBe("aa."));
  });

  describe("alphaUcPeriod", () => {
    it("1 → 'A.'", () => expect(formatBulletNumber("alphaUcPeriod", 1)).toBe("A."));
    it("2 → 'B.'", () => expect(formatBulletNumber("alphaUcPeriod", 2)).toBe("B."));
    it("26 → 'Z.'", () => expect(formatBulletNumber("alphaUcPeriod", 26)).toBe("Z."));
  });

  describe("alphaLcParenR", () => {
    it("1 → 'a)'", () => expect(formatBulletNumber("alphaLcParenR", 1)).toBe("a)"));
    it("2 → 'b)'", () => expect(formatBulletNumber("alphaLcParenR", 2)).toBe("b)"));
  });

  describe("alphaUcParenR", () => {
    it("1 → 'A)'", () => expect(formatBulletNumber("alphaUcParenR", 1)).toBe("A)"));
    it("2 → 'B)'", () => expect(formatBulletNumber("alphaUcParenR", 2)).toBe("B)"));
  });

  describe("romanLcPeriod", () => {
    it("1 → 'i.'", () => expect(formatBulletNumber("romanLcPeriod", 1)).toBe("i."));
    it("2 → 'ii.'", () => expect(formatBulletNumber("romanLcPeriod", 2)).toBe("ii."));
    it("3 → 'iii.'", () => expect(formatBulletNumber("romanLcPeriod", 3)).toBe("iii."));
    it("4 → 'iv.'", () => expect(formatBulletNumber("romanLcPeriod", 4)).toBe("iv."));
    it("9 → 'ix.'", () => expect(formatBulletNumber("romanLcPeriod", 9)).toBe("ix."));
    it("14 → 'xiv.'", () => expect(formatBulletNumber("romanLcPeriod", 14)).toBe("xiv."));
  });

  describe("romanUcPeriod", () => {
    it("1 → 'I.'", () => expect(formatBulletNumber("romanUcPeriod", 1)).toBe("I."));
    it("4 → 'IV.'", () => expect(formatBulletNumber("romanUcPeriod", 4)).toBe("IV."));
    it("9 → 'IX.'", () => expect(formatBulletNumber("romanUcPeriod", 9)).toBe("IX."));
    it("50 → 'L.'", () => expect(formatBulletNumber("romanUcPeriod", 50)).toBe("L."));
  });

  describe("romanLcParenR", () => {
    it("1 → 'i)'", () => expect(formatBulletNumber("romanLcParenR", 1)).toBe("i)"));
    it("5 → 'v)'", () => expect(formatBulletNumber("romanLcParenR", 5)).toBe("v)"));
  });

  describe("romanUcParenR", () => {
    it("1 → 'I)'", () => expect(formatBulletNumber("romanUcParenR", 1)).toBe("I)"));
    it("10 → 'X)'", () => expect(formatBulletNumber("romanUcParenR", 10)).toBe("X)"));
  });

  describe("unknown type", () => {
    it("falls back to arabic period style", () => {
      expect(formatBulletNumber("somethingWeird", 1)).toBe("1.");
      expect(formatBulletNumber("somethingWeird", 5)).toBe("5.");
    });

    it("empty string falls back", () => {
      expect(formatBulletNumber("", 3)).toBe("3.");
    });
  });

  describe("edge cases", () => {
    it("index 0 for arabicPeriod produces '0.'", () => {
      expect(formatBulletNumber("arabicPeriod", 0)).toBe("0.");
    });

    it("index 0 for alphaLcPeriod produces empty letter", () => {
      // toAlpha(0) returns "" since the while loop requires val > 0
      expect(formatBulletNumber("alphaLcPeriod", 0)).toBe(".");
    });

    it("index 0 for romanLcPeriod produces empty numeral", () => {
      // toRoman(0) returns "" since no roman numeral represents 0
      expect(formatBulletNumber("romanLcPeriod", 0)).toBe(".");
    });

    it("large index for roman numerals", () => {
      // 2024 in roman = MMXXIV
      expect(formatBulletNumber("romanUcPeriod", 2024)).toBe("MMXXIV.");
    });
  });
});
