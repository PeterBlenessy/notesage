/**
 * A file size the way Finder writes it: decimal units, one decimal below 10
 * of a unit ("3.4 MB"), none above ("34 MB"). `null` when the size is unknown.
 */
export function formatBytes(bytes: number | null | undefined, locale?: string): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
  } catch {
    text = value.toFixed(digits);
  }
  return `${text} ${units[unit]}`;
}
