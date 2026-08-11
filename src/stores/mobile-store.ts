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
} from "@/lib/ios-api";

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

interface MobileStore {
  grantState: GrantState;
  libraryName: string;
  /** Breadcrumb of entered folders; empty = library root. */
  folderStack: FolderRef[];
  /** Open document, or null when browsing. */
  openDoc: OpenDocRef | null;
  /** Most-recently-read relative paths (newest first). */
  recentlyRead: string[];

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
  /** Open a document (records it in recents). */
  openDocument: (ref: OpenDocRef) => void;
  /** Close the open document. */
  closeDocument: () => void;
  /** Back: close the doc if open, else pop one folder level. Returns false at root. */
  goBack: () => boolean;
  /** Jump to a breadcrumb depth (0 = root). */
  goToDepth: (depth: number) => void;

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
      recentlyRead: [],

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
        });
      },

      clearGrant: async () => {
        await iosClearLibraryGrant();
        set({
          grantState: "ungranted",
          libraryName: "",
          folderStack: [],
          openDoc: null,
        });
      },

      enterFolder: (ref) =>
        set((s) => ({ folderStack: [...s.folderStack, ref], openDoc: null })),

      openDocument: (ref) =>
        set((s) => ({
          openDoc: ref,
          recentlyRead: [
            ref.relPath,
            ...s.recentlyRead.filter((p) => p !== ref.relPath),
          ].slice(0, RECENT_CAP),
        })),

      closeDocument: () => set({ openDoc: null }),

      goBack: () => {
        const { openDoc, folderStack } = get();
        if (openDoc) {
          set({ openDoc: null });
          return true;
        }
        if (folderStack.length > 0) {
          set({ folderStack: folderStack.slice(0, -1) });
          return true;
        }
        return false;
      },

      goToDepth: (depth) =>
        set((s) => ({
          folderStack: s.folderStack.slice(0, Math.max(0, depth)),
          openDoc: null,
        })),

      reset: () =>
        set({
          grantState: "unknown",
          libraryName: "",
          folderStack: [],
          openDoc: null,
          recentlyRead: [],
        }),
    }),
    {
      name: "mobile-store",
      // The grant is authoritative on the backend; only recents are persisted.
      partialize: (s) => ({ recentlyRead: s.recentlyRead }),
    },
  ),
);
