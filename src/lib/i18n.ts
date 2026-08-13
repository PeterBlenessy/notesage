/**
 * Minimal typed i18n (#653). Swedish is the first additional language;
 * English is the source of truth and the fallback.
 *
 * Deliberately NOT react-i18next: the whole surface here is flat key →
 * string lookups with occasional interpolation, and the desktop carries
 * strict bundle/startup budgets (`docs/performance-baseline.md`). This module
 * is ~2 kB, has no provider to mount, and — because `Dict` is derived from
 * the English table — a missing or misspelled key is a TYPE error rather
 * than a silent English string in a Swedish UI.
 *
 * Locale resolution: an explicit user override (persisted by the caller)
 * wins; otherwise the platform locale (`navigator.language`, which in the
 * iOS WebView follows the device's language). Region subtags are ignored —
 * `sv-FI` resolves to `sv`.
 */

export const SUPPORTED_LOCALES = ["en", "sv"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** English is the source of truth: every other table must match its shape. */
const en = {
  // Onboarding
  "onboarding.title": "Welcome to Notesage",
  "onboarding.titleStale": "Reconnect your library",
  "onboarding.intro":
    "Read and write your Notesage notes on the go. iOS needs a one-time permission to open your Notesage folder — your iCloud Notesage folder, or any folder under On My iPhone if you don't use iCloud.",
  "onboarding.introStale":
    "Your access to the Notesage folder expired. Grant it once more to keep reading.",
  "onboarding.privateTitle": "Private by design",
  "onboarding.privateBody":
    "The app only touches the folder you grant — nothing is sent anywhere, and no usage data is collected.",
  "onboarding.folderTitle": "Your Notesage folder",
  "onboarding.folderBody":
    "We open the picker at your iCloud Notesage folder — no iCloud account? Pick a folder under On My iPhone instead; any folder works.",
  "onboarding.pick": "Select your Notesage folder",
  "onboarding.pickAgain": "Select your folder again",
  "onboarding.opening": "Opening…",
  "onboarding.noFolder": "No folder selected — tap again to choose your Notesage folder.",
  // Library browser
  "library.inbox": "Inbox",
  "library.searchFolder": "Search this folder",
  "library.items": "{count} items",
  "library.itemsOne": "1 item",
  "library.empty": "Nothing here yet",
  "library.emptyHint": "This folder is empty.",
  "library.noMatches": 'Nothing matches "{query}"',
  "library.openFailed": "Couldn't open this folder",
  "library.tryAgain": "Try again",
  "library.changeFolder": "Change library folder",
  "library.changeFolderFailed": "Couldn't change folder: {error}",
  // Chrome / menus
  "menu.list": "List",
  "menu.gallery": "Gallery",
  "menu.sortName": "Alphabetical",
  "menu.sortModified": "Date modified",
  "menu.groupNone": "No grouping",
  "menu.groupPinned": "Group by pinned",
  "menu.groupRecent": "Group by recent",
  "menu.groupDate": "Group by date",
  "menu.groupType": "Group by type",
  "menu.newFolder": "New Folder",
  // Sections
  "section.folders": "Folders",
  "section.pinned": "Pinned",
  "section.recent": "Recent",
  "section.allNotes": "All Notes",
  "section.today": "Today",
  "section.yesterday": "Yesterday",
  "section.previous7Days": "Previous 7 Days",
  "section.older": "Older",
  "section.notes": "Notes",
  "section.textAndCode": "Text & Code",
  "section.pdfs": "PDFs",
  "section.images": "Images",
  "section.audioAndVideo": "Audio & Video",
  "section.documents": "Documents",
  "section.webPages": "Web Pages",
  "section.other": "Other",
  // Row actions
  "action.share": "Share",
  "action.delete": "Delete",
  "action.newNote": "New note",
  "action.newFolderShort": "New folder",
  "action.create": "Create",
  "action.name": "Name",
  "action.rename": "Rename",
  "action.renameTitle": "Rename",
  "action.pin": "Pin",
  "action.unpin": "Unpin",
  "action.confirmDeleteFile": "Delete \u201c{name}\u201d?",
  "action.confirmDeleteFolder": "Delete \u201c{name}\u201d and everything in it?",
  "action.shareFailed": "Couldn't share: {error}",
  "action.renameFailed": "Couldn't rename: {error}",
  "action.pinFailed": "Couldn't update pins: {error}",
  "action.deleteFailed": "Couldn't delete: {error}",
  "action.createNoteFailed": "Couldn't create note: {error}",
  "action.createFolderFailed": "Couldn't create folder: {error}",
  // Reader
  "reader.loading": "Loading…",
  "reader.downloading": "Downloading from iCloud",
  "reader.downloadingHint": "This note isn't on your device yet. It'll be ready in a moment.",
  "reader.retry": "Retry",
  "reader.openFailed": "Couldn't open this file",
  "reader.unsupported": "Can't preview this format yet",
  "reader.tooLarge": "Too large to open",
  "reader.editor": "Note editor",
  "reader.save": "Save",
  "reader.edit": "Edit",
  "reader.back": "Back",
  "reader.find": "Find in document",
  "reader.saveFailed": "Couldn't save: {error}",
} as const;

export type MessageKey = keyof typeof en;
type Dict = Record<MessageKey, string>;

const sv: Dict = {
  "onboarding.title": "Välkommen till Notesage",
  "onboarding.titleStale": "Återanslut ditt bibliotek",
  "onboarding.intro":
    "Läs och skriv dina Notesage-anteckningar var du än är. iOS kräver en engångsbehörighet för att öppna din Notesage-mapp — din Notesage-mapp i iCloud, eller vilken mapp som helst under På min iPhone om du inte använder iCloud.",
  "onboarding.introStale":
    "Din åtkomst till Notesage-mappen har upphört. Ge behörighet en gång till för att fortsätta läsa.",
  "onboarding.privateTitle": "Privat i grunden",
  "onboarding.privateBody":
    "Appen rör bara mappen du ger åtkomst till — ingenting skickas någonstans och ingen användningsdata samlas in.",
  "onboarding.folderTitle": "Din Notesage-mapp",
  "onboarding.folderBody":
    "Vi öppnar väljaren i din Notesage-mapp i iCloud — inget iCloud-konto? Välj en mapp under På min iPhone i stället; vilken mapp som helst fungerar.",
  "onboarding.pick": "Välj din Notesage-mapp",
  "onboarding.pickAgain": "Välj din mapp igen",
  "onboarding.opening": "Öppnar…",
  "onboarding.noFolder": "Ingen mapp vald — tryck igen för att välja din Notesage-mapp.",
  "library.inbox": "Inkorg",
  "library.searchFolder": "Sök i den här mappen",
  "library.items": "{count} objekt",
  "library.itemsOne": "1 objekt",
  "library.empty": "Inget här ännu",
  "library.emptyHint": "Mappen är tom.",
  "library.noMatches": 'Inget matchar "{query}"',
  "library.openFailed": "Kunde inte öppna mappen",
  "library.tryAgain": "Försök igen",
  "library.changeFolder": "Byt biblioteksmapp",
  "library.changeFolderFailed": "Kunde inte byta mapp: {error}",
  "menu.list": "Lista",
  "menu.gallery": "Galleri",
  "menu.sortName": "Alfabetiskt",
  "menu.sortModified": "Ändringsdatum",
  "menu.groupNone": "Ingen gruppering",
  "menu.groupPinned": "Gruppera efter fastnålade",
  "menu.groupRecent": "Gruppera efter senaste",
  "menu.groupDate": "Gruppera efter datum",
  "menu.groupType": "Gruppera efter typ",
  "menu.newFolder": "Ny mapp",
  "section.folders": "Mappar",
  "section.pinned": "Fastnålade",
  "section.recent": "Senaste",
  "section.allNotes": "Alla anteckningar",
  "section.today": "I dag",
  "section.yesterday": "I går",
  "section.previous7Days": "Senaste 7 dagarna",
  "section.older": "Äldre",
  "section.notes": "Anteckningar",
  "section.textAndCode": "Text och kod",
  "section.pdfs": "PDF-filer",
  "section.images": "Bilder",
  "section.audioAndVideo": "Ljud och video",
  "section.documents": "Dokument",
  "section.webPages": "Webbsidor",
  "section.other": "Övrigt",
  "action.share": "Dela",
  "action.delete": "Radera",
  "action.newNote": "Ny anteckning",
  "action.newFolderShort": "Ny mapp",
  "action.create": "Skapa",
  "action.name": "Namn",
  "action.rename": "Byt namn",
  "action.renameTitle": "Byt namn",
  "action.pin": "Fäst",
  "action.unpin": "Lossa",
  "action.confirmDeleteFile": "Radera \u201d{name}\u201d?",
  "action.confirmDeleteFolder": "Radera \u201d{name}\u201d och allt i mappen?",
  "action.shareFailed": "Kunde inte dela: {error}",
  "action.renameFailed": "Kunde inte byta namn: {error}",
  "action.pinFailed": "Kunde inte uppdatera fästa objekt: {error}",
  "action.deleteFailed": "Kunde inte radera: {error}",
  "action.createNoteFailed": "Kunde inte skapa anteckning: {error}",
  "action.createFolderFailed": "Kunde inte skapa mapp: {error}",
  "reader.loading": "Läser in…",
  "reader.downloading": "Hämtar från iCloud",
  "reader.downloadingHint": "Anteckningen finns inte på enheten ännu. Den är strax klar.",
  "reader.retry": "Försök igen",
  "reader.openFailed": "Kunde inte öppna filen",
  "reader.unsupported": "Kan inte förhandsvisa det här formatet ännu",
  "reader.tooLarge": "För stor för att öppnas",
  "reader.editor": "Anteckningsredigerare",
  "reader.save": "Spara",
  "reader.edit": "Redigera",
  "reader.back": "Tillbaka",
  "reader.find": "Sök i dokumentet",
  "reader.saveFailed": "Kunde inte spara: {error}",
};

const TABLES: Record<Locale, Dict> = { en, sv };

/** Narrow a platform locale string (`sv-FI`, `en-GB`) to a supported one. */
export function resolveLocale(raw: string | undefined | null): Locale {
  const base = (raw ?? "").toLowerCase().split("-")[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : "en";
}

/**
 * The platform's language. `navigator.language` is the obvious source but in
 * a WKWebView it can report the app bundle's language rather than the user's
 * current device language; `Intl.DateTimeFormat().resolvedOptions().locale`
 * follows the OS reliably. Take the first SUPPORTED answer from either, so a
 * Swedish device gets Swedish regardless of which one lags.
 */
export function detectPlatformLocale(): Locale {
  const candidates: Array<string | undefined> = [];
  if (typeof navigator !== "undefined") {
    candidates.push(...(navigator.languages ?? []), navigator.language);
  }
  try {
    candidates.push(new Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    /* Intl always exists in our targets; guard anyway. */
  }
  for (const candidate of candidates) {
    const base = (candidate ?? "").toLowerCase().split("-")[0];
    if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return "en";
}

let current: Locale = detectPlatformLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/** Override the locale (Settings). Pass `null` to follow the platform again. */
export function setLocale(locale: Locale | null): void {
  const next = locale ?? detectPlatformLocale();
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Translate `key`, interpolating `{name}` placeholders. Falls back to the
 * English string when a translation is missing (never to the raw key — a
 * half-translated UI beats a UI showing `library.empty`).
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = TABLES[current][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
