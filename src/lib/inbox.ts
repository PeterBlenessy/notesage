/**
 * The share extension's landing folder.
 *
 * A literal by contract, and deliberately NOT translated. This names a real
 * directory at the library root: the Rust capture crate writes into `Inbox/`,
 * the desktop reads it there, and it is what you see in Files, in Finder and
 * in iCloud Drive.
 *
 * Localizing the label breaks that. A Swedish phone showed "Inkorg" next to a
 * folder called `Inbox`, so the name in the app matched nothing on disk and
 * searching for it found nothing — while an English device looked perfectly
 * consistent, which is how the bug survived (Peter, 2026-08-17).
 *
 * Apple hits the same problem with Documents and Downloads, and answers it the
 * same way: the on-disk name stays fixed, and only the display is localized,
 * through a dedicated mechanism. Without that mechanism, matching the disk is
 * the honest option.
 *
 * If this ever does need translating, the folder has to be renamed with it —
 * on every platform, for existing libraries — which is a migration, not a
 * string change.
 */
export const INBOX_FOLDER_NAME = "Inbox";
