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
} from "@/lib/ios-api";
import {
  PINS_FILE_REL_PATH,
  parsePinsFileContent,
  serializePinsFileContent,
} from "@/lib/pins-file";

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
  /** List vs. gallery layout for the library listing; global (not per-folder),
   *  persists across app relaunches. */
  viewMode: ViewMode;
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
  /** Switch between list and gallery layouts. */
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

  /** Pin or unpin a root-relative path, writing the shared
   *  `.notesage/pins.json` the desktop reads. Re-reads the file first so a
   *  pin made on the desktop since the last load is not clobbered. */
  togglePin: (relPath: string) => Promise<void>;

  /** Test/reset helper. */
  reset: () => void;
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
      imageMaxPixel: 1600,
      imageQuality: 0.8,
      inlineImagesEnabled: true,
      pinnedPaths: [],
      scrollOffsets: {},

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
        const { openDoc, folderStack, docStack } = get();
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

      setSortMode: (mode) => set({ sortMode: mode }),
      setGroupMode: (mode) => set({ groupMode: mode }),

      goToDepth: (depth) =>
        set((s) => ({
          folderStack: s.folderStack.slice(0, Math.max(0, depth)),
          openDoc: null,
          docStack: [],
        })),

      setViewMode: (mode) => set({ viewMode: mode }),
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


      rememberScroll: (relPath, offset) =>
        set((s) => ({ scrollOffsets: { ...s.scrollOffsets, [relPath]: offset } })),

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
          pinnedPaths: [],
          scrollOffsets: {},
            }),
    }),
    {
      name: "mobile-store",
      // The grant is authoritative on the backend; recents + sort persist.
      // The grant is authoritative on the backend; the durable preferences
      // are recents, the sort order, and the chosen view mode.
      partialize: (s) => ({
        recentlyRead: s.recentlyRead,
        sortMode: s.sortMode,
        groupMode: s.groupMode,
        viewMode: s.viewMode,
        imageMaxPixel: s.imageMaxPixel,
        imageQuality: s.imageQuality,
        inlineImagesEnabled: s.inlineImagesEnabled,
      }),

    },
  ),
);
