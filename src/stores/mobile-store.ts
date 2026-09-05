/**
 * Mobile (iOS) shell state — library grant + folder navigation + recent docs.
 * PRD `docs/prds/2026-06-28-ios-mobile-app.md` (task #11).
 *
 * Deliberately small: the mobile shell is a read-only reader plus share
 * capture, so there is no editor/AI/workspace state here. The grant lives
 * natively (a security-scoped bookmark); `grantState` is resolved from the
 * backend at mount via `refreshGrant()` rather than trusted from persistence —
 * only `recentlyRead` is persisted.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  iosGetLibraryGrant,
  iosPickLibraryFolder,
  iosClearLibraryGrant,
  iosReadFile,
  iosWriteFile,
  iosEnsureDirectory,
  iosInboxUnreadCount,
  iosNotificationRequest,
  iosNotificationSetPrefs,
  iosNotificationStatus,
  type IosNotificationStatus,
  type IosRecordingOrphan,
  type IosRecordingStatus,
} from "@/lib/ios-api";
import { t } from "@/lib/i18n";
import {
  PINS_FILE_REL_PATH,
  parsePinsFileContent,
  serializePinsFileContent,
} from "@/lib/pins-file";
import {
  HOME_FILE_REL_PATH,
  HOME_KEY,
  applyHomeChange,
  defaultHomeFolders,
  parseHomeFileContent,
  serializeHomeFileContent,
} from "@/lib/home-file";
import type { FileEntry } from "@/lib/tauri";

/**
 * - `unknown`  — not yet resolved (initial; show a neutral splash)
 * - `ungranted`— no grant; show onboarding
 * - `granted`  — usable grant; show the library
 * - `stale`    — bookmark went stale; show onboarding's re-grant copy
 */
export type GrantState = "unknown" | "ungranted" | "granted" | "stale";

/** A folder in the breadcrumb (relative path + display name). */
export interface FolderRef {
  relPath: string;
  name: string;
}

/** The currently open document (relative path + display name). */
export interface OpenDocRef {
  relPath: string;
  name: string;
  /** A brand-new note that does NOT exist on disk yet: the Reader opens the
   *  editor with an empty draft and only CREATES the file on save/back when
   *  the draft is non-empty — an accidental "+" tap leaves no file behind
   *  (#586 follow-up, Notes semantics). `relPath` is the intended location;
   *  the real path is chosen at creation (title-derived, deduped). */
  isNew?: boolean;
}

/** What is being read aloud right now, app-wide (#833, list playback).
 *
 *  Playback belongs to the APP, not to the open document: it starts from a
 *  list row, a gallery card or the Reader, keeps going while the user moves
 *  between them, and every surface renders this one session. Held here
 *  rather than in a hook so the row that started it, the card for the same
 *  article and the Reader's transport all agree. Not persisted — the native
 *  player does not survive a relaunch, so a stale session would be a lie. */
export interface SpeechSession {
  relPath: string;
  title: string;
  playing: boolean;
  /** Paragraph index currently being spoken. */
  index: number;
  /** Total paragraphs, or 0 before the first progress event. */
  total: number;
  rate: number;
  /** Language subtag the article is being read in ("en"), once known. */
  language: string | null;
}

const RECENT_CAP = 20;
/**
 * How many documents deep the link trail can go before the oldest is dropped.
 * A generated site can link in circles, and an unbounded trail would grow for
 * as long as someone keeps tapping. Twenty steps is far past what anyone
 * retraces by hand; losing the twenty-first costs a return to the folder.
 */
const DOC_STACK_CAP = 20;

/** Library listing order (#632): alphabetical (folders first) or modified
 *  (newest first, folders and files interleaved — Files-app behaviour). */
export type SortMode = "name" | "modified";

/** Listing grouping (#652): pinned (shared pins.json), recent (this app's
 *  recently-read list) or date (Notes' Today / Yesterday / … buckets). */
export type GroupMode = "none" | "pinned" | "recent" | "date" | "type";

/** List (single-column) vs. gallery (grid of preview cards) library layout (#633). */
export type ViewMode = "list" | "gallery";
/** How much each list row shows (#836): the full article row, or one line. */
export type ListDensity = "comfortable" | "condensed";

/**
 * How one folder's listing looks: layout, density, order and grouping.
 * Remembered per folder, the way Finder and Files do it — the root is a
 * short list of folders, the Inbox a gallery of pictures, a project a list
 * by date — instead of one setting that every screen follows.
 */
export interface FolderView {
  viewMode: ViewMode;
  listDensity: ListDensity;
  sortMode: SortMode;
  groupMode: GroupMode;
}

/** One folder's remembered view. A list rather than a map keyed by path
 *  because the eviction order must be the order of setting, and a JS object
 *  enumerates a key like `"2024"` first whatever the insertion order — a
 *  year-named folder would always be the one forgotten. */
export interface FolderViewEntry {
  relPath: string;
  view: Partial<FolderView>;
}

/**
 * Longest-edge cap for embedded images. `"original"` is offered but not the
 * default: it is the honest option for someone who wants archival fidelity and
 * accepts the iCloud cost, not something to hand people by accident.
 */
export type ImageMaxPixel = 1200 | 1600 | 2048 | "original";

interface MobileStore {
  grantState: GrantState;
  libraryName: string;
  /** Breadcrumb of entered folders; empty = library root. */
  folderStack: FolderRef[];
  /** Open document, or null when browsing. */
  openDoc: OpenDocRef | null;
  /** Most-recently-read relative paths (newest first). */
  recentlyRead: string[];
  /** Listing order for the library browser (persisted). */
  sortMode: SortMode;
  /** Listing grouping for the library browser (persisted). */
  groupMode: GroupMode;
  /** List vs. gallery layout. Together with `listDensity`, `sortMode` and
   *  `groupMode` this is the FALLBACK for a folder that has no view of its
   *  own (see `folderViews`): what the app looked like before views were
   *  remembered per folder, so an upgrade changes nothing a user set. */
  viewMode: ViewMode;
  /**
   * Each folder's own view by root-relative path (`""` = root), least
   * recently set first, persisted; `resolveFolderView` fills in what a
   * folder has not chosen. Bounded so years of browsing cannot grow it
   * without end.
   */
  folderViews: FolderViewEntry[];
  /**
   * Longest edge, in pixels, for images embedded by the background sweep —
   * or `"original"` to embed them untouched.
   *
   * This setting is what makes embedding affordable at all. A full-resolution
   * press photo is 2-4 MB; base64 inflates it by a further third; and every
   * one of those bytes syncs through iCloud, forever, for every saved article.
   * At 1600 the same photo is ~250 KB and nothing visible is lost — 1600 is
   * already 2x retina on a 390pt-wide phone.
   */
  imageMaxPixel: ImageMaxPixel;
  /** JPEG quality for embedded images, 0-1. */
  imageQuality: number;
  /** Master switch for the background sweep. */
  inlineImagesEnabled: boolean;
  /** Root-relative pinned paths read from the shared library-root
   *  `.notesage/pins.json` (#652) — read-only on iOS in this slice, desktop
   *  is the only writer. Not persisted: always freshly re-read from disk
   *  (a missing file resolves to an empty array, never throws). */
  pinnedPaths: string[];

  /** Current folder relative path (`""` at root). */
  currentRelPath: () => string;

  /** Resolve the native grant. Sets granted/ungranted, or `stale` on error. */
  refreshGrant: () => Promise<void>;
  /** Drive the folder picker; on success transitions to `granted`. Rethrows on failure. */
  pickFolder: () => Promise<void>;
  /** Forget the grant and reset navigation. */
  clearGrant: () => Promise<void>;

  /** Push a folder onto the breadcrumb. */
  enterFolder: (ref: FolderRef) => void;
  /** Jump straight to a folder, replacing the whole stack — the Inbox
   *  shortcut, which must work from any depth rather than pushing Inbox
   *  under wherever you happened to be. */
  jumpToFolder: (ref: FolderRef) => void;
  /** Open a document (records it in recents). */
  openDocument: (ref: OpenDocRef) => void;
  /**
   * Open a document reached by following a link from the one already open,
   * pushing the current one onto the back trail.
   *
   * Separate from `openDocument` because the two mean different things to
   * Back. Opening from the listing starts fresh — Back returns to the folder.
   * Following a link continues a trail, and Back has to walk it in reverse,
   * or reading a set of linked pages becomes one-way.
   */
  openLinkedDocument: (ref: OpenDocRef) => void;
  /** Documents behind the open one, oldest first — the link trail. */
  docStack: OpenDocRef[];
  /** Close the open document. */
  closeDocument: () => void;
  /** Back: previous linked doc, else close the doc, else pop one folder level. Returns false at root. */
  goBack: () => boolean;
  /** Jump to a breadcrumb depth (0 = root). */
  goToDepth: (depth: number) => void;
  /** Switch the folder being viewed between list and gallery. Every view
   *  setter writes the CURRENT folder's entry in `folderViews`. */
  setViewMode: (mode: ViewMode) => void;
  setImageMaxPixel: (v: ImageMaxPixel) => void;
  setImageQuality: (v: number) => void;
  setInlineImagesEnabled: (v: boolean) => void;

  setSortMode: (mode: SortMode) => void;
  setGroupMode: (mode: GroupMode) => void;

  /** Reload `pinnedPaths` from `.notesage/pins.json` at the library root.
   *  Tolerant of a missing file — resolves to an empty array, never throws. */
  loadPinnedPaths: () => Promise<void>;

  /** Listing scroll offset per folder, so opening a document and coming
   *  back lands where you were rather than at the top (Peter, 2026-08-13 —
   *  the browser unmounts while the Reader is open, taking the DOM scroll
   *  position with it). Session-only: not worth persisting, and a stale
   *  offset into a folder that changed on another device is worse than
   *  starting at the top. */
  scrollOffsets: Record<string, number>;
  rememberScroll: (relPath: string, offset: number) => void;

  /** Listening position per document, as a PARAGRAPH index (#833).
   *
   *  Persisted, unlike `scrollOffsets`: a part-listened article is the whole
   *  point of the feature, and picking it up on the next launch is what makes
   *  it usable on a commute. A paragraph index also degrades safely when the
   *  article changed underneath it — the native player clamps an out-of-range
   *  position rather than failing. */
  speechPositions: Record<string, number>;
  rememberSpeechPosition: (relPath: string, index: number) => void;

  /** The user's chosen reading voice per language subtag ("en" -> voice id).
   *
   *  Persisted and authoritative: there is NO API that tells an app which
   *  voice the user picked in iOS Settings, so the app has to remember the
   *  choice itself. Peter's phone read English with premium en-AU Karen —
   *  the right tier, the wrong voice — until this existed. */
  speechVoices: Record<string, string>;
  rememberSpeechVoice: (language: string, voiceId: string) => void;

  /** The one thing being read aloud, or null. Written by `speech-controller`. */
  speech: SpeechSession | null;
  setSpeech: (patch: Partial<SpeechSession> | null) => void;
  /** The reading speed the user settled on, as a multiplier. Persisted: a
   *  speed is a preference, not a property of one article. */
  speechRate: number;
  setSpeechRate: (rate: number) => void;

  /** How far through each document the reader has scrolled, 0…1 (#836).
   *  Persisted: it is what turns a file list into a read-later list —
   *  "2 of 4 min left" — and it must survive relaunch to mean anything. */
  readingProgress: Record<string, number>;
  rememberReadingProgress: (relPath: string, fraction: number) => void;
  /** A "mark as unread" made on another device (#876): drops this document's
   *  local fraction and listen position — the one write that goes BACKWARDS
   *  past the forward-only guard — and records the reset's stamp so the same
   *  reset is applied once. Used by the Inbox sync only. */
  applyReadingReset: (relPath: string, resetAt: string) => void;
  /** Record a reset stamp WITHOUT wiping: this device read the item after
   *  the reset, so its progress is the newer fact. Same ledger, same cap. */
  recordReadingReset: (relPath: string, resetAt: string) => void;
  /** Reset stamps already applied here, per document. Persisted: after a
   *  relaunch the sidecar still carries the reset, and it must not wipe what
   *  was read since. */
  readingResets: Record<string, string>;
  /** Inbox items this device knows have been OPENED, by rel path.
   *
   *  Progress alone cannot answer "have I read this": an item opened and
   *  closed at the first paragraph has a fraction of 0, exactly like one
   *  never touched. The sidecar's `openedAt` is the real rule (`isUnread`),
   *  and `inbox-progress-sync` writes it here — from a local open and from
   *  what the Mac already recorded — so a row can render it. */
  inboxOpened: Record<string, true>;
  markInboxOpened: (relPath: string) => void;

  /** Row density for the list view (#836). Persisted. */
  listDensity: ListDensity;
  setListDensity: (density: ListDensity) => void;

  /**
   * The folders Home shows, from `.notesage/home.json` — `null` when the
   * library has no such file, in which case the defaults apply (the Inbox
   * alone). Not persisted: the file is the truth, re-read with every root
   * listing so a change made on another device shows on the next refresh.
   */
  homeFolders: string[] | null;
  /** Read `home.json`; a missing or unreadable file is `null`, never a throw. */
  loadHomeFolders: () => Promise<void>;
  /** Put a root folder on Home or take it off: read-modify-write of the
   *  shared file, compacting entries that no longer name a folder in
   *  `rootEntries`. Rethrows so the caller can say so. */
  setOnHome: (relPath: string, shown: boolean, rootEntries: FileEntry[]) => Promise<void>;
  /**
   * The recorder (recordings PRD). Not persisted: the native recorder is the
   * truth and the app asks it on launch. Everything that must keep going
   * with the screen locked lives natively; this is the mirror the islands
   * draw from.
   */
  recording: RecordingState;
  setRecording: (patch: Partial<RecordingState>) => void;

  /**
   * Notifications (badge and banners) as the native side reports them, or
   * `null` where there is no native side (desktop dev, tests). The phone can
   * only announce what it observes itself: the badge is the unread Inbox
   * count read from disk, the banner comes from a best-effort background
   * refresh — never a delivery guarantee.
   */
  notifications: IosNotificationStatus | null;
  /** Unread Inbox items, as last counted natively — the icon badge's number. */
  unreadInbox: number;
  /** "Not now" on the Inbox's pre-prompt card is permanent (persisted). */
  notificationPrePromptDismissed: boolean;
  /** Re-read the status; with `sendTemplates` (mount), also hand over the
   *  localised banner strings so the background task and the extension post
   *  in the user's language. */
  refreshNotificationStatus: (sendTemplates?: boolean) => Promise<void>;
  /** The one system prompt; on a grant both preferences turn on. */
  requestNotifications: () => Promise<void>;
  setNotificationPref: (patch: { badge?: boolean; newItems?: boolean }) => Promise<void>;
  /** Recount the unread Inbox natively and refresh the badge; `markSeen`
   *  only when the Inbox's items are on screen. Tolerates no native side. */
  refreshUnread: (markSeen?: boolean) => Promise<void>;
  dismissNotificationPrePrompt: () => void;
  /** Whether the Edit Home screen is showing (session only). */
  homeEditorOpen: boolean;
  openHomeEditor: () => void;
  closeHomeEditor: () => void;
  /** The one-line hint under a not-yet-curated Home has been dismissed
   *  (persisted: it is about this screen having changed). */
  homeHintDismissed: boolean;
  dismissHomeHint: () => void;

  /** Pin or unpin a root-relative path, writing the shared
   *  `.notesage/pins.json` the desktop reads. Re-reads the file first so a
   *  pin made on the desktop since the last load is not clobbered. */
  togglePin: (relPath: string) => Promise<void>;

  /** Rewrite every stored reference to `from` so it points at `to` (#754).
   *  Recents, the open document, the back trail and the pins file all hold
   *  PATHS, so a move leaves them aiming at a file that no longer exists. */
  rewritePath: (from: string, to: string) => Promise<void>;
  /** Drop what is remembered about a deleted path and everything under it
   *  — views, scroll offsets, reading progress, listening positions, reset
   *  stamps, recents, and its pins in the shared file — so a later entry of
   *  the same name starts fresh instead of inheriting a dead one's memory. */
  forgetPath: (relPath: string) => Promise<void>;

  /** Test/reset helper. */
  reset: () => void;
}

/** How many articles keep a listening position. One small integer each; the
 *  cap exists so the map cannot grow without bound over years of use. */
const MAX_SPEECH_POSITIONS = 200;
/** Same cap and reasoning for reading progress. */
const MAX_READING_PROGRESS = 500;
/** The reset ledger is bounded like the progress map it guards; the oldest
 *  entries go first — a stamp that old has long been absorbed. */
const MAX_READING_RESETS = 500;
/** Folders that remember a view of their own; the oldest forgotten first. */
const MAX_FOLDER_VIEWS = 200;

export interface RecordingState {
  status: IosRecordingStatus;
  startedAt: number | null;
  elapsedSecs: number;
  /** 0…1, metered. */
  level: number;
  /** Paused by the system (a call) and not resumed. */
  interrupted: boolean;
  micPermission: "unknown" | "granted" | "denied";
  /** A staging folder a force-quit left behind, until the user decides. */
  orphan: IosRecordingOrphan | null;
}

export const IDLE_RECORDING: RecordingState = {
  status: "idle",
  startedAt: null,
  elapsedSecs: 0,
  level: 0,
  interrupted: false,
  micPermission: "unknown",
  orphan: null,
};

/** The banner strings the native side posts with, in the user's language —
 *  the frontend owns the translation table, so it hands them over. */
export function notificationTemplates(): Record<string, string> {
  return {
    title: t("notify.title"),
    one: t("notify.one"),
    many: t("notify.many"),
    more: t("notify.more"),
  };
}

/**
 * The view a screen shows: its own choices over the app-wide fallback. Home
 * (`HOME_KEY`) is the exception — a list by default whatever the fallback
 * says, because a root of folders rendered as a wall of identical cards was
 * the complaint that made views per-folder in the first place. All Folders
 * lists the same root under its own key and follows the fallback.
 */
export function resolveFolderView(
  s: Pick<MobileStore, "folderViews" | "viewMode" | "listDensity" | "sortMode" | "groupMode">,
  relPath: string,
): FolderView {
  const own = s.folderViews.find((e) => e.relPath === relPath)?.view ?? {};
  return {
    viewMode: own.viewMode ?? (relPath === HOME_KEY ? "list" : s.viewMode),
    listDensity: own.listDensity ?? s.listDensity,
    sortMode: own.sortMode ?? s.sortMode,
    groupMode: own.groupMode ?? s.groupMode,
  };
}

/**
 * The key a screen remembers its view (and scroll offset) under: Home — the
 * top of the stack — is `HOME_KEY`, every other screen its folder path.
 * Home and "All Folders" both list the root and must not share a memory.
 */
export function screenKeyOf(folderStack: FolderRef[]): string {
  return folderStack.length === 0 ? HOME_KEY : folderStack[folderStack.length - 1].relPath;
}

function withFolderView(views: FolderViewEntry[], relPath: string, patch: Partial<FolderView>): FolderViewEntry[] {
  // Moved to the end: the folder just set is the newest for eviction.
  const previous = views.find((e) => e.relPath === relPath)?.view ?? {};
  const next = [...views.filter((e) => e.relPath !== relPath), { relPath, view: { ...previous, ...patch } }];
  return next.length > MAX_FOLDER_VIEWS ? next.slice(next.length - MAX_FOLDER_VIEWS) : next;
}

function withReset(ledger: Record<string, string>, relPath: string, resetAt: string): Record<string, string> {
  const next = { ...ledger, [relPath]: resetAt };
  const keys = Object.keys(next);
  if (keys.length > MAX_READING_RESETS) {
    for (const stale of keys.slice(0, keys.length - MAX_READING_RESETS)) delete next[stale];
  }
  return next;
}

export const useMobileStore = create<MobileStore>()(
  persist(
    (set, get) => ({
      grantState: "unknown",
      libraryName: "",
      folderStack: [],
      openDoc: null,
      docStack: [],
      recentlyRead: [],
      sortMode: "name",
      groupMode: "none",
      viewMode: "list",
      folderViews: [],
      imageMaxPixel: 1600,
      imageQuality: 0.8,
      inlineImagesEnabled: true,
      pinnedPaths: [],
      scrollOffsets: {},
      speechPositions: {},
      speechVoices: {},
      speech: null,
      speechRate: 1.0,
      readingProgress: {},
      readingResets: {},
      inboxOpened: {},
      listDensity: "comfortable",
      homeFolders: null,
      homeEditorOpen: false,
      homeHintDismissed: false,
      notifications: null,
      unreadInbox: 0,
      notificationPrePromptDismissed: false,
      recording: IDLE_RECORDING,

      currentRelPath: () => {
        const stack = get().folderStack;
        return stack.length === 0 ? "" : stack[stack.length - 1].relPath;
      },

      refreshGrant: async () => {
        const resolve = async () => {
          const grant = await iosGetLibraryGrant();
          if (grant.granted) {
            set({ grantState: "granted", libraryName: grant.displayName });
          } else {
            set({ grantState: "ungranted", libraryName: "" });
          }
        };
        try {
          await resolve();
        } catch {
          // A thrown error could be a transient IPC hiccup, not necessarily a
          // stale bookmark — retry once before concluding stale. A genuinely
          // stale bookmark fails consistently on retry; a one-off hiccup
          // usually succeeds.
          try {
            await resolve();
          } catch {
            set({ grantState: "stale" });
          }
        }
      },

      pickFolder: async () => {
        const grant = await iosPickLibraryFolder();
        if (!grant.granted) {
          // Dismissing the picker resolves without a grant. Reporting it
          // matters: silently doing nothing is indistinguishable from a broken
          // button, which is exactly how a genuine bridge failure presented.
          throw new Error("No folder was selected");
        }
        set({
          grantState: "granted",
          libraryName: grant.displayName,
          folderStack: [],
          openDoc: null,
          docStack: [],
        });
      },

      clearGrant: async () => {
        await iosClearLibraryGrant();
        set({
          grantState: "ungranted",
          libraryName: "",
          folderStack: [],
          openDoc: null,
          docStack: [],
        });
      },

      enterFolder: (ref) =>
        set((s) => ({ folderStack: [...s.folderStack, ref], openDoc: null })),

      jumpToFolder: (ref) => set({ folderStack: [ref], openDoc: null }),

      openDocument: (ref) =>
        set((s) => ({
          openDoc: ref,
          // Opening from the listing starts a new trail — whatever chain of
          // links led somewhere earlier is finished, and Back should return
          // to the folder rather than replay it.
          docStack: [],
          recentlyRead: [
            ref.relPath,
            ...s.recentlyRead.filter((p) => p !== ref.relPath),
          ].slice(0, RECENT_CAP),
        })),

      openLinkedDocument: (ref) =>
        set((s) => ({
          openDoc: ref,
          // A link to the page you are already on is not a step — pushing it
          // would make Back appear to do nothing.
          docStack:
            s.openDoc && s.openDoc.relPath !== ref.relPath
              ? [...s.docStack, s.openDoc].slice(-DOC_STACK_CAP)
              : s.docStack,
          recentlyRead: [
            ref.relPath,
            ...s.recentlyRead.filter((p) => p !== ref.relPath),
          ].slice(0, RECENT_CAP),
        })),

      closeDocument: () => set({ openDoc: null, docStack: [] }),

      goBack: () => {
        const { openDoc, folderStack, docStack, homeEditorOpen } = get();
        if (homeEditorOpen) {
          set({ homeEditorOpen: false });
          return true;
        }
        // Walk the link trail before leaving the document. Following three
        // links and pressing Back should retrace them, not drop straight out
        // to the folder listing.
        if (openDoc && docStack.length > 0) {
          set({ openDoc: docStack[docStack.length - 1], docStack: docStack.slice(0, -1) });
          return true;
        }
        if (openDoc) {
          set({ openDoc: null, docStack: [] });
          return true;
        }
        if (folderStack.length > 0) {
          set({ folderStack: folderStack.slice(0, -1) });
          return true;
        }
        return false;
      },

      setSortMode: (mode) =>
        set((s) => ({ folderViews: withFolderView(s.folderViews, screenKeyOf(s.folderStack), { sortMode: mode }) })),
      setGroupMode: (mode) =>
        set((s) => ({ folderViews: withFolderView(s.folderViews, screenKeyOf(s.folderStack), { groupMode: mode }) })),

      goToDepth: (depth) =>
        set((s) => ({
          folderStack: s.folderStack.slice(0, Math.max(0, depth)),
          openDoc: null,
          docStack: [],
        })),

      setViewMode: (mode) =>
        set((s) => ({ folderViews: withFolderView(s.folderViews, screenKeyOf(s.folderStack), { viewMode: mode }) })),
      setImageMaxPixel: (v) => set({ imageMaxPixel: v }),
      // Clamped rather than trusted: a value outside 0-1 is not a preference,
      // it is a bug, and it would reach CGImageDestination as one.
      setImageQuality: (v) => set({ imageQuality: Math.min(1, Math.max(0.1, v)) }),
      setInlineImagesEnabled: (v) => set({ inlineImagesEnabled: v }),

      loadPinnedPaths: async () => {
        try {
          const raw = await iosReadFile(PINS_FILE_REL_PATH);
          set({ pinnedPaths: parsePinsFileContent(raw) });
        } catch {
          // Missing pins.json (fresh library, or a library never opened by a
          // build with this feature) — resolve to an empty set, never throw.
          set({ pinnedPaths: [] });
        }
      },

      loadHomeFolders: async () => {
        try {
          set({ homeFolders: parseHomeFileContent(await iosReadFile(HOME_FILE_REL_PATH)) });
        } catch {
          set({ homeFolders: null });
        }
      },

      setOnHome: async (relPath, shown, rootEntries) => {
        // Read-modify-write against the FILE, as `togglePin` does: another
        // device may have changed it since this one read it.
        let current: string[] | null = null;
        try {
          current = parseHomeFileContent(await iosReadFile(HOME_FILE_REL_PATH));
        } catch {
          current = null;
        }
        // No file yet: start from what Home shows by default, so the first
        // choice adds to the Inbox rather than replacing it.
        const base = current ?? get().homeFolders ?? defaultHomeFolders(rootEntries);
        const next = applyHomeChange(base, relPath, shown, rootEntries);
        await iosEnsureDirectory(".notesage");
        await iosWriteFile(HOME_FILE_REL_PATH, serializeHomeFileContent(next));
        set({ homeFolders: next });
      },

      setRecording: (patch) => set((s) => ({ recording: { ...s.recording, ...patch } })),

      refreshNotificationStatus: async (sendTemplates = false) => {
        try {
          set({
            notifications: sendTemplates
              ? await iosNotificationSetPrefs({ templates: notificationTemplates() })
              : await iosNotificationStatus(),
          });
        } catch {
          set({ notifications: null });
        }
      },

      requestNotifications: async () => {
        try {
          const status = await iosNotificationRequest();
          if (status.authorization === "authorized") {
            set({
              notifications: await iosNotificationSetPrefs({
                badge: true,
                newItems: true,
                templates: notificationTemplates(),
              }),
            });
            void get().refreshUnread();
          } else {
            set({ notifications: status });
          }
        } catch {
          // No native side: nothing to ask.
        }
      },

      setNotificationPref: async (patch) => {
        try {
          set({ notifications: await iosNotificationSetPrefs({ ...patch, templates: notificationTemplates() }) });
          if (patch.badge) void get().refreshUnread();
        } catch {
          // No native side.
        }
      },

      refreshUnread: async (markSeen = false) => {
        try {
          set({ unreadInbox: await iosInboxUnreadCount(markSeen) });
        } catch {
          // No native side (desktop dev, tests): the count stays as it was.
        }
      },

      dismissNotificationPrePrompt: () => set({ notificationPrePromptDismissed: true }),

      openHomeEditor: () => set({ homeEditorOpen: true }),
      closeHomeEditor: () => set({ homeEditorOpen: false }),
      dismissHomeHint: () => set({ homeHintDismissed: true }),


      rememberScroll: (relPath, offset) =>
        set((s) => ({ scrollOffsets: { ...s.scrollOffsets, [relPath]: offset } })),

      applyReadingReset: (relPath, resetAt) =>
        set((s) => {
          const readingProgress = { ...s.readingProgress };
          delete readingProgress[relPath];
          const speechPositions = { ...s.speechPositions };
          delete speechPositions[relPath];
          const inboxOpened = { ...s.inboxOpened };
          delete inboxOpened[relPath];
          return { readingProgress, speechPositions, inboxOpened, readingResets: withReset(s.readingResets, relPath, resetAt) };
        }),

      markInboxOpened: (relPath) =>
        set((s) => (s.inboxOpened[relPath] ? {} : { inboxOpened: { ...s.inboxOpened, [relPath]: true as const } })),
      recordReadingReset: (relPath, resetAt) =>
        set((s) => ({ readingResets: withReset(s.readingResets, relPath, resetAt) })),

      rememberReadingProgress: (relPath, fraction) => {
        const clamped = Math.min(1, Math.max(0, fraction));
        // Only ever forward: scrolling back up to re-read a line must not
        // un-read the article. Checked BEFORE `set` — returning `{}` from an
        // updater still notifies every subscriber, and the persist middleware
        // then serialises the whole slice to localStorage on each scroll frame
        // (review finding). A no-op must be a true no-op.
        if (clamped <= (get().readingProgress[relPath] ?? 0)) return;
        set((s) => {
          const next = { ...s.readingProgress, [relPath]: clamped };
          const keys = Object.keys(next);
          if (keys.length > MAX_READING_PROGRESS) {
            for (const stale of keys.slice(0, keys.length - MAX_READING_PROGRESS)) delete next[stale];
          }
          return { readingProgress: next };
        });
      },
      setListDensity: (density) =>
        set((s) => ({ folderViews: withFolderView(s.folderViews, screenKeyOf(s.folderStack), { listDensity: density }) })),

      rememberSpeechVoice: (language, voiceId) =>
        set((s) => ({ speechVoices: { ...s.speechVoices, [language]: voiceId } })),

      setSpeechRate: (rate) => set((s) => ({ speechRate: rate, speech: s.speech ? { ...s.speech, rate } : s.speech })),

      setSpeech: (patch) =>
        set((s) => {
          if (patch === null) return { speech: null };
          if (!s.speech) {
            // A fresh session must name its document; a stray patch with no
            // session to apply to is dropped rather than inventing one.
            if (!patch.relPath) return {};
            return {
              speech: {
                relPath: patch.relPath,
                title: patch.title ?? "",
                playing: patch.playing ?? false,
                index: patch.index ?? 0,
                total: patch.total ?? 0,
                rate: patch.rate ?? 1.0,
                language: patch.language ?? null,
              },
            };
          }
          return { speech: { ...s.speech, ...patch } };
        }),

      rememberSpeechPosition: (relPath, index) =>
        set((s) => {
          const next = { ...s.speechPositions, [relPath]: index };
          // Capped like the other durable maps in the app: without it every
          // path ever listened to accumulates forever. Insertion order is
          // oldest-first, and re-writing a key keeps its original slot, so the
          // article being listened to now is never the one evicted.
          const keys = Object.keys(next);
          if (keys.length > MAX_SPEECH_POSITIONS) {
            for (const stale of keys.slice(0, keys.length - MAX_SPEECH_POSITIONS)) {
              delete next[stale];
            }
          }
          return { speechPositions: next };
        }),

      togglePin: async (relPath) => {
        // Read-modify-write against the file rather than the cached array:
        // this file is shared with the desktop, and a stale in-memory copy
        // would silently drop pins made there since app launch.
        let current: string[] = [];
        try {
          current = parsePinsFileContent(await iosReadFile(PINS_FILE_REL_PATH));
        } catch {
          current = [];
        }
        const next = current.includes(relPath)
          ? current.filter((p) => p !== relPath)
          : [...current, relPath];
        // `.notesage/` may not exist in a library the desktop has never
        // written to. `iosEnsureDirectory` is idempotent (no dedupe), so this
        // is safe on every call.
        await iosEnsureDirectory(".notesage");
        await iosWriteFile(PINS_FILE_REL_PATH, serializePinsFileContent(next));
        set({ pinnedPaths: next });
      },

      rewritePath: async (from, to) => {
        if (from === to) return;
        // The path itself, and — when it is a folder — everything under it:
        // a renamed folder takes its notes' progress, recents, pins and
        // views with it. The `/` boundary keeps "Old" from touching "Older".
        const under = (p: string) => p === from || p.startsWith(`${from}/`);
        const swap = (p: string) => (under(p) ? `${to}${p.slice(from.length)}` : p);
        // A moved entry replaces whatever already sits at its new key (a
        // deleted document's stale memory): the document that was just
        // renamed is the live one, never the other way round.
        const moveRef = <R extends { relPath: string; name: string }>(ref: R): R => {
          const relPath = swap(ref.relPath);
          return { ...ref, relPath, name: relPath.slice(relPath.lastIndexOf("/") + 1) };
        };
        const swapKeys = <V,>(map: Record<string, V>): Record<string, V> => {
          const moved = Object.entries(map).filter(([k]) => under(k)).map(([k, v]) => [swap(k), v] as const);
          const taken = new Set(moved.map(([k]) => k));
          const kept = Object.entries(map).filter(([k]) => !under(k) && !taken.has(k));
          return Object.fromEntries([...kept, ...moved]);
        };

        set((s) => {
          // A renamed entry replaces any entry already at the new name (a
          // deleted folder's stale memory), and counts as the newest.
          const moved = s.folderViews.filter((e) => under(e.relPath)).map((e) => ({ ...e, relPath: swap(e.relPath) }));
          const taken = new Set(moved.map((e) => e.relPath));
          const kept = s.folderViews.filter((e) => !under(e.relPath) && !taken.has(e.relPath));
          return {
            folderViews: [...kept, ...moved],
            recentlyRead: [...new Set(s.recentlyRead.map(swap))],
            // A document reference carries its name too; a rename moves both
            // in one update, so a Reader keyed by the path never remounts
            // showing the old title over the new path.
            openDoc: s.openDoc && under(s.openDoc.relPath) ? moveRef(s.openDoc) : s.openDoc,
            docStack: s.docStack.map((d) => (under(d.relPath) ? moveRef(d) : d)),
            speechPositions: swapKeys(s.speechPositions),
            readingResets: swapKeys(s.readingResets),
            speech: s.speech && under(s.speech.relPath) ? { ...s.speech, relPath: swap(s.speech.relPath) } : s.speech,
            readingProgress: swapKeys(s.readingProgress),
            inboxOpened: swapKeys(s.inboxOpened),
            // Scroll offsets are keyed by path too; a stale key would restore
            // the wrong position and never be collected.
            scrollOffsets: swapKeys(s.scrollOffsets),
          };
        });

        // A Home folder renamed here keeps its place on Home: the same
        // read-modify-write, only when the old name is listed.
        try {
          const home = parseHomeFileContent(await iosReadFile(HOME_FILE_REL_PATH));
          if (home?.includes(from)) {
            const next = home.map(swap);
            await iosWriteFile(HOME_FILE_REL_PATH, serializeHomeFileContent(next));
            set({ homeFolders: next });
          }
        } catch {
          // No home.json, or unreadable: nothing to carry over.
        }

        // The pins FILE is the source of truth and is shared with the
        // desktop — updating only the cached array would drop the pin the
        // next time either side read the file. Read-modify-write, same as
        // `togglePin`, and only when this path is actually pinned so an
        // ordinary move does not rewrite a shared file for nothing.
        let current: string[] = [];
        try {
          current = parsePinsFileContent(await iosReadFile(PINS_FILE_REL_PATH));
        } catch {
          return;
        }
        if (!current.some(under)) return;
        const next = current.map(swap);
        // The rename or move on disk has already happened; a pins file that
        // cannot be written must not turn it into a failure. The next
        // read-modify-write of the file catches up.
        try {
          await iosEnsureDirectory(".notesage");
          await iosWriteFile(PINS_FILE_REL_PATH, serializePinsFileContent(next));
          set({ pinnedPaths: next });
        } catch {
          // Reported nowhere on purpose: see above.
        }
      },

      forgetPath: async (relPath) => {
        const under = (p: string) => p === relPath || p.startsWith(`${relPath}/`);
        const dropKeys = <V,>(map: Record<string, V>): Record<string, V> =>
          Object.fromEntries(Object.entries(map).filter(([k]) => !under(k)));
        set((s) => ({
          folderViews: s.folderViews.filter((e) => !under(e.relPath)),
          scrollOffsets: dropKeys(s.scrollOffsets),
          readingProgress: dropKeys(s.readingProgress),
          inboxOpened: dropKeys(s.inboxOpened),
          speechPositions: dropKeys(s.speechPositions),
          readingResets: dropKeys(s.readingResets),
          recentlyRead: s.recentlyRead.filter((p) => !under(p)),
          docStack: s.docStack.filter((d) => !under(d.relPath)),
        }));
        // The shared pins file too, only when something under the path is
        // pinned — the same read-modify-write as `togglePin`.
        let current: string[] = [];
        try {
          current = parsePinsFileContent(await iosReadFile(PINS_FILE_REL_PATH));
        } catch {
          return;
        }
        if (!current.some(under)) return;
        const next = current.filter((p) => !under(p));
        try {
          await iosWriteFile(PINS_FILE_REL_PATH, serializePinsFileContent(next));
          set({ pinnedPaths: next });
        } catch {
          // The delete has already happened; the pins file catches up on
          // the next read-modify-write.
        }
      },

      reset: () =>
        set({
          grantState: "unknown",
          libraryName: "",
          folderStack: [],
          openDoc: null,
          docStack: [],
          recentlyRead: [],
          sortMode: "name",
          groupMode: "none",
          viewMode: "list",
          folderViews: [],
          pinnedPaths: [],
          scrollOffsets: {},
          speechPositions: {},
          speechVoices: {},
          readingProgress: {},
        inboxOpened: {},
          readingResets: {},
          listDensity: "comfortable",
          homeFolders: null,
          homeEditorOpen: false,
          homeHintDismissed: false,
          notifications: null,
          unreadInbox: 0,
          notificationPrePromptDismissed: false,
          recording: IDLE_RECORDING,
            }),
    }),
    {
      name: "mobile-store",
      // Persisted state is whatever an earlier build wrote. A field whose
      // shape changed (folderViews was briefly a map) must not take the
      // whole app down at launch: drop what does not fit and start that
      // field over.
      merge: (persisted, current) => {
        const p = { ...(persisted as Partial<MobileStore> | undefined) };
        if (!Array.isArray(p.folderViews)) delete p.folderViews;
        return { ...current, ...p };
      },
      // The grant is authoritative on the backend; recents + sort persist.
      // The grant is authoritative on the backend; the durable preferences
      // are recents, the sort order, and the chosen view mode.
      partialize: (s) => ({
        recentlyRead: s.recentlyRead,
        speechPositions: s.speechPositions,
        speechVoices: s.speechVoices,
        speechRate: s.speechRate,
        readingProgress: s.readingProgress,
        inboxOpened: s.inboxOpened,
        readingResets: s.readingResets,
        listDensity: s.listDensity,
        homeHintDismissed: s.homeHintDismissed,
        notificationPrePromptDismissed: s.notificationPrePromptDismissed,
        sortMode: s.sortMode,
        groupMode: s.groupMode,
        viewMode: s.viewMode,
        folderViews: s.folderViews,
        imageMaxPixel: s.imageMaxPixel,
        imageQuality: s.imageQuality,
        inlineImagesEnabled: s.inlineImagesEnabled,
      }),

    },
  ),
);
