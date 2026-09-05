import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, FolderOpen, Plus, FolderPlus, ArrowDownAZ, Clock, LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import type { FileEntry } from "@/lib/tauri";
import { iosListDirectory, iosCreateDirectory, iosTextPrompt, iosQuickLook, iosOpenSettings } from "@/lib/ios-api";
import { toast } from "sonner";
import { useMobileStore, resolveFolderView, screenKeyOf } from "@/stores/mobile-store";
import { stopSpeech, toggleSpeech } from "@/lib/speech-controller";
import type { EntryActionContext } from "@/lib/mobile-entry-actions";
import { FileRow, classifyFile } from "./FileRow";
import { ArticleRow } from "./ArticleRow";
import { GalleryView } from "./GalleryView";
import { InboxCard, RecordingsCard } from "./InboxCard";
import { AllFoldersRow } from "./AllFoldersRow";
import { HomeHint } from "./HomeHint";
import { NotificationPrePrompt } from "./NotificationPrePrompt";
import { RecordingBar } from "./RecordingBar";
import { formatElapsed, pauseRecording, resumeRecording, startRecording, stopRecording } from "@/lib/recording-controller";
import { BrowserSkeleton, BrowserError } from "./BrowserStates";
import { defaultHomeFolders } from "@/lib/home-file";
import { RECORDINGS_FOLDER_NAME } from "@/lib/notes-root";
import { Button } from "@/components/ui/button";
import { Island, ChromeButton, SearchIsland, CONTENT_INSETS } from "./Chrome";
import { useNativeChrome, useA11yPrefs, a11yRootProps } from "./useNativeChrome";
import { INLINE_SWEEP_EVENT } from "./useInlineSweep";
import { t, getFormatLocale } from "@/lib/i18n";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";
import { pullInboxProgress } from "@/lib/inbox-progress-sync";
import { useLocale } from "@/lib/useLocale";

/** The share extension's landing folder — see `@/lib/inbox` for why this is
 *  never translated. */
const INBOX_NAME = INBOX_FOLDER_NAME;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: FileEntry[] };

/**
 * Mobile library browser — push-navigation list over the granted folder
 * (PRD task #13). Folders push a level; files open the reader.
 */
export function LibraryBrowser() {
  const libraryName = useMobileStore((s) => s.libraryName);
  const folderStack = useMobileStore((s) => s.folderStack);
  const enterFolder = useMobileStore((s) => s.enterFolder);
  const jumpToFolder = useMobileStore((s) => s.jumpToFolder);

  /**
   * Open Recordings, creating the folder when nothing has made one yet.
   *
   * The card is always on screen, so it has to work before the first
   * recording exists — an always-visible row that says "not found" would be
   * worse than no row at all.
   */
  const openRecordings = useCallback(
    async (exists: boolean) => {
      if (!exists) {
        try {
          await iosCreateDirectory(RECORDINGS_FOLDER_NAME);
        } catch (err) {
          toast.error(t("action.createFolderFailed", { error: String(err) }));
          return;
        }
      }
      jumpToFolder({ relPath: RECORDINGS_FOLDER_NAME, name: RECORDINGS_FOLDER_NAME });
    },
    [jumpToFolder],
  );
  const openDocument = useMobileStore((s) => s.openDocument);
  const goBack = useMobileStore((s) => s.goBack);
  const goToDepth = useMobileStore((s) => s.goToDepth);
  const pickFolder = useMobileStore((s) => s.pickFolder);
  const setSortMode = useMobileStore((s) => s.setSortMode);
  const setGroupMode = useMobileStore((s) => s.setGroupMode);
  const recentlyRead = useMobileStore((s) => s.recentlyRead);
  const pinnedPaths = useMobileStore((s) => s.pinnedPaths);
  const togglePin = useMobileStore((s) => s.togglePin);
  const rewritePath = useMobileStore((s) => s.rewritePath);
  const forgetPath = useMobileStore((s) => s.forgetPath);
  const loadPinnedPaths = useMobileStore((s) => s.loadPinnedPaths);
  const setViewMode = useMobileStore((s) => s.setViewMode);
  const setListDensity = useMobileStore((s) => s.setListDensity);
  const homeFolders = useMobileStore((s) => s.homeFolders);
  const loadHomeFolders = useMobileStore((s) => s.loadHomeFolders);
  const setOnHomeInFile = useMobileStore((s) => s.setOnHome);
  const homeHintDismissed = useMobileStore((s) => s.homeHintDismissed);
  const dismissHomeHint = useMobileStore((s) => s.dismissHomeHint);
  const openHomeEditor = useMobileStore((s) => s.openHomeEditor);
  const notifications = useMobileStore((s) => s.notifications);
  const refreshNotificationStatus = useMobileStore((s) => s.refreshNotificationStatus);
  const requestNotifications = useMobileStore((s) => s.requestNotifications);
  const setNotificationPref = useMobileStore((s) => s.setNotificationPref);
  const refreshUnread = useMobileStore((s) => s.refreshUnread);
  const unreadInbox = useMobileStore((s) => s.unreadInbox);
  const prePromptDismissed = useMobileStore((s) => s.notificationPrePromptDismissed);
  const dismissNotificationPrePrompt = useMobileStore((s) => s.dismissNotificationPrePrompt);
  // Recording (recordings PRD): the island follows the store; the folder
  // `Recordings/` makes "+" record.
  const recordingStatus = useMobileStore((s) => s.recording.status);
  const recordingElapsed = useMobileStore((s) => s.recording.elapsedSecs);
  const recordingLevel = useMobileStore((s) => s.recording.level);
  const recordingInterrupted = useMobileStore((s) => s.recording.interrupted);
  const inlineImagesEnabled = useMobileStore((s) => s.inlineImagesEnabled);
  const setInlineImagesEnabled = useMobileStore((s) => s.setInlineImagesEnabled);
  const imageMaxPixel = useMobileStore((s) => s.imageMaxPixel);
  const setImageMaxPixel = useMobileStore((s) => s.setImageMaxPixel);
  const a11y = useA11yPrefs();
  // Re-render on a language change so every t() below re-evaluates.
  useLocale();

  const currentRelPath = folderStack.length === 0 ? "" : folderStack[folderStack.length - 1].relPath;
  const currentName = folderStack.length === 0 ? libraryName || "Notesage" : folderStack[folderStack.length - 1].name;
  // Two screens list the root: Home (the top of the stack — the Inbox and
  // the folders chosen for it) and All Folders (the root pushed as a level).
  // "Root listing" and "top of the stack" are therefore two questions.
  const atHome = folderStack.length === 0;
  const isRootListing = currentRelPath === "";
  // The key under which this SCREEN remembers its scroll offset and view:
  // Home and All Folders must not share one.
  const screenKey = screenKeyOf(folderStack);
  const inRecordings = currentRelPath === "Recordings";
  // This screen's own view (layout, density, order, grouping), remembered
  // per folder like Finder's — one primitive selector each so a change to
  // another folder's view does not re-render this listing.
  const viewMode = useMobileStore((s) => resolveFolderView(s, screenKey).viewMode);
  const listDensity = useMobileStore((s) => resolveFolderView(s, screenKey).listDensity);
  const sortMode = useMobileStore((s) => resolveFolderView(s, screenKey).sortMode);
  const groupMode = useMobileStore((s) => resolveFolderView(s, screenKey).groupMode);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");

  // Generation counter: rapid folder navigation can resolve listings out of
  // order — a superseded load must not put a stale listing under the new
  // breadcrumb (same idiom as the Reader's loader).
  const loadIdRef = useRef(0);
  const load = useCallback(async (viaRefresh = false) => {
    const loadId = ++loadIdRef.current;
    // A refresh (pull gesture or the bridge event it dispatches) keeps the
    // current listing on screen instead of flashing back to the skeleton —
    // the native UIRefreshControl already shows its own spinner for the
    // duration, so there is no busy state to track here.
    if (!viaRefresh) setState({ status: "loading" });
    try {
      const entries = await iosListDirectory(currentRelPath);
      if (loadIdRef.current !== loadId) return;
      // Hidden entries (dotfiles, `.notesage/`, `.git/`) are excluded outright
      // — mirroring the desktop's default — as defense-in-depth on top of the
      // native layer's own filter: internal machinery and comment sidecars
      // must not be one tap away in the browser.
      const visible = entries.filter((e) => !e.hidden && !e.name.startsWith("."));
      setState({ status: "ready", entries: visible });
      // What the Mac read (or listened to) shows here: merge the shared
      // sidecar into the local store whenever the Inbox is listed.
      if (currentRelPath === INBOX_NAME) void pullInboxProgress();
      // The chosen Home follows the root listing: one small read, so a
      // change made on the iPad shows on the next refresh here.
      if (currentRelPath === "") void loadHomeFolders();
      // The badge is the unread Inbox count: recount whenever the Inbox or
      // the root (its card) is listed. Only the Inbox listing marks its
      // items as seen — Home shows a number, not the items.
      if (currentRelPath === "" || currentRelPath === INBOX_NAME) void refreshUnread(currentRelPath === INBOX_NAME);
    } catch (err) {
      if (loadIdRef.current !== loadId) return;
      setState({ status: "error", message: String(err) });
    }
  }, [currentRelPath, loadHomeFolders, refreshUnread]);

  // Notification status on mount and on every return to the foreground —
  // the user may have just come back from the Settings app.
  useEffect(() => {
    void refreshNotificationStatus(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshNotificationStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshNotificationStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pins live in `<library>/.notesage/pins.json`, written through by the
  // desktop (#652). Read once on mount — mobile is a read-only consumer.
  useEffect(() => {
    void loadPinnedPaths();
  }, [loadPinnedPaths]);

  // Refresh when the app returns to the foreground (#650): a share-extension
  // save happens while the app is backgrounded, so the open folder (Inbox)
  // was stale until re-entered. visibilitychange fires on every return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  // The image sweep (#1.5) runs at the app root, not here — this component
  // unmounts the moment a document opens, and a sweep that stops when the user
  // starts reading is the surface-scoped-listener bug all over again. It
  // announces a rewritten document instead, and the listing reloads so the
  // regenerated thumbnail is picked up.
  useEffect(() => {
    const onSwept = () => void load(true);
    window.addEventListener(INLINE_SWEEP_EVENT, onSwept);
    return () => window.removeEventListener(INLINE_SWEEP_EVENT, onSwept);
  }, [load]);

  // Web pull-to-refresh (#650). The native pull gesture hung off the WEBVIEW's
  // scroll view — but the listing scrolls in this inner div, so that gesture
  // could never fire (removed). This tracks the pull on the real scroller:
  // drag down from the top past the threshold to reload.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Restore the folder's scroll position once its rows exist (#680 follow-up:
  // opening a document unmounts this browser, so the DOM offset is gone by
  // the time we come back). Guarded by a ref so a later refresh — pull, or
  // the foreground reload — never yanks the user back up.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || state.status !== "ready" || state.entries.length === 0) return;
    if (restoredFor.current === screenKey) return;
    restoredFor.current = screenKey;
    const offset = useMobileStore.getState().scrollOffsets[screenKey] ?? 0;
    if (offset > 0) el.scrollTop = offset;
  }, [state, screenKey]);

  // Record the offset as it changes, cheaply: rAF-coalesced, and written to
  // the store rather than React state so scrolling never re-renders the list.
  const scrollTick = useRef(0);
  const onScroll = () => {
    if (scrollTick.current) return;
    scrollTick.current = requestAnimationFrame(() => {
      scrollTick.current = 0;
      const el = scrollerRef.current;
      if (el) useMobileStore.getState().rememberScroll(screenKey, el.scrollTop);
    });
  };
  useEffect(() => () => cancelAnimationFrame(scrollTick.current), []);
  const pullStart = useRef<number | null>(null);
  const [pullPx, setPullPx] = useState(0);
  const [pullBusy, setPullBusy] = useState(false);
  const PULL_TRIGGER = 64;
  const onPullStart = (e: React.TouchEvent) => {
    const el = scrollerRef.current;
    pullStart.current = el && el.scrollTop <= 0 ? e.touches[0].clientY : null;
  };
  const onPullMove = (e: React.TouchEvent) => {
    const el = scrollerRef.current;
    if (pullStart.current === null || !el || el.scrollTop > 0 || pullBusy) return;
    const delta = e.touches[0].clientY - pullStart.current;
    // Rubber-band factor so the indicator trails the finger like UIKit.
    setPullPx(delta > 0 ? Math.min(90, delta * 0.45) : 0);
  };
  const onPullEnd = () => {
    pullStart.current = null;
    if (pullPx >= PULL_TRIGGER && !pullBusy) {
      setPullBusy(true);
      // A floor keeps the spinner visible long enough to read as an action
      // even when the listing returns instantly. One second, not the previous
      // 500ms: `animate-spin` has a 1s period, so half a floor showed half a
      // rotation — enough to look like a circle that twitched rather than one
      // that spun, which is exactly how it was reported.
      const floor = new Promise((r) => setTimeout(r, 1000));
      void Promise.all([load(true), floor]).finally(() => setPullBusy(false));
    }
    setPullPx(0);
  };

  // Sorting happens at render time (#632) so a mode toggle re-orders the
  // listing instantly with no reload. Alphabetical mirrors the desktop
  // (folders first); modified is newest-first with folders and files
  // interleaved, matching the Files app.
  const sortEntries = (entries: FileEntry[]): FileEntry[] => {
    const copy = [...entries];
    if (sortMode === "modified") {
      return copy.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
    }
    return copy.sort((a, b) => {
      if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  };

  // List ↔ gallery view (#633) lives in the "..." view-options menu beside
  // the sort picks (Peter's Files-app design supersedes the standalone
  // toggle the gallery branch shipped). Global preference, not per-folder.
  const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";

  /** Split the (already sorted) entries into labeled sections (#652).
   *  `recent` lifts anything in the app's recently-read list to the top;
   *  `date` buckets by modified date the way Notes does. Folders always
   *  stay in their own leading section — grouping files under date headers
   *  while folders float loose reads as a bug. */
  const groupEntries = (
    entries: FileEntry[],
  ): Array<{ key: string; title: string | null; items: FileEntry[] }> => {
    if (groupMode === "none") return [{ key: "all", title: null, items: entries }];
    const folders = entries.filter((e) => e.is_directory);
    const files = entries.filter((e) => !e.is_directory);
    const sections: Array<{ key: string; title: string | null; items: FileEntry[] }> = [];

    if (groupMode === "pinned") {
      // Pinned FOLDERS belong in the Pinned section too. Previously folders
      // were hoisted into their own leading section before this ran, so
      // pinning a folder wrote to pins.json and then changed nothing on
      // screen — it read as "folders can't be pinned" (Peter, 2026-08-14).
      // The desktop's `pinFile` is path-agnostic, so a folder pin survives
      // the shared file in both directions.
      const pinned = new Set(pinnedPaths);
      const inPinned = entries.filter((e) => pinned.has(e.path));
      const restFolders = folders.filter((e) => !pinned.has(e.path));
      const restFiles = files.filter((e) => !pinned.has(e.path));
      if (inPinned.length > 0) sections.push({ key: "pinned", title: t("section.pinned"), items: inPinned });
      if (restFolders.length > 0)
        sections.push({ key: "folders", title: t("section.folders"), items: restFolders });
      if (restFiles.length > 0) sections.push({ key: "other", title: t("section.allNotes"), items: restFiles });
      return sections;
    }

    // Every other mode keeps folders in their own leading section — grouping
    // files under date headers while folders float loose reads as a bug.
    if (folders.length > 0) sections.push({ key: "folders", title: t("section.folders"), items: folders });

    if (groupMode === "recent") {
      const recent = new Set(recentlyRead);
      const inRecent = files.filter((e) => recent.has(e.path));
      const rest = files.filter((e) => !recent.has(e.path));
      if (inRecent.length > 0) sections.push({ key: "recent", title: t("section.recent"), items: inRecent });
      if (rest.length > 0) sections.push({ key: "other", title: t("section.allNotes"), items: rest });
      return sections;
    }

    if (groupMode === "type") {
      // One section per kind, in a fixed reading order so the listing does
      // not reshuffle as a folder's mix changes. `classifyFile`'s kinds are
      // the source of truth; empty sections are dropped below.
      const order: Array<[ReturnType<typeof classifyFile>, string]> = [
        ["markdown", "Notes"],
        ["text", "Text & Code"],
        ["pdf", "PDFs"],
        ["image", "Images"],
        ["media", "Audio & Video"],
        ["doc", "Documents"],
        ["html", "Web Pages"],
        ["other", "Other"],
      ];
      const byKind = new Map<string, FileEntry[]>();
      for (const file of files) {
        const kind = classifyFile(file.name);
        const list = byKind.get(kind);
        if (list) list.push(file);
        else byKind.set(kind, [file]);
      }
      for (const [kind, title] of order) {
        const items = byKind.get(kind);
        if (items && items.length > 0) sections.push({ key: kind, title, items });
      }
      return sections;
    }

    // Date buckets, newest first — undated entries sink to "Older".
    const now = new Date();
    // "Recently changed" for the last week, then one section per month
    // (#684). Coarser than the old Today / Yesterday / Previous 7 Days, and
    // deliberately so: the rows no longer carry a date line, so the header is
    // now the ONLY place the date shows, and a header that changes every day
    // fragments a folder into slivers. Months are stable and scannable.
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const weekAgo = startOfToday - 6 * 86400;
    const recent: FileEntry[] = [];
    const byMonth = new Map<string, { title: string; sortKey: number; items: FileEntry[] }>();
    for (const file of files) {
      const m = file.modified ?? 0;
      if (m >= weekAgo) {
        recent.push(file);
        continue;
      }
      const d = new Date(m * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      let bucket = byMonth.get(key);
      if (!bucket) {
        bucket = {
          // The year is dropped within the current year, as everywhere else
          // in the app — "August" reads better than "August 2026" in 2026.
          title: d.toLocaleDateString(getFormatLocale(), {
            month: "long",
            year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
          }),
          sortKey: -(d.getFullYear() * 12 + d.getMonth()),
          items: [],
        };
        byMonth.set(key, bucket);
      }
      bucket.items.push(file);
    }
    const months = [...byMonth.entries()]
      .sort((a, b) => a[1].sortKey - b[1].sortKey)
      .map(([key, bucket]) => ({ key, title: bucket.title, items: bucket.items }));
    return [
      ...sections,
      ...(recent.length > 0
        ? [{ key: "recent-changed", title: t("section.recentlyChanged"), items: recent }]
        : []),
      ...months,
    ];
  };

  const onActivate = (entry: FileEntry) => {
    if (entry.is_directory) {
      enterFolder({ relPath: entry.path, name: entry.name });
      return;
    }
    const kind = classifyFile(entry.name);
    if (kind === "media" || kind === "doc") {
      // Native QuickLook: video/audio playback and DOCX/PPTX/EPUB rendering
      // the web reader doesn't do. Presented OVER the browser — no
      // navigation. Falls back to the Reader (its unsupported card) when the
      // native layer is absent (desktop dev, tests).
      void iosQuickLook(entry.path).catch(() =>
        openDocument({ relPath: entry.path, name: entry.name }),
      );
      return;
    }
    openDocument({ relPath: entry.path, name: entry.name });
  };

  // Listen from the hold menu: start reading in place, like the row's own
  // control — the list stays, the audio runs (#833).
  const onListen = (entry: FileEntry) => toggleSpeech(entry);

  // --- Create flow (#586): "+" bottom-right. At the library root only
  // folders may be created (notes live inside project folders — Peter's
  // design), so the tap prompts for a folder name. Inside a folder the tap
  // creates an untitled note IMMEDIATELY (Notes-style — no prompt; the
  // note's title will become the filename once editing lands) and
  // long-press offers New Folder via the native UIMenu.
  const atRoot = isRootListing;
  // Whether the rows on screen (after the search filter) include a document
  // — what the density toggle would act on.
  const listedHasDocuments =
    state.status === "ready" &&
    state.entries.some(
      (e) => !e.is_directory && (!query || e.name.toLowerCase().includes(query.toLowerCase())),
    );

  // The folders Home shows: the file's list, or the defaults when the
  // library has no file yet. Only meaningful over the root listing.
  const rootEntries = isRootListing && state.status === "ready" ? state.entries : [];
  const homeSet = new Set(homeFolders ?? defaultHomeFolders(rootEntries));
  // What the status label counts: the rows on screen, which at Home is the
  // curated set, not the whole root.
  const shownCount =
    state.status !== "ready"
      ? 0
      : atHome && !query
        ? state.entries.filter((e) => !e.is_directory || homeSet.has(e.path)).length
        : state.entries.length;

  // One action set for both layouts (#680) — built here so the pin state and
  // the listing reload are wired once rather than per row.
  const actionContext: EntryActionContext = {
    onListen,
    isPinned: (relPath) => pinnedPaths.includes(relPath),
    togglePin,
    onChanged: () => void load(true),
    onPathMoved: (from, to) => void rewritePath(from, to),
    onPathRemoved: (relPath) => {
      // An article still playing from under the deleted path would keep
      // writing its position back; stop it before forgetting.
      const playing = useMobileStore.getState().speech?.relPath;
      if (playing && (playing === relPath || playing.startsWith(`${relPath}/`))) stopSpeech();
      void forgetPath(relPath);
    },
    isOnHome: (relPath) => homeSet.has(relPath),
    setOnHome: async (relPath, shown) => {
      try {
        await setOnHomeInFile(relPath, shown, rootEntries);
        if (shown) dismissHomeHint();
      } catch (err) {
        toast.error(t("home.updateFailed", { error: String(err) }));
      }
    },
  };

  const promptName = useCallback(async (title: string): Promise<string | null> => {
    try {
      return await iosTextPrompt(title, t("action.name"), t("action.create"));
    } catch {
      // Web fallback (desktop dev, builds without the native layer). Plain,
      // but it is only ever the fallback path.
      return window.prompt(title) ?? null;
    }
  }, []);

  // Slashes would read as nested paths on the Rust side; entered names are a
  // single path segment by definition.
  const cleanName = (raw: string) => raw.trim().replace(/\//g, "-");

  const createNote = useCallback(() => {
    // No prompt AND no file yet: the editor opens on an empty pending note,
    // and the file is only created on save/back when the draft is non-empty
    // (under its title-derived name directly). An accidental "+" tap backs
    // out leaving no trace — Notes semantics.
    const rel = currentRelPath ? `${currentRelPath}/Untitled.md` : "Untitled.md";
    openDocument({ relPath: rel, name: "Untitled.md", isNew: true });
  }, [currentRelPath, openDocument]);

  const createFolder = useCallback(async () => {
    const name = cleanName((await promptName(t("menu.newFolder"))) ?? "");
    if (!name) return;
    const rel = currentRelPath ? `${currentRelPath}/${name}` : name;
    try {
      const finalRel = await iosCreateDirectory(rel);
      await load();
      // Enter the new folder — creating one is almost always to put
      // something in it.
      enterFolder({ relPath: finalRel, name: finalRel.split("/").pop() ?? name });
    } catch (err) {
      toast.error(t("action.createFolderFailed", { error: String(err) }));
    }
  }, [currentRelPath, promptName, load, enterFolder]);

  // The menu's notification section, by what iOS says. A checkmark row while
  // authorization is undecided asks first (this is the "from Settings" route
  // to the one system prompt); a denial shows the way to the Settings app
  // rather than a second attempt iOS would never show.
  const notificationRows = !notifications
    ? []
    : notifications.authorization === "denied"
      ? [{ id: "notify-settings", title: t("menu.notifySettings"), icon: "gear", sectionBreak: true }]
      : [
          { id: "notify-badge", title: t("menu.notifyBadge"), icon: "app.badge", selected: notifications.badge, sectionBreak: true },
          { id: "notify-new", title: t("menu.notifyNew"), icon: "bell", selected: notifications.newItems },
          ...(notifications.backgroundRefresh !== "available"
            ? [{ id: "notify-refresh", title: t("menu.notifyRefresh"), icon: "arrow.clockwise" }]
            : []),
        ];
  const toggleNotification = async (pref: "badge" | "newItems") => {
    if (!notifications) return;
    if (notifications.authorization === "notDetermined") {
      await requestNotifications();
      // A grant turns both on; make the tapped one true regardless, so the
      // row does what it said whatever the defaults become.
      if (useMobileStore.getState().notifications?.authorization === "authorized") await setNotificationPref({ [pref]: true });
      return;
    }
    await setNotificationPref({ [pref]: !notifications[pref] });
  };

  // Native Liquid Glass chrome when the build has it; the web islands below
  // stay as the fallback (desktop dev, tests, older builds).
  // Ancestors for the native back button's long-press UIMenu (Files
  // pattern): root first, then every level above the current folder.
  const ancestors = [
    { relPath: "", name: libraryName || "Notesage" },
    ...folderStack.slice(0, -1),
  ];
  const nativeChrome = useNativeChrome(
    {
      topLeft:
        folderStack.length > 0
          ? { id: "back", icon: "chevron.backward" }
          : { id: "pick", icon: "folder" },
      // Breadcrumb island (#615): current folder on a glass capsule between
      // the corner buttons; tap opens the ancestor jump menu (root first).
      // At the root it is a passive label carrying the library name. The
      // ancestor menu that used to hide behind the back button's long-press
      // moved here — a visible affordance beats a hidden gesture.
      topCenter: {
        title: currentName,
        // The island REPLACES the in-content title + breadcrumb row (they
        // only render on the web fallback) — the path rides as a compact
        // second line.
        subtitle:
          folderStack.length > 0 ? ancestors.map((f) => f.name).join(" › ") : undefined,
        // Ancestors (when nested) plus a PERMANENT Inbox jump: shared items
        // land there, and hunting for the folder in a long root listing was
        // the tedious part (Peter, 2026-08-13). Reachable from any depth.
        menu: [
          ...(folderStack.length > 0
            ? ancestors.map((f, depth) => ({
                id: `jump-${depth}`,
                title: f.name,
                icon: depth === 0 ? "house" : "folder",
              }))
            : []),
          { id: "goto-inbox", title: INBOX_NAME, icon: "tray" },
        ],
      },
      // Files-style "..." view-options menu (Peter's design): view mode on
      // top (List / Gallery, #633), sort selection below its divider, room
      // for advanced options as they arrive. (Tap-to-refresh left this slot
      // in #620 — the `refresh` action below is fired by the native pull
      // gesture, never a button.)
      topRight: {
        id: "view-options",
        icon: "ellipsis",
        menuOnTap: true,
        menu: [
          {
            id: "view-list",
            title: t("menu.list"),
            icon: "list.bullet",
            selected: viewMode === "list",
          },
          {
            id: "view-gallery",
            title: t("menu.gallery"),
            icon: "square.grid.2x2",
            selected: viewMode === "gallery",
          },
          // Density (#836): one line per row in the list, four cards across
          // in the gallery. A checkmark toggle, remembered per folder. Left
          // out of a list of folders alone, where it would change nothing:
          // an option that does nothing reads as a bug.
          ...(viewMode === "gallery" || listedHasDocuments
            ? [
                {
                  id: "view-condensed",
                  title: t("menu.condensed"),
                  icon: "rectangle.compress.vertical",
                  selected: listDensity === "condensed",
                },
              ]
            : []),
          {
            id: "sort-name",
            title: t("menu.sortName"),
            icon: "textformat.abc",
            selected: sortMode === "name",
            sectionBreak: true,
          },
          {
            id: "sort-modified",
            title: t("menu.sortModified"),
            icon: "clock",
            selected: sortMode === "modified",
          },
          {
            id: "group-none",
            title: t("menu.groupNone"),
            icon: "rectangle.grid.1x2",
            selected: groupMode === "none",
            sectionBreak: true,
          },
          {
            id: "group-pinned",
            title: t("menu.groupPinned"),
            icon: "pin.fill",
            selected: groupMode === "pinned",
          },
          {
            id: "group-recent",
            title: t("menu.groupRecent"),
            icon: "clock.arrow.circlepath",
            selected: groupMode === "recent",
          },
          {
            id: "group-date",
            title: t("menu.groupDate"),
            icon: "calendar",
            selected: groupMode === "date",
          },
          {
            id: "group-type",
            title: t("menu.groupType"),
            icon: "doc.on.doc",
            selected: groupMode === "type",
          },
          // Offline images (#2.1). Native menu rather than a settings screen:
          // this app has no settings screen at all — every preference (view,
          // sort, group) is a UIMenu row, and inventing a screen for three
          // options would be a foreign idiom.
          //
          // JPEG quality is deliberately NOT exposed. It stays configurable in
          // the store, but 0.8 is a value nobody can evaluate by eye and
          // fiddling with it has no outcome the user can predict — the size
          // cap is the control that actually changes what they get.
          {
            id: "offline-images",
            title: t("menu.offlineImages"),
            icon: "arrow.down.circle",
            selected: inlineImagesEnabled,
            sectionBreak: true,
          },
          ...(inlineImagesEnabled
            ? ([
                { id: "img-1200", title: t("menu.imageSizeSmall"), icon: "photo", selected: imageMaxPixel === 1200 },
                { id: "img-1600", title: t("menu.imageSizeStandard"), icon: "photo", selected: imageMaxPixel === 1600 },
                { id: "img-2048", title: t("menu.imageSizeLarge"), icon: "photo", selected: imageMaxPixel === 2048 },
                { id: "img-original", title: t("menu.imageSizeOriginal"), icon: "photo.badge.arrow.down", selected: imageMaxPixel === "original" },
              ] as const)
            : []),
          // Notifications: the two preferences, or the way to the Settings
          // app when iOS has them off. Only where there is a native side.
          ...notificationRows,
          // Edit Home (a switch per root folder) is a screen, not a menu —
          // thirty folders in a UIMenu is the wrong tool. Home only.
          ...(atHome
            ? [{ id: "edit-home", title: t("menu.editHome"), icon: "slider.horizontal.3", sectionBreak: true }]
            : []),
        ],
      },
      // Inside Recordings/ the "+" records (two taps from Home to a meeting);
      // everywhere else New Recording is one hold away.
      bottomRight:
        recordingStatus !== "idle"
          ? undefined
          : inRecordings
            ? {
                id: "create-recording",
                icon: "waveform.badge.plus",
                menu: [
                  { id: "create-note", title: t("action.newNote"), icon: "note.text.badge.plus" },
                  { id: "create-folder", title: t("menu.newFolder"), icon: "folder.badge.plus" },
                ],
              }
            : atRoot
              ? {
                  id: "create-folder",
                  icon: "plus",
                  menu: [{ id: "create-recording", title: t("menu.newRecording"), icon: "waveform.badge.plus" }],
                }
              : {
                  // Tap = new note instantly (primaryAction); hold = UIMenu.
                  id: "create-note",
                  icon: "plus",
                  menu: [
                    { id: "create-folder", title: t("menu.newFolder"), icon: "folder.badge.plus" },
                    { id: "create-recording", title: t("menu.newRecording"), icon: "waveform.badge.plus" },
                  ],
                },
      bottomRecorder:
        recordingStatus === "idle"
          ? undefined
          : {
              elapsed: formatElapsed(recordingElapsed),
              paused: recordingStatus !== "recording",
              level: recordingLevel,
              interrupted: recordingInterrupted,
              interruptedLabel: t("recording.interrupted"),
            },
      search: {
        placeholder: t("library.searchFolder"),
        status:
          state.status === "ready"
            ? shownCount === 1
              ? t("library.itemsOne")
              : t("library.items", { count: shownCount })
            : undefined,
      },
    },
    {
      back: () => void goBack(),
      "view-list": () => setViewMode("list"),
      "view-gallery": () => setViewMode("gallery"),
      "view-condensed": () =>
        setListDensity(listDensity === "condensed" ? "comfortable" : "condensed"),
      "sort-name": () => setSortMode("name"),
      "sort-modified": () => setSortMode("modified"),
      "group-none": () => setGroupMode("none"),
      "group-pinned": () => setGroupMode("pinned"),
      "group-recent": () => setGroupMode("recent"),
      "group-date": () => setGroupMode("date"),
      "group-type": () => setGroupMode("type"),
      "offline-images": () => setInlineImagesEnabled(!inlineImagesEnabled),
      "img-1200": () => setImageMaxPixel(1200),
      "img-1600": () => setImageMaxPixel(1600),
      "img-2048": () => setImageMaxPixel(2048),
      "img-original": () => setImageMaxPixel("original"),
      "goto-inbox": () => jumpToFolder({ relPath: INBOX_NAME, name: INBOX_NAME }),
      "edit-home": () => openHomeEditor(),
      "notify-badge": () => void toggleNotification("badge"),
      "notify-new": () => void toggleNotification("newItems"),
      "notify-settings": () => void iosOpenSettings().catch(() => {}),
      "notify-refresh": () => void iosOpenSettings().catch(() => {}),
      "create-note": () => createNote(),
      "create-folder": () => void createFolder(),
      "create-recording": () => void startRecording(),
      "rec-toggle": () => (recordingStatus === "recording" ? pauseRecording() : resumeRecording()),
      "rec-stop": () => void stopRecording(),
      "search-query": (value?: string) => setQuery(value ?? ""),
      "search-close": () => setQuery(""),
      ...Object.fromEntries(
        ancestors.map((_, depth) => [`jump-${depth}`, () => goToDepth(depth)]),
      ),
      pick: () => {
        void pickFolder()
          .then(() => void load())
          .catch((err) => {
            if (!String(err).includes("No folder was selected")) {
              toast.error(t("library.changeFolderFailed", { error: String(err) }));
            }
          });
      },
      // Fired by the native pull-to-refresh gesture (WKWebView's
      // UIRefreshControl), never by a button — the topRight island for tap
      // refresh was removed (issue #620).
      refresh: () => void load(true),
    },
  );

  // Web-fallback create menu (native builds get a UIMenu instead), opened by
  // long-pressing the "+" — same hold pattern as the back button's
  // ancestor menu.
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createHoldTimer = useRef<number | null>(null);
  const createSuppressClick = useRef(false);
  const cancelCreateHold = () => {
    if (createHoldTimer.current !== null) {
      window.clearTimeout(createHoldTimer.current);
      createHoldTimer.current = null;
    }
  };

  // Long-press on Back opens the ancestor-jump menu (Files' pattern: hold
  // the back control, get the path hierarchy). Timer-based: 450ms hold with
  // the resulting click suppressed so releasing over the button doesn't ALSO
  // navigate back one level.
  const [ancestorMenuOpen, setAncestorMenuOpen] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const cancelHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  // The ancestor-jump menu below is portaled to document.body, so it needs
  // its own a11y CSS scope computed here (see the comment at its render site).
  const menuA11yProps = a11yRootProps(a11y);

  return (
    <div className="relative h-full w-full bg-background" {...a11yRootProps(a11y)}>
      {/* Full-height scroller — content flows edge to edge and passes UNDER
          the translucent top/bottom chrome (Apple Notes / Quiet Composer
          pattern, issue #581). The large title lives IN the content, so it
          scrolls away like Notes' does. */}
      <div
        key={screenKey}
        ref={scrollerRef}
        onScroll={onScroll}
        onTouchStart={onPullStart}
        onTouchMove={onPullMove}
        onTouchEnd={onPullEnd}
        onTouchCancel={onPullEnd}
        className="view-enter absolute inset-0 overflow-y-auto"
        style={{
          ...CONTENT_INSETS,
          overscrollBehaviorY: "contain",
          transform:
            pullPx > 0 ? `translateY(${pullPx}px)` : pullBusy ? "translateY(48px)" : undefined,
          transition: pullPx > 0 ? "none" : "transform 260ms cubic-bezier(0.25, 0.8, 0.35, 1)",
        }}
      >
        {/* The large in-content title + breadcrumb row exist ONLY on the web
            fallback: with native chrome the breadcrumb ISLAND carries both
            the folder name and the path (Peter's #615 design — the island
            replaces them, it does not duplicate them). */}
        {!nativeChrome && (
        <div className="px-4 pb-1 pt-2">
          <h1 className="truncate text-[length:calc(1.5rem*var(--ns-a11y-scale,1))] font-bold text-foreground">
            {currentName}
          </h1>
          {folderStack.length > 0 && (
            <nav
              className="mt-0.5 flex items-center gap-1 overflow-x-auto text-[length:calc(0.75rem*var(--ns-a11y-scale,1))] text-muted-foreground"
              style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
            >
              <button type="button" className="ios-press-row shrink-0 rounded px-1 hover:text-foreground" onClick={() => goToDepth(0)}>
                {libraryName || "Notesage"}
              </button>
              {folderStack.map((f, i) => (
                <span key={f.relPath} className="flex shrink-0 items-center gap-1">
                  <span>/</span>
                  <button
                    type="button"
                    className={
                      i === folderStack.length - 1
                        ? "ios-press-row rounded px-1 text-foreground"
                        : "ios-press-row rounded px-1 hover:text-foreground"
                    }
                    onClick={() => goToDepth(i + 1)}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>
        )}

        {state.status === "loading" && <BrowserSkeleton />}
        {state.status === "error" && <BrowserError message={state.message} onRetry={() => void load()} />}
        {state.status === "ready" &&
          (() => {
            const visible = sortEntries(
              query
                ? state.entries.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
                : state.entries,
            );
            // Home is the root listing curated: the Inbox card (when the
            // Inbox is on Home), the chosen folders, and the root's own
            // files. Everything else waits under All Folders. A search
            // looks through the whole root, so a hidden folder is one
            // query away.
            const curated = atHome && !query;
            const inboxEntry =
              curated && homeSet.has(INBOX_NAME)
                ? state.entries.find((e) => e.is_directory && e.name === INBOX_NAME)
                : undefined;
            // The Inbox card sits above whatever the listing shows, so no
            // sort or grouping choice can move it — and it is excluded from
            // the list below so the folder is not offered twice.
            const inboxCard = inboxEntry ? (
              // The count rides along on the listing (#684) — no extra read.
              <InboxCard
                count={inboxEntry.child_count}
                unread={unreadInbox}
                onOpen={() => jumpToFolder({ relPath: INBOX_NAME, name: INBOX_NAME })}
              />
            ) : null;
            // Recordings sits directly under the Inbox and is ALWAYS there,
            // whether or not the folder exists yet: somewhere to look is
            // more use than a card that appears only once you have guessed
            // where your recordings went. Opening it creates the folder when
            // the first recording has not already.
            const recordingsEntry = state.entries.find(
              (e) => e.is_directory && e.name === RECORDINGS_FOLDER_NAME,
            );
            const recordingsCard = curated ? (
              <RecordingsCard
                count={recordingsEntry?.child_count}
                onOpen={() => void openRecordings(recordingsEntry !== undefined)}
              />
            ) : null;
            const listed = curated
              ? visible.filter(
                  (e) =>
                    !e.is_directory ||
                    (homeSet.has(e.path) &&
                      e.name !== INBOX_NAME &&
                      e.name !== RECORDINGS_FOLDER_NAME),
                )
              : visible;
            const homeTail = curated ? (
              <>
                {homeFolders === null &&
                  !homeHintDismissed &&
                  state.entries.some((e) => e.is_directory && e.name !== INBOX_NAME) && (
                    <HomeHint onDismiss={dismissHomeHint} />
                  )}
                <AllFoldersRow onOpen={() => enterFolder({ relPath: "", name: t("home.allFolders") })} />
              </>
            ) : null;
            // Asked when it means something: on the Inbox, once it holds an
            // item, while iOS has not been asked, unless "Not now" was said.
            const prePrompt =
              currentRelPath === INBOX_NAME &&
              state.entries.length > 0 &&
              notifications?.authorization === "notDetermined" &&
              !prePromptDismissed ? (
                <NotificationPrePrompt
                  onTurnOn={() => void requestNotifications()}
                  onNotNow={dismissNotificationPrePrompt}
                />
              ) : null;
            if (state.entries.length === 0) return <EmptyFolder />;
            if (curated && !inboxCard && listed.length === 0)
              return (
                <>
                  <HomeEmpty onChoose={openHomeEditor} />
                  {homeTail}
                </>
              );
            if (visible.length === 0)
              return (
                <p
                  className="px-4 py-10 text-center text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-muted-foreground"
                  style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
                >
                  {t("library.noMatches", { query })}
                </p>
              );
            if (viewMode === "gallery") {
              return (
                <>
                  {inboxCard}
                  {prePrompt}
                <GalleryView
                  entries={listed}
                  currentFolderName={isRootListing ? libraryName || "Notesage" : currentName}
                  theme={theme}
                  onActivate={onActivate}
                  actionContext={actionContext}
                  condensed={listDensity === "condensed"}
                />
                  {homeTail}
                </>
              );
            }
            // Grouped rendering (#652): one <ul> per section with a sticky
            // header. Ungrouped is a single untitled section, so the row
            // markup below has exactly one shape.
            return (
              <>
                {inboxCard}
                {recordingsCard}
                {prePrompt}
                {groupEntries(listed).map((section) => (
                  <section key={section.key}>
                    {section.title && (
                      <h2 className="select-none [-webkit-touch-callout:none] sticky top-0 z-10 bg-background/85 px-4 py-1.5 text-[length:calc(0.75rem*var(--ns-a11y-scale,1))] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                        {section.title}
                      </h2>
                    )}
                    <ul>
                      {section.items.map((entry) => (
                        <li key={entry.path}>
                          {/* A saved article gets the read-later row (#836) —
                              title, site · minutes left, excerpt, thumbnail.
                              It falls back to the plain row by itself when
                              the file is not a capture. */}
                          {!entry.is_directory && /\.html?$/i.test(entry.name) ? (
                            <ArticleRow
                              entry={entry}
                              onActivate={onActivate}
                              onChanged={() => void load(true)}
                              actionContext={actionContext}
                              condensed={listDensity === "condensed"}
                            />
                          ) : (
                            <FileRow
                              entry={entry}
                              onActivate={onActivate}
                              onChanged={() => void load(true)}
                              actionContext={actionContext}
                              condensed={listDensity === "condensed"}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {homeTail}
              </>
            );
          })()}
      </div>

      {/* Pull-to-refresh indicator.

          A SIBLING of the scroller, not a child. It used to live inside it at
          `-top-12`, which put it 48px above the scrollport of an
          `overflow-y-auto` box — the one place a scroll container clips
          outright, since there is no scrolling up into negative space. The
          pull translates the container, and a container's clip region travels
          with it, so the spinner was hidden at every pull distance rather than
          merely at rest. Refresh worked; the spinner had never once been
          drawn (Peter, 2026-08-20).

          Out here the parent is the positioning context and nothing clips it.
          It sits just below the top chrome, in the band the content's own
          `CONTENT_INSETS` padding already keeps empty, so it occupies the gap
          the pull opens instead of overlapping the first row. Painted after
          the scroller (above the list) but before the islands (under the
          chrome), and inert to touch so the gesture still reaches the
          scroller beneath it. */}
      <div
        aria-hidden={!pullBusy && pullPx === 0}
        className="pointer-events-none absolute left-0 right-0 flex h-12 items-center justify-center"
        style={{ top: "calc(3.75rem + env(safe-area-inset-top))" }}
      >
        {/* An SVG ring, not a bordered div.

            The previous spinner was a `rounded-full border-2 border-muted
            border-t-foreground` circle: the moving part was ONE border side
            tinted differently, which depends on `border-t-*` still winning
            the cascade over `border-*` and on a 2px arc being legible at
            20px. Peter saw "just a circle" — no discernible motion. Every
            piece of that chain checked out in the built CSS, so rather than
            keep guessing which link was weak, the arc is now drawn
            explicitly: a track circle plus a quarter-length stroke, with
            `stroke` set directly. Nothing to override, and the arc reads at
            any size. */}
        <svg
          viewBox="0 0 20 20"
          className={pullBusy ? "h-5 w-5 animate-spin" : "h-5 w-5"}
          style={
            pullBusy
              ? undefined
              : {
                  // Fades in over the pull and reaches full opacity exactly at
                  // PULL_TRIGGER, so the gesture's threshold is legible rather
                  // than guessed at.
                  opacity: Math.min(1, pullPx / PULL_TRIGGER),
                  transform: `rotate(${pullPx * 3.2}deg)`,
                }
          }
        >
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="var(--color-muted)"
            strokeWidth="2.5"
          />
          {/* A quarter of the circumference (2πr ≈ 50), so the moving arc is
              a clear segment rather than a hairline tint. */}
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="var(--color-foreground)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="12.5 37.7"
          />
        </svg>
      </div>

      {/* Button islands (iOS 26 / Notes layout): nav top-left, actions
          top-right, passive status bottom-center. */}
      {!nativeChrome && <RecordingBar onStop={() => void stopRecording()} />}
      {!nativeChrome && (
        <Island corner="top-right">
          <ChromeButton
            label={viewMode === "gallery" ? "Switch to list view" : "Switch to gallery view"}
            onClick={() => setViewMode(viewMode === "gallery" ? "list" : "gallery")}
          >
            {viewMode === "gallery" ? (
              <List strokeWidth={1.5} className="h-4 w-4" />
            ) : (
              <LayoutGrid strokeWidth={1.5} className="h-4 w-4" />
            )}
          </ChromeButton>
          <ChromeButton
            label={sortMode === "name" ? "Sort by modified date" : "Sort by name"}
            onClick={() => setSortMode(sortMode === "name" ? "modified" : "name")}
          >
            {sortMode === "name" ? (
              <ArrowDownAZ strokeWidth={1.5} className="h-4 w-4" />
            ) : (
              <Clock strokeWidth={1.5} className="h-4 w-4" />
            )}
          </ChromeButton>
          {atHome && (
            <ChromeButton label={t("menu.editHome")} onClick={() => openHomeEditor()}>
              <SlidersHorizontal strokeWidth={1.5} className="h-4 w-4" />
            </ChromeButton>
          )}
        </Island>
      )}
      {!nativeChrome && (
      <Island corner="top-left" className={ancestorMenuOpen ? "invisible" : undefined}>
        {folderStack.length > 0 ? (
          <div
            onPointerDown={() => {
              cancelHold();
              holdTimer.current = window.setTimeout(() => {
                suppressClick.current = true;
                setAncestorMenuOpen(true);
              }, 450);
            }}
            onPointerUp={cancelHold}
            onPointerCancel={cancelHold}
            onPointerLeave={cancelHold}
            onClickCapture={(e) => {
              if (suppressClick.current) {
                suppressClick.current = false;
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <ChromeButton label="Back" onClick={() => goBack()}>
              <ChevronLeft strokeWidth={1.5} className="h-5 w-5" />
            </ChromeButton>
          </div>
        ) : (
          <ChromeButton
            label={t("library.changeFolder")}
            onClick={() => {
              // The explicit reload IS needed: at the root, currentRelPath
              // stays "" after a re-pick, so the load effect never refires on
              // its own. The generation guard de-races it.
              void pickFolder()
                .then(() => void load())
                .catch((err) => {
                  // Dismissing the picker is a normal outcome, not an error.
                  if (!String(err).includes("No folder was selected")) {
                    toast.error(t("library.changeFolderFailed", { error: String(err) }));
                  }
                });
            }}
          >
            <FolderOpen strokeWidth={1.5} className="h-5 w-5" />
          </ChromeButton>
        )}
      </Island>
      )}
      {!nativeChrome && (
        <Island corner="bottom-right">
          <div
            onPointerDown={() => {
              if (atRoot) return;
              cancelCreateHold();
              createHoldTimer.current = window.setTimeout(() => {
                createSuppressClick.current = true;
                setCreateMenuOpen(true);
              }, 450);
            }}
            onPointerUp={cancelCreateHold}
            onPointerCancel={cancelCreateHold}
            onPointerLeave={cancelCreateHold}
            onClickCapture={(e) => {
              if (createSuppressClick.current) {
                createSuppressClick.current = false;
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <ChromeButton
              label={atRoot ? t("action.newFolderShort") : t("action.newNote")}
              onClick={() => (atRoot ? void createFolder() : createNote())}
            >
              <Plus strokeWidth={1.5} className="h-5 w-5" />
            </ChromeButton>
          </div>
        </Island>
      )}
      {createMenuOpen &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              aria-hidden
              onClick={() => setCreateMenuOpen(false)}
            />
            <div
              role="menu"
              aria-label="Create"
              className="island-glass morph-from-button fixed right-3 z-50 min-w-44 rounded-2xl py-1"
              style={{ bottom: "max(4.25rem, calc(3.5rem + env(safe-area-inset-bottom)))" }}
            >
              <button
                type="button"
                role="menuitem"
                className="ios-press-row flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-foreground"
                onClick={() => {
                  setCreateMenuOpen(false);
                  void createFolder();
                }}
              >
                <FolderPlus strokeWidth={1.5} className="h-4 w-4 text-muted-foreground" />
                New Folder
              </button>
            </div>
          </>,
          document.body,
        )}
      {ancestorMenuOpen &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              aria-hidden
              onClick={() => setAncestorMenuOpen(false)}
            />
            {/* Portaled to document.body — outside the root div's DOM subtree
                above, so the a11y CSS custom properties set there don't
                inherit here. Re-apply them on this menu's own root the same
                way Chrome.tsx's Island does for its portaled content. */}
            <div
              role="menu"
              aria-label="Jump to folder"
              className="island-glass morph-from-button fixed left-3 z-50 min-w-44 rounded-2xl py-1"
              data-a11y-scale={menuA11yProps["data-a11y-scale"]}
              data-a11y-bold={menuA11yProps["data-a11y-bold"]}
              style={{ ...menuA11yProps.style, top: "max(0.5rem, env(safe-area-inset-top))" }}
            >
              {[{ relPath: "", name: libraryName || "Notesage" }, ...folderStack.slice(0, -1)].map(
                (f, depth) => (
                  <button
                    key={f.relPath || "__root"}
                    type="button"
                    role="menuitem"
                    className="ios-press-row block w-full px-4 py-2.5 text-left text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-foreground"
                    style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
                    onClick={() => {
                      setAncestorMenuOpen(false);
                      goToDepth(depth);
                    }}
                  >
                    {f.name}
                  </button>
                ),
              )}
            </div>
          </>,
          document.body,
        )}
      {!nativeChrome && state.status === "ready" && (
        <SearchIsland
          query={query}
          onQueryChange={setQuery}
          placeholder={t("library.searchFolder")}
          status={
            shownCount === 1
              ? t("library.itemsOne")
              : t("library.items", { count: shownCount })
          }
        />
      )}
    </div>
  );
}

function EmptyFolder() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <FolderOpen strokeWidth={1.25} className="h-8 w-8 text-muted-foreground" />
      <p
        className="mt-3 text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-foreground"
        style={{ fontWeight: "max(500, var(--ns-a11y-weight, 400))" }}
      >
        Nothing here yet
      </p>
      <p
        className="mt-1 text-[length:calc(0.75rem*var(--ns-a11y-scale,1))] text-muted-foreground"
        style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
      >
        This folder is empty.
      </p>
    </div>
  );
}

/** Home with nothing on it: the way to choose, and All Folders beneath. */
function HomeEmpty({ onChoose }: { onChoose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 pb-6 pt-16 text-center">
      <FolderOpen strokeWidth={1.25} className="h-8 w-8 text-muted-foreground" />
      <p
        className="mt-3 text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-foreground"
        style={{ fontWeight: "max(500, var(--ns-a11y-weight, 400))" }}
      >
        {t("home.emptyTitle")}
      </p>
      <p
        className="mt-1 text-[length:calc(0.75rem*var(--ns-a11y-scale,1))] text-muted-foreground"
        style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
      >
        {t("home.emptyBody")}
      </p>
      <Button variant="outline" size="sm" className="ios-press-row mt-4" onClick={onChoose}>
        {t("home.chooseFolders")}
      </Button>
    </div>
  );
}
