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
      return formatDateValue(epochToLocalIsoDate(value));

    case "text":
    default:
      return String(value);
  }
}

/**
 * Convert an epoch-millisecond timestamp to a local `YYYY-MM-DD` date string.
 *
 * Uses local date components (not UTC) so that round-tripping a value through
 * `parseDateValue` → `epochToLocalIsoDate` → `formatDateValue` always recovers
 * the same calendar date, regardless of the viewer's UTC offset.
 */
function epochToLocalIsoDate(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse common date formats into a `Date` object.
 *
 * Supported input formats:
 * - ISO: `2026-03-29`
 * - US slash: `03/29/2026` or `3/29/2026`
 *
 * @param trimmed - Already-trimmed raw date text
 * @returns Parsed `Date`, or `null` if unparseable
 */
function parseDateText(trimmed: string): Date | null {
  // Try ISO format: YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const date = new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
    );
    if (!isNaN(date.getTime())) return date;
  }

  // Try US slash format: MM/DD/YYYY
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const date = new Date(
      Number(slashMatch[3]),
      Number(slashMatch[1]) - 1,
      Number(slashMatch[2]),
    );
    if (!isNaN(date.getTime())) return date;
  }

  return null;
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
export function formatDateValue(text: string): string {
  if (!text || typeof text !== "string") return text;

  const trimmed = text.trim();
  if (trimmed === "") return text;

  const date = parseDateText(trimmed);
  if (!date) return text;

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Parse common date formats (see `formatDateValue`) into an epoch-millisecond
 * timestamp, for numeric comparison (sorting, aggregation).
 *
 * @param text - Raw date text
 * @returns Epoch milliseconds, or `NaN` if unparseable
 */
export function parseDateValue(text: string): number {
  if (!text || typeof text !== "string") return NaN;

  const trimmed = text.trim();
  if (trimmed === "") return NaN;

  const date = parseDateText(trimmed);
  return date ? date.getTime() : NaN;
}
