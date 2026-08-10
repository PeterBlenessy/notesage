import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, FolderOpen, AlertCircle, Plus, FolderPlus, ArrowDownAZ, Clock, LayoutGrid, List } from "lucide-react";
import type { FileEntry } from "@/lib/tauri";
import { iosListDirectory, iosCreateDirectory, iosTextPrompt } from "@/lib/ios-api";
import { toast } from "sonner";
import { useMobileStore } from "@/stores/mobile-store";
import { FileRow } from "./FileRow";
import { GalleryView } from "./GalleryView";
import { Button } from "@/components/ui/button";
import { Island, ChromeButton, SearchIsland, CONTENT_INSETS } from "./Chrome";
import { useNativeChrome, useA11yPrefs, a11yRootProps } from "./useNativeChrome";

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
  const openDocument = useMobileStore((s) => s.openDocument);
  const goBack = useMobileStore((s) => s.goBack);
  const goToDepth = useMobileStore((s) => s.goToDepth);
  const pickFolder = useMobileStore((s) => s.pickFolder);
  const sortMode = useMobileStore((s) => s.sortMode);
  const setSortMode = useMobileStore((s) => s.setSortMode);
  const viewMode = useMobileStore((s) => s.viewMode);
  const setViewMode = useMobileStore((s) => s.setViewMode);
  const a11y = useA11yPrefs();

  const currentRelPath = folderStack.length === 0 ? "" : folderStack[folderStack.length - 1].relPath;
  const currentName = folderStack.length === 0 ? libraryName || "Notesage" : folderStack[folderStack.length - 1].name;

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
    } catch (err) {
      if (loadIdRef.current !== loadId) return;
      setState({ status: "error", message: String(err) });
    }
  }, [currentRelPath]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const onActivate = (entry: FileEntry) => {
    if (entry.is_directory) {
      enterFolder({ relPath: entry.path, name: entry.name });
    } else {
      openDocument({ relPath: entry.path, name: entry.name });
    }
  };

  // --- Create flow (#586): "+" bottom-right. At the library root only
  // folders may be created (notes live inside project folders — Peter's
  // design), so the tap prompts for a folder name. Inside a folder the tap
  // creates an untitled note IMMEDIATELY (Notes-style — no prompt; the
  // note's title will become the filename once editing lands) and
  // long-press offers New Folder via the native UIMenu.
  const atRoot = folderStack.length === 0;

  const promptName = useCallback(async (title: string): Promise<string | null> => {
    try {
      return await iosTextPrompt(title, "Name", "Create");
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
    const name = cleanName((await promptName("New Folder")) ?? "");
    if (!name) return;
    const rel = currentRelPath ? `${currentRelPath}/${name}` : name;
    try {
      const finalRel = await iosCreateDirectory(rel);
      await load();
      // Enter the new folder — creating one is almost always to put
      // something in it.
      enterFolder({ relPath: finalRel, name: finalRel.split("/").pop() ?? name });
    } catch (err) {
      toast.error(`Couldn't create folder: ${err}`);
    }
  }, [currentRelPath, promptName, load, enterFolder]);

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
        menu:
          folderStack.length > 0
            ? ancestors.map((f, depth) => ({
                id: `jump-${depth}`,
                title: f.name,
                icon: depth === 0 ? "house" : "folder",
              }))
            : undefined,
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
            title: "List",
            icon: "list.bullet",
            selected: viewMode === "list",
          },
          {
            id: "view-gallery",
            title: "Gallery",
            icon: "square.grid.2x2",
            selected: viewMode === "gallery",
          },
          {
            id: "sort-name",
            title: "Alphabetical",
            icon: "textformat.abc",
            selected: sortMode === "name",
            sectionBreak: true,
          },
          {
            id: "sort-modified",
            title: "Date modified",
            icon: "clock",
            selected: sortMode === "modified",
          },
        ],
      },
      bottomRight: atRoot
        ? { id: "create-folder", icon: "plus" }
        : {
            // Tap = new note instantly (primaryAction); hold = UIMenu.
            id: "create-note",
            icon: "plus",
            menu: [{ id: "create-folder", title: "New Folder", icon: "folder.badge.plus" }],
          },
      search: {
        placeholder: "Search this folder",
        status:
          state.status === "ready"
            ? `${state.entries.length} ${state.entries.length === 1 ? "item" : "items"}`
            : undefined,
      },
    },
    {
      back: () => void goBack(),
      "view-list": () => setViewMode("list"),
      "view-gallery": () => setViewMode("gallery"),
      "sort-name": () => setSortMode("name"),
      "sort-modified": () => setSortMode("modified"),
      "create-note": () => createNote(),
      "create-folder": () => void createFolder(),
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
              toast.error(`Couldn't change folder: ${err}`);
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
        key={currentRelPath}
        className="view-enter absolute inset-0 overflow-y-auto"
        style={CONTENT_INSETS}
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
            if (state.entries.length === 0) return <EmptyFolder />;
            if (visible.length === 0)
              return (
                <p
                  className="px-4 py-10 text-center text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-muted-foreground"
                  style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
                >
                  Nothing matches "{query}"
                </p>
              );
            if (viewMode === "gallery") {
              return (
                <GalleryView
                  entries={visible}
                  currentFolderName={currentName}
                  theme={theme}
                  onActivate={onActivate}
                />
              );
            }
            return (
              <ul>
                {visible.map((entry) => (
                  <li key={entry.path}>
                    <FileRow entry={entry} onActivate={onActivate} onChanged={() => void load(true)} />
                  </li>
                ))}
              </ul>
            );
          })()}
      </div>

      {/* Button islands (iOS 26 / Notes layout): nav top-left, actions
          top-right, passive status bottom-center. */}
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
            label="Change library folder"
            onClick={() => {
              // The explicit reload IS needed: at the root, currentRelPath
              // stays "" after a re-pick, so the load effect never refires on
              // its own. The generation guard de-races it.
              void pickFolder()
                .then(() => void load())
                .catch((err) => {
                  // Dismissing the picker is a normal outcome, not an error.
                  if (!String(err).includes("No folder was selected")) {
                    toast.error(`Couldn't change folder: ${err}`);
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
              label={atRoot ? "New folder" : "New note"}
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
          placeholder="Search this folder"
          status={`${state.entries.length} ${state.entries.length === 1 ? "item" : "items"}`}
        />
      )}
    </div>
  );
}

function BrowserSkeleton() {
  return (
    <ul className="animate-pulse" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="h-5 w-5 rounded bg-muted" />
          <div className="h-3 flex-1 rounded bg-muted" style={{ maxWidth: `${50 + ((i * 7) % 40)}%` }} />
        </li>
      ))}
    </ul>
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

function BrowserError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <AlertCircle strokeWidth={1.25} className="h-8 w-8 text-muted-foreground" />
      <p
        className="mt-3 text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-foreground"
        style={{ fontWeight: "max(500, var(--ns-a11y-weight, 400))" }}
      >
        Couldn't open this folder
      </p>
      <p
        className="mt-1 max-w-xs text-[length:calc(0.75rem*var(--ns-a11y-scale,1))] text-muted-foreground break-words"
        style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
      >
        {message}
      </p>
      <Button variant="outline" size="sm" className="ios-press-row mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
