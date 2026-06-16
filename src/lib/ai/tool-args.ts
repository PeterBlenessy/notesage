/**
 * Shared one-line-per-arg preview for tool-call permission surfaces (review #9).
 * Both the in-stream `ToolCallPermissionCard` and the inline history-row card
 * (`InlineHistoryPermission`) render the same `key: value` lines with the same
 * 80-char truncation — kept in one place so they never drift.
 *
 * Returns `null` for an empty arg map so callers can skip the `<pre>` entirely.
 */
export function formatToolArgsPreview(args: Record<string, unknown>): string | null {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  return entries
    .map(([key, val]) => {
      const strVal = typeof val === 'string' ? val : JSON.stringify(val);
      const truncated = strVal.length > 80 ? strVal.slice(0, 80) + '…' : strVal;
      return `${key}: ${truncated}`;
    })
    .join('\n');
}
