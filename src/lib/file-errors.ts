/**
 * Parse common filesystem error messages into user-friendly strings.
 */
export function parseFileError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("permission denied")) {
    return "Permission denied";
  }
  if (lower.includes("no such file") || lower.includes("not found")) {
    return "File not found";
  }
  if (lower.includes("no space") || lower.includes("disk full")) {
    return "Disk full";
  }
  if (lower.includes("directory not empty")) {
    return "Folder is not empty";
  }

  return message;
}
