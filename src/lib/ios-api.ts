/**
 * Typed wrappers for the iOS-only Tauri commands backing the mobile reader +
 * share capture (PRD `docs/prds/2026-06-28-ios-mobile-app.md`).
 *
 * These mirror `src-tauri/src/commands/ios_library.rs`. All `relPath` values are
 * relative to the granted library root; the Rust layer rejects absolute paths
 * and `..` traversal. On non-iOS targets these commands reject — the mobile
 * shell is only mounted on iOS.
 */
import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "./tauri";
import { t } from "@/lib/i18n";

/**
 * How the library root is resolved (PRD 2026-09-05-icloud-container-library,
 * Decision 4): the app's own iCloud container (no grant, no picker) or a
 * folder the user chose (the fallback without iCloud, and a choice with it).
 */
export type IosLibraryKind = "container" | "picked";

export interface IosLibraryGrant {
  /** User-facing name — "Notesage" in container mode, the chosen folder's
   *  name in picked mode; empty when not granted. */
  displayName: string;
  /** Whether a usable root is currently resolved. */
  granted: boolean;
  /** How the root was resolved. Absent when not granted. */
  kind?: IosLibraryKind;
  /** Whether the container could be resolved at all (drives the fallback copy). */
  icloudAvailable: boolean;
}

export type IosDownloadState = "ready" | "downloading" | "failed";

/** Present the folder picker (pre-pointed at iCloud Drive/Notesage) and
 *  persist the grant. Persisting a bookmark also sets the mode to `picked`. */
export function iosPickLibraryFolder(): Promise<IosLibraryGrant> {
  return invoke<IosLibraryGrant>("ios_pick_library_folder");
}

/** Resolve the current grant; `granted: false` when nothing resolves. */
export function iosGetLibraryGrant(): Promise<IosLibraryGrant> {
  return invoke<IosLibraryGrant>("ios_get_library_grant");
}

/**
 * Settle the library mode against iCloud and the bookmark, then resolve the
 * grant — the mobile store's call at mount. The native side does the
 * container resolution off the main thread; the first call on a fresh
 * install can take seconds, which is what the `provisioning` state is for.
 */
export function iosSetupLibrary(): Promise<IosLibraryGrant> {
  return invoke<IosLibraryGrant>("ios_setup_library");
}

/**
 * The library settings action. `"container"` switches to Notesage in iCloud
 * (the kept bookmark is not forgotten, so switching back is possible);
 * `"picked"` returns to the kept folder. A NEW folder goes through
 * `iosPickLibraryFolder`. Rejects when the target has nothing to resolve to.
 */
export function iosSetLibraryMode(mode: IosLibraryKind): Promise<IosLibraryGrant> {
  return invoke<IosLibraryGrant>("ios_set_library_mode", { mode });
}

/** Forget the persisted grant (used on re-grant / sign-out). */
export function iosClearLibraryGrant(): Promise<void> {
  return invoke<void>("ios_clear_library_grant");
}

/** List a directory relative to the granted library root (`""` = root). */
export function iosListDirectory(relPath: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("ios_list_directory", { relPath });
}

/** Read a UTF-8 file relative to the granted library root. */
export function iosReadFile(relPath: string): Promise<string> {
  return invoke<string>("ios_read_file", { relPath });
}

/**
 * Read a binary file (PDF/EPUB/DOCX/image) relative to the granted library
 * root. The command answers with a RAW IPC response — an ArrayBuffer, no
 * JSON. Anything JSON-shaped here (a number array, or even base64-in-JSON)
 * makes the WebView's main thread parse a payload-sized JSON string, which
 * froze the loading spinner for seconds on large PDFs. The Swift-side base64
 * is decoded on a Rust worker thread before the bytes reach the WebView.
 */
export async function iosReadBinary(relPath: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("ios_read_binary", { relPath });
  return new Uint8Array(buf);
}

/** Ensure an iCloud item is downloaded; returns its current download state. */
/** Native chrome item: an SF-Symbol button at a screen corner. */
export interface IosChromeItem {
  id: string;
  icon: string;
  /** Native UIMenu entries. Long-press by default (tap fires `id`); with
   *  `menuOnTap` the tap opens the menu. `selected` renders a checkmark row
   *  (pick-one controls like the sort menu). */
  menu?: Array<{
    id: string;
    title: string;
    icon?: string;
    selected?: boolean;
    /** Start a new menu section (divider) before this entry. */
    sectionBreak?: boolean;
  }>;
  /** When true, tapping opens `menu` directly and `id` never fires. */
  menuOnTap?: boolean;
  /** True while the action behind this button is in flight — the native
   *  button spins its SF Symbol for the duration, mirroring the web
   *  fallback's `animate-spin` treatment. */
  busy?: boolean;
}

/**
 * Declare the native Liquid Glass chrome overlay. Rejects off-iOS and on
 * pre-native builds — callers treat rejection as "render web chrome".
 */
export interface IosChromeSearch {
  placeholder: string;
  /** Passive status shown collapsed (item count, page indicator). */
  status?: string;
  /** 1-based current match + total for find-in-document searches. */
  current?: number;
  total?: number;
  /** "filter" (folder search) or "find" (in-document, Notes find anatomy). */
  kind?: "filter" | "find";
}

/** Top-center breadcrumb island (#615): current folder name; tapping opens a
 *  native UIMenu of ancestors (root first). Empty/absent menu = passive label. */
export interface IosChromeBreadcrumb {
  title: string;
  /** Compact ancestor path shown as a second line ("Notesage › Projects"). */
  subtitle?: string;
  menu?: Array<{ id: string; title: string; icon?: string; selected?: boolean }>;
}

export function iosSetChrome(spec: {
  topLeft?: IosChromeItem;
  topRight?: IosChromeItem;
  topCenter?: IosChromeBreadcrumb;
  /** Bottom-trailing action button (the folder view's "+"). */
  bottomRight?: IosChromeItem;
  /** Read-aloud transport (#833). */
  bottomCenter?: IosChromePlayer;
  search?: IosChromeSearch;
}): Promise<void> {
  return invoke("ios_set_chrome", { spec });
}

/**
 * System-generated thumbnail PNG (QLThumbnailGenerator) — PDFs, images,
 * videos and office docs rendered by the OS off the webview thread. Raw
 * bytes (no JSON), same transport as `iosReadBinary`.
 */
export async function iosThumbnail(relPath: string, maxPixel: number): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("ios_thumbnail", { relPath, maxPixel });
  return new Uint8Array(buf);
}

/**
 * Rewrite a captured article so its images are embedded rather than linked,
 * making it readable offline (PRD `2026-08-21-self-contained-articles.md`).
 *
 * Returns how many images were embedded. `0` means there was nothing to do —
 * the common case for an already-swept document — so a caller can run this
 * over a folder without tracking what it has already done.
 *
 * The image bytes never come back through this call. Everything happens
 * natively and lands on disk; only the count crosses IPC.
 */
export async function iosInlineArticleImages(
  relPath: string,
  opts?: { maxPixel?: number; jpegQuality?: number },
): Promise<number> {
  return invoke<number>("ios_inline_article_images", {
    relPath,
    maxPixel: opts?.maxPixel,
    jpegQuality: opts?.jpegQuality,
  });
}

/**
 * The image a saved article should be recognised BY — its embedded lead photo.
 *
 * Rejects when the article has no inline image, which is the caller's cue to
 * fall back to the system thumbnail generator. Raw bytes, same transport as
 * `iosReadBinary`.
 */
export async function iosArticleThumbnail(relPath: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("ios_article_thumbnail", { relPath });
  return new Uint8Array(buf);
}

/** What a retroactive image sweep would do, without doing any of it. */
export interface IosUpgradableArticles {
  documents: number;
  images: number;
  paths: string[];
}

/**
 * Scan the whole library for articles that still reference remote images.
 *
 * Reports rather than acts, deliberately: a retroactive sweep rewrites
 * documents the user already owns, can multiply their library size, and makes
 * their device contact every site they ever saved from. The cost is shown
 * before anything happens.
 */
export function iosFindUpgradableArticles(): Promise<IosUpgradableArticles> {
  return invoke<IosUpgradableArticles>("ios_find_upgradable_articles");
}

/**
 * Present the system QuickLook preview for a library file — native
 * video/audio playback and document rendering. Rejects off-iOS.
 */
export function iosQuickLook(relPath: string): Promise<void> {
  return invoke("ios_quick_look", { relPath });
}

/**
 * Delete a FILE (never a directory) under the granted library root. iCloud's
 * "Recently Deleted" (30-day recovery) backs the no-confirm swipe gesture.
 */
export function iosDeleteFile(relPath: string): Promise<void> {
  return invoke("ios_delete_file", { relPath });
}

/**
 * Rename a file within its directory (the title-becomes-filename primitive).
 * `newName` is a single path segment; the native side dedupes on collision.
 * Resolves the relative path actually produced.
 */
export function iosRenameFile(relPath: string, newName: string): Promise<string> {
  return invoke<string>("ios_rename_file", { relPath, newName });
}

/**
 * Move a FILE into another folder under the library root (#754).
 *
 * `destDir` is a directory relative path; `""` is the library root. Files
 * only — the native side refuses directories, matching `iosDeleteFile`'s
 * stance, because moving a folder relocates an arbitrary subtree in one call.
 *
 * The destination must already exist; this does not create it. Deduped
 * natively on collision, so filing two captures with the same title into one
 * folder keeps both. Resolves the relative path actually produced.
 */
export function iosMoveFile(relPath: string, destDir: string): Promise<string> {
  return invoke<string>("ios_move_file", { relPath, destDir });
}

/**
 * Create `relPath` if it doesn't exist (no dedupe, unlike
 * `iosCreateDirectory`). Idempotent — safe to call before every write.
 */
export function iosEnsureDirectory(relPath: string): Promise<void> {
  return invoke("ios_ensure_directory", { relPath });
}

export interface IosEntryMenuItem {
  id: string;
  title: string;
  /** SF Symbol name — the menu is drawn natively. */
  systemImage: string;
  destructive?: boolean;
  /** `true` → the compact icon row at the top of the panel. */
  inline?: boolean;
}

export interface IosEntryMenuSpec {
  title: string;
  subtitle?: string;
  /** File to render into the preview card via QuickLook. Omit for folders. */
  previewRelPath?: string;
  /** Pre-rendered note HTML — preferred over `previewRelPath`, since
   *  QuickLook renders a `.md` file as its raw text. */
  previewHtml?: string;
  isDirectory: boolean;
  /** The pressed element's rect in CSS pixels — the preview grows out of it
   *  and shrinks back into it on dismiss. */
  sourceRect?: { x: number; y: number; width: number; height: number };
  items: IosEntryMenuItem[];
}

/**
 * Long-press preview + action menu (#680): a preview card over a blurred
 * backdrop with the actions beneath, morphing out of the pressed row.
 * Resolves the chosen item id, or `null` when dismissed.
 */
export async function iosEntryMenu(spec: IosEntryMenuSpec): Promise<string | null> {
  const chosen = await invoke<string | null>("ios_entry_menu", { spec });
  return chosen ?? null;
}

export interface IosContextMenuItem {
  id: string;
  title: string;
  /** Red, and sunk below the plain rows — iOS never stacks one higher. */
  destructive?: boolean;
}

/**
 * Present a native action sheet and resolve the chosen item id (`null` when
 * cancelled). `at` is the press point in CSS pixels; it only anchors the
 * iPad popover, but omitting it there would crash UIKit.
 */
export async function iosContextMenu(options: {
  title?: string;
  items: IosContextMenuItem[];
  at?: { x: number; y: number };
}): Promise<string | null> {
  const chosen = await invoke<string | null>("ios_context_menu", {
    title: options.title ?? null,
    items: options.items,
    x: options.at?.x ?? null,
    y: options.at?.y ?? null,
    cancelLabel: t("common.cancel"),
  });
  return chosen ?? null;
}

/**
 * Tell the native layer the webview has painted, so it drops the launch
 * cover held over it (#675). Fire-and-forget: rejects off-iOS, and the
 * native side removes the cover on a timeout anyway.
 */
export function iosContentReady(): Promise<void> {
  return invoke("ios_content_ready");
}

/**
 * Native single-line text prompt (UIAlertController with a text field).
 * Resolves the entered text, or `null` when the user cancels. Rejects
 * off-iOS — callers fall back to a web prompt.
 */
export async function iosTextPrompt(
  title: string,
  placeholder: string,
  confirmLabel: string,
  options: {
    /** Pre-filled, editable text — rename starts from the current name. */
    value?: string;
    /** Preselect the filename stem so typing replaces the name but keeps the
     *  extension, as Files and Finder do. */
    selectStem?: boolean;
  } = {},
): Promise<string | null> {
  const text = await invoke<string | null>("ios_text_prompt", {
    title,
    placeholder,
    confirmLabel,
    cancelLabel: t("common.cancel"),
    value: options.value ?? null,
    selectStem: options.selectStem ?? false,
  });
  return text ?? null;
}

/**
 * Show an exported HTML report in its own bridge-less WKWebView (#606,
 * ADR 0010) instead of the sandboxed `htmlpreview://` iframe.
 *
 * REJECTS when the native layer is absent — desktop dev, the vitest suite, any
 * build without the plugin — and that rejection is the contract, not a bug:
 * the reader falls back to the iframe path on it. Callers must not swallow it
 * into a resolved promise, or the fallback never runs and the reader shows an
 * empty pane.
 */
/**
 * Hand a message to the read-aloud agent inside the natively presented
 * report (#833 highlight). Resolves `false` when no report is on screen —
 * the iframe fallback posts to its frame directly instead.
 */
export function iosPostToReport(message: unknown): Promise<boolean> {
  return invoke<{ delivered: boolean } | boolean>("ios_post_to_report", {
    message: JSON.stringify(message),
  }).then((r) => (typeof r === "boolean" ? r : r.delivered));
}

export function iosPresentReport(
  html: string,
  insets?: { top?: number; bottom?: number },
): Promise<void> {
  return invoke("ios_present_report", {
    html,
    insetTop: insets?.top ?? 0,
    insetBottom: insets?.bottom ?? 0,
  });
}

/** Tear down the presented report. Idempotent; safe to call when none is up. */
export function iosDismissReport(): Promise<void> {
  return invoke("ios_dismiss_report");
}

/**
 * Open WebKit's find bar over the presented report.
 *
 * Resolves `false` when no report is on screen, and — unlike the two above —
 * swallows a rejection into `false` as well. Both mean the same thing to the
 * caller ("native find is not available, use the island"), and the search
 * affordance is a worse place to surface an error than a silent fallback.
 */
export async function iosFindInReport(): Promise<boolean> {
  try {
    return await invoke<boolean>("ios_find_in_report");
  } catch {
    return false;
  }
}

/** Present the iOS share sheet for a library file. */
export function iosShareFile(relPath: string): Promise<void> {
  return invoke("ios_share_file", { relPath });
}

export function iosEnsureDownloaded(relPath: string): Promise<IosDownloadState> {
  return invoke<IosDownloadState>("ios_ensure_downloaded", { relPath });
}

/**
 * Overwrite (or create) a UTF-8 file — the mobile editor's save path (#586).
 * Atomic coordinated write on the native side.
 */
export function iosWriteFile(relPath: string, content: string): Promise<void> {
  return invoke("ios_write_file", { relPath, content });
}

/**
 * The corrected form of a saved article that lost its `<!doctype html>` to
 * #805, or `null` when the document is already fine.
 *
 * `null` is the common answer and the reason this returns an option rather
 * than a string: the caller must be able to skip the write entirely, because a
 * no-op rewrite would churn the file's modification date and re-sync it for
 * nothing.
 *
 * The decision lives in Rust (`notesage-capture`) next to the builder whose
 * output it repairs — deliberately NOT reimplemented here, so there is one
 * opinion about what a damaged document looks like.
 */
export function iosRepairHtmlDoctype(content: string): Promise<string | null> {
  return invoke("repair_html_doctype", { content });
}

/**
 * Create a new UTF-8 file. The name is deduped natively (`note.md` →
 * `note-1.md`) rather than overwritten; resolves to the relative path
 * actually created.
 */
export function iosCreateFile(relPath: string, content: string): Promise<string> {
  return invoke<string>("ios_create_file", { relPath, content });
}

/**
 * Create a new folder. The name is deduped natively; resolves to the
 * relative path actually created.
 */
export function iosCreateDirectory(relPath: string): Promise<string> {
  return invoke<string>("ios_create_directory", { relPath });
}

export interface IosFileStat {
  /** File size in bytes. */
  sizeBytes: number;
}

/**
 * Cheap metadata probe — the file's size, without reading its content. The
 * mobile reader calls this before `iosReadFile` for text/markdown/html so it
 * can decline an oversized file instead of attempting a read that would
 * freeze the WebView (issue #616).
 */
export function iosStatFile(relPath: string): Promise<IosFileStat> {
  return invoke<IosFileStat>("ios_stat_file", { relPath });
}


/** Bottom-center transport rendered by the NATIVE chrome (#833). */
export interface IosChromePlayer {
  playing: boolean;
  /** Pre-formatted paragraph position, e.g. "3 / 41". */
  position: string;
  /** Pre-formatted rate, e.g. "1.5×". */
  rate: string;
}

/** What a list row shows for a saved article (#836), from its own header. */
export interface ArticleCardMeta {
  title: string | null;
  excerpt: string | null;
  minutes: number | null;
  site: string | null;
}

/**
 * Read a list row's fields back out of a capture's own header. `null` for a
 * document that is not a capture — the caller shows the plain file row.
 */
export function articleCardMeta(content: string): Promise<ArticleCardMeta | null> {
  return invoke<ArticleCardMeta | null>("article_card_meta", { content });
}

/**
 * The same, read and parsed natively from a library path — only the four
 * strings cross the bridge, not the 200–800 KB capture they came from.
 */
export function iosArticleCardMeta(relPath: string): Promise<ArticleCardMeta | null> {
  return invoke<ArticleCardMeta | null>("ios_article_card_meta", { relPath });
}

/** Where the native speech player currently is (#833). */
export interface IosSpeechState {
  /** Paragraph index currently being spoken. */
  index: number;
  /** Total paragraphs as the native side split the article. */
  total: number;
  playing: boolean;
}

/**
 * Events pushed from the native player.
 *
 * `playing` is a SEPARATE fact from position, not derivable from it: play and
 * pause can originate from the lock screen or Control Centre, which never
 * touch the frontend. `finished` likewise — collapsing "reached the last
 * paragraph" into a progress event left the transport stuck showing Pause
 * forever after an article ended.
 */
export type IosSpeechEvent =
  | { event: "progress"; index: number; total: number }
  | { event: "playing"; playing: boolean }
  /** The word about to be spoken: UTF-16 range within paragraph `index`'s
   *  text. Not every voice reports these. */
  | { event: "range"; index: number; location: number; length: number }
  | { event: "finished" };

/**
 * Start (or restart) reading an article aloud.
 *
 * `text` is plain prose — the native side splits it on blank lines into
 * paragraph utterances, which is what makes skip-by-paragraph work and what
 * makes a resume position survive the app being killed. `startIndex` is a
 * paragraph index and is clamped natively, so a stored position from a
 * since-edited article is safe to pass verbatim.
 */
export function iosSpeechStart(options: {
  text: string;
  title: string;
  startIndex: number;
  rate: number;
  /** The user's own voice picks, keyed by language subtag ("en" -> id). */
  voiceByLanguage: Record<string, string>;
  /** The article's lead image, base64-encoded, for the lock-screen artwork. */
  artworkBase64?: string | null;
}): Promise<IosSpeechStarted> {
  return invoke<IosSpeechStarted>("ios_speech_start", {
    text: options.text,
    title: options.title,
    startIndex: options.startIndex,
    rate: options.rate,
    voiceByLanguage: options.voiceByLanguage,
    artworkBase64: options.artworkBase64 ?? null,
  });
}

/** What starting playback decided — the language the article is read in. */
export interface IosSpeechStarted {
  language: string | null;
}

/** One installed voice, as the picker shows it. */
export interface IosSpeechVoice {
  id: string;
  name: string;
  /** BCP-47, e.g. "en-US". */
  language: string;
  quality: "premium" | "enhanced" | "default";
}

/** Installed voices for a language subtag, best first. */
export function iosSpeechVoices(language: string): Promise<IosSpeechVoice[]> {
  return invoke<IosSpeechVoice[]>("ios_speech_voices", { language });
}

/** Switch voice mid-article; the current paragraph is re-spoken. */
export function iosSpeechSetVoice(voiceId: string): Promise<void> {
  return invoke("ios_speech_set_voice", { voiceId });
}

export function iosSpeechPause(): Promise<void> {
  return invoke("ios_speech_pause");
}

export function iosSpeechResume(): Promise<void> {
  return invoke("ios_speech_resume");
}

export function iosSpeechStop(): Promise<void> {
  return invoke("ios_speech_stop");
}

/** Move `delta` paragraphs; negative goes back. Past the end stops playback. */
export function iosSpeechSkip(delta: number): Promise<void> {
  return invoke("ios_speech_skip", { delta });
}

export function iosSpeechSetRate(rate: number): Promise<void> {
  return invoke("ios_speech_set_rate", { rate });
}

export function iosSpeechState(): Promise<IosSpeechState> {
  return invoke<IosSpeechState>("ios_speech_state");
}

// --- Recording (recordings PRD) ---------------------------------------------

export type IosRecordingStatus = "idle" | "recording" | "paused" | "finalizing";

export interface IosRecordingOrphan {
  /** The staging folder's name, for `iosRecordingRecover`. */
  dir: string;
  /** Whether the audio still opens; a force-quit can leave it unfinished. */
  readable: boolean;
  durationSecs?: number;
  startedAt?: string;
}

export interface IosRecordingState {
  status: IosRecordingStatus;
  elapsedSecs: number;
  level: number;
  interrupted: boolean;
  micPermission: "unknown" | "granted" | "denied";
  orphan?: IosRecordingOrphan;
}

export type IosRecordingEvent =
  | { event: "started" }
  | { event: "tick"; elapsedSecs: number; level: number }
  | { event: "paused" }
  | { event: "resumed" }
  | { event: "interrupted"; reason: "began" | "ended" }
  | { event: "route"; reason: string }
  | { event: "finished"; reason?: string; stagedDir?: string }
  | { event: "error"; message: string };

/** Errors: `microphone-denied`, `low-disk-space`, `recording-in-progress`. */
export function iosRecordingStart(language?: string | null): Promise<void> {
  return invoke("ios_recording_start", { language: language ?? null });
}
export function iosRecordingPause(): Promise<void> {
  return invoke("ios_recording_pause");
}
export function iosRecordingResume(): Promise<void> {
  return invoke("ios_recording_resume");
}
/** Finalise into the library, or discard (a slip of the finger). */
export function iosRecordingStop(discard = false): Promise<{ relPath: string | null; manifest: string | null }> {
  return invoke("ios_recording_stop", { discard });
}
export function iosRecordingState(): Promise<IosRecordingState> {
  return invoke<IosRecordingState>("ios_recording_state");
}
export function iosRecordingRecover(action: "keep" | "discard", dir: string): Promise<string | null> {
  return invoke<string | null>("ios_recording_recover", { action, dir });
}
export function onIosRecordingEvent(handler: (event: IosRecordingEvent) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail as IosRecordingEvent | undefined;
    if (detail?.event) handler(detail);
  };
  window.addEventListener("notesage:recording", listener);
  return () => window.removeEventListener("notesage:recording", listener);
}

/** The recording island (`bottomRecorder`), shown while a recording runs. */
export interface IosChromeRecorder {
  /** Pre-formatted "02:14". */
  elapsed: string;
  paused: boolean;
  level: number;
  interrupted: boolean;
  interruptedLabel?: string;
}

// --- Notifications: badge, banners, background refresh ---------------------

export interface IosNotificationStatus {
  authorization: "notDetermined" | "denied" | "authorized";
  backgroundRefresh: "available" | "denied" | "restricted";
  badge: boolean;
  newItems: boolean;
}

export function iosNotificationStatus(): Promise<IosNotificationStatus> {
  return invoke<IosNotificationStatus>("ios_notification_status");
}

/** The one system prompt (badge and alert, no sound). */
export function iosNotificationRequest(): Promise<IosNotificationStatus> {
  return invoke<IosNotificationStatus>("ios_notification_request");
}

/** Badge and banner preferences, and the localised banner strings the
 *  native side posts with (`title`, `one` with `{title}`, `many` with
 *  `{count}`, `more` with `{list}` and `{count}`). */
export function iosNotificationSetPrefs(patch: {
  badge?: boolean;
  newItems?: boolean;
  templates?: Record<string, string>;
}): Promise<IosNotificationStatus> {
  return invoke<IosNotificationStatus>("ios_notification_set_prefs", patch);
}

/** Recount the unread Inbox from disk and refresh the icon badge; with
 *  `markSeen` (only when the Inbox's items are on screen) record them as
 *  seen, so the next background refresh announces only what comes after. */
export function iosInboxUnreadCount(markSeen = false): Promise<number> {
  return invoke<number>("ios_inbox_unread_count", { markSeen });
}

/** Where a notification tap wants the app to land, once. */
export function iosConsumeLaunchRoute(): Promise<string | null> {
  return invoke<string | null>("ios_consume_launch_route");
}

export function iosOpenSettings(): Promise<void> {
  return invoke("ios_open_settings");
}

/** A warm notification tap: the native delegate dispatches `notesage:notification`. */
export function onIosNotificationRoute(handler: (route: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail as { route?: string } | undefined;
    if (detail?.route) handler(detail.route);
  };
  window.addEventListener("notesage:notification", listener);
  return () => window.removeEventListener("notesage:notification", listener);
}

/**
 * Subscribe to native player events.
 *
 * The native side dispatches a `CustomEvent` on `window` rather than going
 * through Tauri's event bus — same bridge the chrome overlay uses, and it
 * keeps the player's position updates off the IPC round-trip that every
 * paragraph boundary would otherwise pay.
 */
export function onIosSpeechEvent(handler: (event: IosSpeechEvent) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail as IosSpeechEvent | undefined;
    if (detail?.event) handler(detail);
  };
  window.addEventListener("notesage:speech", listener);
  return () => window.removeEventListener("notesage:speech", listener);
}
