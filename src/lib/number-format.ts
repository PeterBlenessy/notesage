/**
 * Number formatting and parsing utilities for dynamic table enhancements.
 *
 * Handles parsing raw cell text (with currency symbols, commas, percentages)
 * into clean numbers, and formatting numbers back into locale-aware display strings.
 *
 * Assumes US/UK number format: `.` is decimal separator, `,` is thousands separator.
 */

/** Currency symbols and codes to strip when parsing numeric values */
const CURRENCY_SYMBOLS = /^[\s]*[$()\u20AC\u00A3\u00A5\u20B9]|[\s]*(kr|SEK|USD|EUR|GBP|JPY|CNY|CHF|NOK|DKK|AUD|CAD|NZD|INR)[\s]*/gi;

/** Trailing currency symbols/codes (for formats like `42 000 EUR`) */
const TRAILING_CURRENCY = /[\s]*(kr|SEK|USD|EUR|GBP|JPY|CNY|CHF|NOK|DKK|AUD|CAD|NZD|INR|[$\u20AC\u00A3\u00A5\u20B9])[\s]*$/gi;

/**
 * Parse a cell's text content into a clean numeric value.
 *
 * Strips currency symbols, commas (thousands separators), percentage signs,
 * and handles negative numbers in parentheses notation.
 *
 * @param text - Raw cell text content
 * @param colType - Optional column type hint (used for percentage handling)
 * @returns Parsed number, or NaN for non-numeric content
 */
export function parseNumericValue(text: string, colType?: string): number {
  if (!text || typeof text !== "string") return NaN;

  let cleaned = text.trim();
  if (cleaned === "") return NaN;

  // Detect parenthesized negatives: (123) or ($1,234.56)
  const isParenthesizedNegative = /^\(.*\)$/.test(cleaned);
  if (isParenthesizedNegative) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Detect and strip percentage sign
  const hasPercentSign = cleaned.includes("%");
  if (hasPercentSign) {
    cleaned = cleaned.replace(/%/g, "").trim();
  }

  // Strip currency symbols and codes (leading)
  cleaned = cleaned.replace(CURRENCY_SYMBOLS, "").trim();

  // Strip trailing currency symbols and codes
  cleaned = cleaned.replace(TRAILING_CURRENCY, "").trim();

  // Strip commas used as thousands separators
  cleaned = cleaned.replace(/,/g, "");

  // Strip whitespace used as thousands separators (e.g., `42 000`)
  cleaned = cleaned.replace(/\s/g, "");

  // Now try to parse as a number
  const num = Number(cleaned);
  if (isNaN(num)) return NaN;

  // Apply parenthesized negative
  const result = isParenthesizedNegative ? -num : num;

  // For percentage column type: if the raw text had a % sign, divide by 100
  if (colType === "percentage" && hasPercentSign) {
    return result / 100;
  }

  return result;
}

/**
 * Format a numeric value for display based on column type.
 *
 * @param value - The numeric value to format
 * @param colType - Column type: 'number', 'currency', 'percentage', 'date', or 'text'
 * @param currency - ISO 4217 currency code (e.g., 'USD', 'EUR', 'SEK'). Required when colType is 'currency'.
 * @returns Formatted display string
 */
export function formatValue(
  value: number,
  colType: string,
  currency?: string | null,
): string {
  if (isNaN(value)) return "";

  switch (colType) {
    case "number":
      return new Intl.NumberFormat("en-US").format(value);

    case "currency": {
      const currencyCode = currency || "USD";
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: currencyCode,
        }).format(value);
      } catch {
        // Fallback for unrecognized currency codes
        return new Intl.NumberFormat("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(value);
      }
    }

    case "percentage":
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value * 100)}%`;

    case "date":
    case "text":
    default:
      return String(value);
  }
}

/**
 * Try to parse common date formats and return a locale-formatted date string.
 *
 * Supported input formats:
 * - ISO: `2026-03-29`
 * - US slash: `03/29/2026` or `3/29/2026`
 *
 * @param text - Raw date text
 * @returns Formatted date string (e.g., `Mar 29, 2026`), or the original text if unparseable
 */
/**
 * Format a calendar date, or return `null` when those numbers name no real day.
 *
 * The `null` matters. `new Date(2026, 24, 12)` does not fail — it rolls the
 * excess months into the next year and hands back a perfectly valid Date, so
 * an `isNaN` guard never fires. That is how `25/12/2026` used to render as
 * "Jan 12, 2028": silently wrong, and wrong in a way the table then sorted and
 * aggregated on. Reading the fields back off the constructed Date is the only
 * way to catch it — if they don't match what went in, the input named no such
 * day (31 February, month 13) and the caller should keep the user's raw text
 * rather than show them a date they never wrote.
 */
function formatYmd(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (
    isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateValue(text: string): string {
  if (!text || typeof text !== "string") return text;

  const trimmed = text.trim();
  if (trimmed === "") return text;

  // Try ISO format: YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const formatted = formatYmd(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
    if (formatted) return formatted;
  }

  // Try slash format. Two conventions share this shape — `MM/DD/YYYY` (US) and
  // `DD/MM/YYYY` (most of Europe, Sweden included) — and nothing in the text
  // says which one was meant. Resolve only what arithmetic can settle: a first
  // component above 12 cannot be a month, so it must be the day. Genuinely
  // ambiguous input (`03/04/2026`) keeps the historical month-first reading;
  // choosing by locale is #653's job, not this function's.
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const dayFirst = first > 12;
    const formatted = formatYmd(
      Number(slashMatch[3]),
      dayFirst ? second : first,
      dayFirst ? first : second,
    );
    if (formatted) return formatted;
  }

  // Could not parse — return original text
  return text;
}
