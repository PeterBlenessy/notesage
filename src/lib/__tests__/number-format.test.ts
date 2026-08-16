import { describe, it, expect } from "vitest";
import {
  parseNumericValue,
  formatValue,
  formatDateValue,
} from "../number-format";

describe("parseNumericValue", () => {
  describe("plain numbers", () => {
    it("parses integers", () => {
      expect(parseNumericValue("42")).toBe(42);
    });

    it("parses decimals", () => {
      expect(parseNumericValue("3.14")).toBe(3.14);
    });

    it("parses zero", () => {
      expect(parseNumericValue("0")).toBe(0);
    });

    it("parses negative numbers", () => {
      expect(parseNumericValue("-42")).toBe(-42);
    });

    it("strips leading/trailing whitespace", () => {
      expect(parseNumericValue("  42  ")).toBe(42);
    });
  });

  describe("with commas (thousands separators)", () => {
    it("strips commas from large numbers", () => {
      expect(parseNumericValue("42,000")).toBe(42000);
    });

    it("handles multiple comma groups", () => {
      expect(parseNumericValue("1,234,567.89")).toBe(1234567.89);
    });
  });

  describe("with currency symbols", () => {
    it("strips dollar sign", () => {
      expect(parseNumericValue("$42,000")).toBe(42000);
    });

    it("strips euro sign", () => {
      expect(parseNumericValue("\u20AC42,000")).toBe(42000);
    });

    it("strips pound sign", () => {
      expect(parseNumericValue("\u00A342,000")).toBe(42000);
    });

    it("strips yen sign", () => {
      expect(parseNumericValue("\u00A542000")).toBe(42000);
    });

    it("strips rupee sign", () => {
      expect(parseNumericValue("\u20B942,000")).toBe(42000);
    });

    it("strips currency code (USD)", () => {
      expect(parseNumericValue("USD 42,000")).toBe(42000);
    });

    it("strips trailing currency code (EUR)", () => {
      expect(parseNumericValue("42 000 EUR")).toBe(42000);
    });

    it("strips SEK with kr", () => {
      expect(parseNumericValue("42 000 kr")).toBe(42000);
    });

    it("strips leading SEK", () => {
      expect(parseNumericValue("SEK 1,234")).toBe(1234);
    });
  });

  describe("with percentage", () => {
    it("strips percent sign for non-percentage column", () => {
      expect(parseNumericValue("85%")).toBe(85);
    });

    it("strips percent sign and divides by 100 for percentage column", () => {
      expect(parseNumericValue("85%", "percentage")).toBeCloseTo(0.85);
    });

    it("does not divide when no percent sign present for percentage column", () => {
      expect(parseNumericValue("0.85", "percentage")).toBeCloseTo(0.85);
    });

    it("handles 100%", () => {
      expect(parseNumericValue("100%", "percentage")).toBeCloseTo(1.0);
    });

    it("handles 0%", () => {
      expect(parseNumericValue("0%", "percentage")).toBe(0);
    });
  });

  describe("negative numbers", () => {
    it("handles leading minus", () => {
      expect(parseNumericValue("-1234")).toBe(-1234);
    });

    it("handles parenthesized negative", () => {
      expect(parseNumericValue("(123)")).toBe(-123);
    });

    it("handles parenthesized negative with currency", () => {
      expect(parseNumericValue("($1,234.56)")).toBeCloseTo(-1234.56);
    });
  });

  describe("non-numeric content", () => {
    it("returns NaN for empty string", () => {
      expect(parseNumericValue("")).toBeNaN();
    });

    it("returns NaN for whitespace only", () => {
      expect(parseNumericValue("   ")).toBeNaN();
    });

    it("returns NaN for pure text", () => {
      expect(parseNumericValue("hello")).toBeNaN();
    });

    it("returns NaN for mixed text and numbers", () => {
      expect(parseNumericValue("abc123def")).toBeNaN();
    });

    it("returns NaN for null-ish inputs", () => {
      expect(parseNumericValue(null as unknown as string)).toBeNaN();
      expect(parseNumericValue(undefined as unknown as string)).toBeNaN();
    });
  });
});

describe("formatValue", () => {
  describe("number formatting", () => {
    it("formats plain number with thousands separator", () => {
      expect(formatValue(42000, "number")).toBe("42,000");
    });

    it("formats decimal number", () => {
      expect(formatValue(3.14, "number")).toBe("3.14");
    });

    it("formats zero", () => {
      expect(formatValue(0, "number")).toBe("0");
    });

    it("formats negative number", () => {
      expect(formatValue(-1234, "number")).toBe("-1,234");
    });
  });

  describe("currency formatting", () => {
    it("formats USD", () => {
      const result = formatValue(42000, "currency", "USD");
      expect(result).toBe("$42,000.00");
    });

    it("formats EUR", () => {
      const result = formatValue(42000, "currency", "EUR");
      // Intl.NumberFormat for EUR in en-US produces a euro sign prefix
      expect(result).toContain("42,000.00");
      expect(result).toContain("\u20AC");
    });

    it("formats SEK", () => {
      const result = formatValue(42000, "currency", "SEK");
      expect(result).toContain("42,000.00");
    });

    it("defaults to USD when no currency specified", () => {
      const result = formatValue(42000, "currency");
      expect(result).toBe("$42,000.00");
    });

    it("defaults to USD when currency is null", () => {
      const result = formatValue(42000, "currency", null);
      expect(result).toBe("$42,000.00");
    });
  });

  describe("percentage formatting", () => {
    it("formats decimal as percentage", () => {
      expect(formatValue(0.85, "percentage")).toBe("85%");
    });

    it("formats 1.0 as 100%", () => {
      expect(formatValue(1.0, "percentage")).toBe("100%");
    });

    it("formats 0 as 0%", () => {
      expect(formatValue(0, "percentage")).toBe("0%");
    });

    it("formats small percentages", () => {
      expect(formatValue(0.033, "percentage")).toBe("3.3%");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for NaN", () => {
      expect(formatValue(NaN, "number")).toBe("");
    });

    it("passes through for text type", () => {
      expect(formatValue(42, "text")).toBe("42");
    });

    it("passes through for date type", () => {
      expect(formatValue(42, "date")).toBe("42");
    });
  });
});

describe("formatDateValue", () => {
  describe("ISO format (YYYY-MM-DD)", () => {
    it("formats ISO date", () => {
      expect(formatDateValue("2026-03-29")).toBe("Mar 29, 2026");
    });

    it("formats January date", () => {
      expect(formatDateValue("2026-01-01")).toBe("Jan 1, 2026");
    });

    it("formats December date", () => {
      expect(formatDateValue("2025-12-25")).toBe("Dec 25, 2025");
    });
  });

  describe("slash format (MM/DD/YYYY)", () => {
    it("formats slash date", () => {
      expect(formatDateValue("03/29/2026")).toBe("Mar 29, 2026");
    });

    it("formats single-digit month/day", () => {
      expect(formatDateValue("1/5/2026")).toBe("Jan 5, 2026");
    });
  });

  // A first component above 12 cannot be a month, so it must be a day. These
  // used to roll silently into another year (`new Date` accepts month 24 and
  // returns a valid Date, so the isNaN guard never fired) — `25/12/2026`
  // rendered as "Jan 12, 2028", and the table sorted on that.
  describe("day-first slash format (unambiguous)", () => {
    it("reads 25/12/2026 as Christmas, not Jan 2028", () => {
      expect(formatDateValue("25/12/2026")).toBe("Dec 25, 2026");
    });

    it("reads 31/01/2026 as the last of January", () => {
      expect(formatDateValue("31/01/2026")).toBe("Jan 31, 2026");
    });

    it("reads 13/05/2026 as the 13th, the first day-only value", () => {
      expect(formatDateValue("13/05/2026")).toBe("May 13, 2026");
    });
  });

  describe("dates that name no real day", () => {
    it("returns raw text for 31 February rather than rolling into March", () => {
      expect(formatDateValue("31/02/2026")).toBe("31/02/2026");
    });

    it("returns raw text when neither component can be a month", () => {
      expect(formatDateValue("13/13/2026")).toBe("13/13/2026");
    });

    it("returns raw text for an impossible ISO day", () => {
      expect(formatDateValue("2026-02-31")).toBe("2026-02-31");
    });
  });

  describe("genuinely ambiguous slash dates", () => {
    // Nothing in "03/04/2026" says whether the writer meant 3 April or 4
    // March; only a locale can. Until #653 supplies one, the historical
    // month-first reading stands. Pinned so the limit is a decision rather
    // than an oversight — and so changing it later is a visible choice.
    it("keeps the month-first reading when both components could be a month", () => {
      expect(formatDateValue("03/04/2026")).toBe("Mar 4, 2026");
    });
  });

  describe("invalid dates", () => {
    it("returns original text for invalid format", () => {
      expect(formatDateValue("not a date")).toBe("not a date");
    });

    it("returns original text for empty string", () => {
      expect(formatDateValue("")).toBe("");
    });

    it("returns original text for partial date", () => {
      expect(formatDateValue("2026-03")).toBe("2026-03");
    });

    it("returns original for null-ish input", () => {
      expect(formatDateValue(null as unknown as string)).toBe(null);
      expect(formatDateValue(undefined as unknown as string)).toBe(undefined);
    });
  });
});
