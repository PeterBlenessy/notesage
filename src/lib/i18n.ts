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
  "section.projects": "Projects",
  "section.tags": "Tags",
  "section.mentions": "Mentions",
  "section.pinned": "Pinned",
  "section.recent": "Recent",
  "section.allNotes": "All Notes",
  "section.recentlyChanged": "Recently changed",
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
  // Shared chrome. `common.cancel` is handed to the native iOS alerts,
  // which have no strings bundle of their own (#705).
  // Toasts raised from hooks (#706). Keys mirror the call site's intent, not
  // its wording, so a copy tweak does not orphan a translation.
  "toast.openFileFailed": "Failed to open file",
  "toast.saveFileFailed": "Failed to save file: {error}",
  "toast.reconnectedAi": "Reconnected to AI services",
  "toast.rebuildingIndex": "Rebuilding search index — tags and mentions will be available shortly",
  "toast.projectRemoved": "Project “{project}” was removed — directory no longer exists",
  "toast.authFailed": "Authentication failed for {agent}",
  "toast.projectLockedUnavailable": "Project is locked to {label}, but that connection is not available.",
  "toast.noAgentForTasks": "No agent configured for tasks. Set up agent routing in Settings.",
  "toast.agentFinishedComment": "Agent finished working on your comment. Click it to review.",
  "toast.agentWorkingComment": "An agent is working on this comment. Check the activity panel for progress.",
  "toast.agentFailed": "Agent failed: {error}",
  "toast.delegationFailed": "Agent delegation failed: {error}",
  "toast.copilotRestarting": "Copilot LSP exited ({message}) — restarting",
  "toast.imageInsertFailed": "Failed to insert image: {name}",
  "toast.docxExported": "Word document exported",
  "toast.pptxExported": "PowerPoint exported",
  "toast.pdfExported": "PDF exported",
  "toast.exportFailed": "Export failed: {error}",
  "toast.gitInitFailed": "Git initialization failed: {error}",
  // Sidebar — sections, row actions, context menu (#706)
  "sidebar.workspace": "Workspace sidebar",
  "sidebar.resize": "Resize sidebar",
  "sidebar.clearFilter": "Clear filter",
  "sidebar.settings": "Settings",
  "sidebar.externalFolders": "External folders",
  "sidebar.addFolder": "Add folder",
  "sidebar.newProject": "New project",
  "sidebar.emptyFile": "Empty file",
  "sidebar.linkedFrom": "Linked from",
  "sidebar.linksTo": "Links to",
  "sidebar.changedExternally": "Changed externally",
  "sidebar.externalChangePending": "External change pending review",
  "sidebar.quickNotes": "Quick Notes",
  "menu.open": "Open",
  "menu.rename": "Rename",
  "menu.newFile": "New File",
  "menu.newFolderItem": "New Folder",
  "menu.duplicate": "Duplicate",
  "menu.addToChat": "Add to chat",
  "menu.revealInFinder": "Reveal in Finder",
  "menu.copyPath": "Copy path",
  "menu.copyFilename": "Copy filename",
  "menu.exportAs": "Export as…",
  "menu.exportWord": "Word (.docx)",
  "menu.exportPowerPoint": "PowerPoint",
  "menu.commit": "Commit…",
  "menu.compareBranch": "Compare branch…",
  "menu.moveTo": "Move to…",
  "menu.moveToTrash": "Move to trash?",
  "menu.pin": "Pin",
  "menu.unpin": "Unpin",
  // Agent orb / activity panel (#706)
  "activity.agentActivity": "Agent activity",
  "activity.agentResponse": "Agent response",
  "activity.starting": "Starting…",
  "activity.moveToProject": "Move to project",
  "activity.noOpenProjects": "No open projects",
  "activity.rerunTranscription": "Re-run transcription",
  "activity.noModelsDownloaded": "No models downloaded",
  "activity.recordingLanguage": "Recording language",
  "activity.language": "Language",
  "activity.detectedLanguage": "Detected language",
  "activity.revealInFinder": "Reveal in Finder",
  "activity.removeFromList": "Remove from this list",
  "activity.rerunWithModel": "Re-run with model",
  "activity.rerunInLanguage": "Re-run in another language",
  // Command bar (#706)
  "cmd.placeholder": "Ask, search, or type / for skills…",
  "cmd.placeholderWorking": "Working — messages queue until it finishes…",
  "cmd.placeholderProjectSwitch": "Resolve project context change first…",
  "cmd.placeholderAgentSwitch": "Resolve provider change first…",
  "cmd.input": "Chat and command input",
  "cmd.panel": "Chat panel",
  "cmd.stream": "Chat stream",
  "cmd.results": "Command palette results",
  "cmd.history": "Conversation history",
  "cmd.verbs": "Command bar verbs",
  "cmd.attachImage": "Attach image",
  "cmd.awaitingPermission": "Awaiting permission",
  "cmd.cancelEditing": "Cancel editing",
  "cmd.editingMessage": "Editing message",
  "cmd.back": "Back",
  "cmd.allProjects": "All projects",
  "cmd.allTypes": "All types",
  "cmd.crossProjectScope": "Cross-project scope",
  // Chat (#706)
  "chat.deleteConversation": "Delete conversation",
  "chat.deleteBranch": "Delete branch",
  "chat.exportConversation": "Export conversation",
  "chat.messageActions": "Message actions",
  "chat.startConversation": "Start a conversation",
  "chat.getStarted": "Get started with AI",
  "chat.retry": "Retry",
  "chat.gotIt": "Got it",
  "chat.interrupted": "Interrupted",
  "chat.reconnected": "Reconnected",
  "chat.connectionInterrupted": "Connection interrupted",
  "chat.agentExited": "Agent process exited unexpectedly",
  "chat.permissionDenied": "Permission denied",
  "chat.estimatedLocally": "Estimated locally",
  "chat.lastTurn": "Last turn",
  "chat.rateLimit": "Rate limit",
  "chat.plan": "Plan",
  // Toasts raised from hooks (#706)
  "activity.stopRecording": "Stop recording",
  "activity.paused": "Paused",
  "activity.recording": "Recording…",
  "activity.transcribing": "Transcribing…",
  "activity.transcriptReady": "Transcript ready",
  "activity.transcriptReadyOpen": "Transcript ready — click to open",
  "activity.transcriptionFailed": "Transcription failed — re-runnable from the inbox",
  // Git — status indicators, commit dialog, branch compare (#706)
  "git.repository": "Git repository",
  "git.repositoryOn": "Git repository — on {branch}",
  "git.compareBranch": "Compare against branch…",
  "git.loadingBranches": "Loading branches",
  "git.noOtherBranches": "No other branches",
  "git.commitChanges": "Commit Changes",
  "git.noChanges": "No changes to commit",
  "git.selectAll": "Select all",
  "git.deselectAll": "Deselect all",
  "git.commitMessage": "Commit message (required)",
  "git.extendedDescription": "Extended description (optional)",
  "git.identityMissing": "Git identity not configured",
  "git.yourName": "Your Name",
  "git.saveAndRetry": "Save & Retry",
  "git.modified": "Modified",
  "git.added": "Added — new file staged for commit",
  "git.untracked": "Untracked — not yet tracked by git",
  "git.deleted": "Deleted",
  "git.renamed": "Renamed",
  "git.conflicted": "Conflicted — merge conflict",
  "common.cancel": "Cancel",
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
  "section.projects": "Projekt",
  "section.tags": "Taggar",
  "section.mentions": "Omnämnanden",
  "section.pinned": "Fastnålade",
  "section.recent": "Senaste",
  "section.allNotes": "Alla anteckningar",
  "section.recentlyChanged": "Nyligen ändrade",
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
  "sidebar.workspace": "Sidofält för arbetsytan",
  "sidebar.resize": "Ändra sidofältets bredd",
  "sidebar.clearFilter": "Rensa filtret",
  "sidebar.settings": "Inställningar",
  "sidebar.externalFolders": "Externa mappar",
  "sidebar.addFolder": "Lägg till mapp",
  "sidebar.newProject": "Nytt projekt",
  "sidebar.emptyFile": "Tom fil",
  "sidebar.linkedFrom": "Länkad från",
  "sidebar.linksTo": "Länkar till",
  "sidebar.changedExternally": "Ändrad utanför appen",
  "sidebar.externalChangePending": "Extern ändring väntar på granskning",
  "sidebar.quickNotes": "Snabbanteckningar",
  "menu.open": "Öppna",
  "menu.rename": "Byt namn",
  "menu.newFile": "Ny fil",
  "menu.newFolderItem": "Ny mapp",
  "menu.duplicate": "Duplicera",
  "menu.addToChat": "Lägg till i chatten",
  "menu.revealInFinder": "Visa i Finder",
  "menu.copyPath": "Kopiera sökväg",
  "menu.copyFilename": "Kopiera filnamn",
  "menu.exportAs": "Exportera som…",
  "menu.exportWord": "Word (.docx)",
  "menu.exportPowerPoint": "PowerPoint",
  "menu.commit": "Checka in…",
  "menu.compareBranch": "Jämför gren…",
  "menu.moveTo": "Flytta till…",
  "menu.moveToTrash": "Flytta till papperskorgen?",
  "menu.pin": "Fäst",
  "menu.unpin": "Lossa",
  "activity.agentActivity": "Agentaktivitet",
  "activity.agentResponse": "Agentens svar",
  "activity.starting": "Startar…",
  "activity.moveToProject": "Flytta till projekt",
  "activity.noOpenProjects": "Inga öppna projekt",
  "activity.rerunTranscription": "Kör transkriberingen igen",
  "activity.noModelsDownloaded": "Inga modeller nedladdade",
  "activity.recordingLanguage": "Inspelningens språk",
  "activity.language": "Språk",
  "activity.detectedLanguage": "Identifierat språk",
  "activity.revealInFinder": "Visa i Finder",
  "activity.removeFromList": "Ta bort från listan",
  "activity.rerunWithModel": "Kör igen med modell",
  "activity.rerunInLanguage": "Kör igen på ett annat språk",
  "cmd.placeholder": "Fråga, sök eller skriv / för färdigheter…",
  "cmd.placeholderWorking": "Arbetar — meddelanden köas tills det är klart…",
  "cmd.placeholderProjectSwitch": "Lös projektbytet först…",
  "cmd.placeholderAgentSwitch": "Lös leverantörsbytet först…",
  "cmd.input": "Chatt- och kommandofält",
  "cmd.panel": "Chattpanel",
  "cmd.stream": "Chattflöde",
  "cmd.results": "Resultat i kommandopaletten",
  "cmd.history": "Konversationshistorik",
  "cmd.verbs": "Kommandofältets verb",
  "cmd.attachImage": "Bifoga bild",
  "cmd.awaitingPermission": "Väntar på godkännande",
  "cmd.cancelEditing": "Avbryt redigering",
  "cmd.editingMessage": "Redigerar meddelande",
  "cmd.back": "Tillbaka",
  "cmd.allProjects": "Alla projekt",
  "cmd.allTypes": "Alla typer",
  "cmd.crossProjectScope": "Omfattar flera projekt",
  "chat.deleteConversation": "Ta bort konversation",
  "chat.deleteBranch": "Ta bort gren",
  "chat.exportConversation": "Exportera konversation",
  "chat.messageActions": "Meddelandeåtgärder",
  "chat.startConversation": "Starta en konversation",
  "chat.getStarted": "Kom igång med AI",
  "chat.retry": "Försök igen",
  "chat.gotIt": "Uppfattat",
  "chat.interrupted": "Avbruten",
  "chat.reconnected": "Återansluten",
  "chat.connectionInterrupted": "Anslutningen avbröts",
  "chat.agentExited": "Agentprocessen avslutades oväntat",
  "chat.permissionDenied": "Åtkomst nekad",
  "chat.estimatedLocally": "Uppskattat lokalt",
  "chat.lastTurn": "Senaste svarsomgången",
  "chat.rateLimit": "Hastighetsgräns",
  "chat.plan": "Plan",
  "toast.openFileFailed": "Kunde inte öppna filen",
  "toast.saveFileFailed": "Kunde inte spara filen: {error}",
  "toast.reconnectedAi": "Återansluten till AI-tjänsterna",
  "toast.rebuildingIndex": "Bygger om sökindexet — taggar och omnämnanden blir tillgängliga strax",
  "toast.projectRemoved": "Projektet ”{project}” togs bort — katalogen finns inte längre",
  "toast.authFailed": "Inloggningen misslyckades för {agent}",
  "toast.projectLockedUnavailable": "Projektet är låst till {label}, men den anslutningen är inte tillgänglig.",
  "toast.noAgentForTasks": "Ingen agent är inställd för uppgifter. Ställ in agentrouting i Inställningar.",
  "toast.agentFinishedComment": "Agenten är klar med din kommentar. Klicka för att granska.",
  "toast.agentWorkingComment": "En agent arbetar med den här kommentaren. Följ förloppet i aktivitetspanelen.",
  "toast.agentFailed": "Agenten misslyckades: {error}",
  "toast.delegationFailed": "Delegeringen till agenten misslyckades: {error}",
  "toast.copilotRestarting": "Copilot LSP avslutades ({message}) — startar om",
  "toast.imageInsertFailed": "Kunde inte infoga bilden: {name}",
  "toast.docxExported": "Word-dokumentet exporterades",
  "toast.pptxExported": "PowerPoint-filen exporterades",
  "toast.pdfExported": "PDF:en exporterades",
  "toast.exportFailed": "Exporten misslyckades: {error}",
  "toast.gitInitFailed": "Git-initieringen misslyckades: {error}",
  "activity.stopRecording": "Stoppa inspelningen",
  "activity.paused": "Pausad",
  "activity.recording": "Spelar in…",
  "activity.transcribing": "Transkriberar…",
  "activity.transcriptReady": "Transkriptionen är klar",
  "activity.transcriptReadyOpen": "Transkriptionen är klar — klicka för att öppna",
  "activity.transcriptionFailed": "Transkriberingen misslyckades — kan köras om från inkorgen",
  "git.repository": "Git-arkiv",
  "git.repositoryOn": "Git-arkiv — på {branch}",
  "git.compareBranch": "Jämför med gren…",
  "git.loadingBranches": "Läser in grenar",
  "git.noOtherBranches": "Inga andra grenar",
  "git.commitChanges": "Checka in ändringar",
  "git.noChanges": "Inget att checka in",
  "git.selectAll": "Markera alla",
  "git.deselectAll": "Avmarkera alla",
  "git.commitMessage": "Incheckningsmeddelande (obligatoriskt)",
  "git.extendedDescription": "Utförlig beskrivning (valfritt)",
  "git.identityMissing": "Git-identitet är inte konfigurerad",
  "git.yourName": "Ditt namn",
  "git.saveAndRetry": "Spara och försök igen",
  "git.modified": "Ändrad",
  "git.added": "Tillagd — ny fil förberedd för incheckning",
  "git.untracked": "Ospårad — ännu inte spårad av git",
  "git.deleted": "Borttagen",
  "git.renamed": "Omdöpt",
  "git.conflicted": "Konflikt — sammanslagningskonflikt",
  "common.cancel": "Avbryt",
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
/**
 * The user's explicit choice, or `null` to follow the platform. Tracked apart
 * from `current` because the two can differ in a way that matters: on an
 * English device, choosing "English" leaves `current` at `"en"` while changing
 * the answer to "is this a deliberate choice?" — which is exactly what
 * `getFormatLocale` needs to know.
 */
let override: Locale | null = null;
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/**
 * The locale to hand `Intl` / `toLocaleDateString` for dates and numbers.
 *
 * `undefined` when the user has expressed no preference, so the platform's
 * FULL locale applies — a Finnish-Swedish user keeps `sv-FI` conventions
 * rather than being flattened to `sv`, which narrowing would do. Once they
 * pick a language, that choice wins and is returned as-is.
 */
export function getFormatLocale(): string | undefined {
  return override ?? undefined;
}

/** Override the locale (Settings). Pass `null` to follow the platform again. */
export function setLocale(locale: Locale | null): void {
  const next = locale ?? detectPlatformLocale();
  // Notify on an override change even when the resolved language is identical:
  // the format locale still flipped between "follow the OS" and an explicit
  // choice, and subscribers render dates from it.
  if (next === current && locale === override) return;
  current = next;
  override = locale;
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
