import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, FolderOpen, RefreshCw, AlertCircle } from "lucide-react";
import type { FileEntry } from "@/lib/tauri";
import { iosListDirectory } from "@/lib/ios-api";
import { toast } from "sonner";
import { useMobileStore } from "@/stores/mobile-store";
import { FileRow } from "./FileRow";
import { Button } from "@/components/ui/button";
import { Island, ChromeButton, SearchIsland, CONTENT_INSETS } from "./Chrome";
import { useNativeChrome } from "./useNativeChrome";

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

  const currentRelPath = folderStack.length === 0 ? "" : folderStack[folderStack.length - 1].relPath;
  const currentName = folderStack.length === 0 ? libraryName || "Notesage" : folderStack[folderStack.length - 1].name;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  // Drives the refresh icon's spin. Kept spinning for a beat even when the
  // listing returns instantly — an animation too short to see reads as a dead
  // button.
  const [refreshing, setRefreshing] = useState(false);

  // Generation counter: rapid folder navigation can resolve listings out of
  // order — a superseded load must not put a stale listing under the new
  // breadcrumb (same idiom as the Reader's loader).
  const loadIdRef = useRef(0);
  const load = useCallback(async (viaRefresh = false) => {
    const loadId = ++loadIdRef.current;
    if (viaRefresh) setRefreshing(true);
    else setState({ status: "loading" });
    const spinFloor = viaRefresh ? new Promise((r) => setTimeout(r, 600)) : null;
    try {
      const entries = await iosListDirectory(currentRelPath);
      if (loadIdRef.current !== loadId) return;
      // Hidden entries (dotfiles, `.notesage/`, `.git/`) are excluded outright
      // — mirroring the desktop's default — as defense-in-depth on top of the
      // native layer's own filter: internal machinery and comment sidecars
      // must not be one tap away in the browser.
      const visible = entries.filter((e) => !e.hidden && !e.name.startsWith("."));
      // Folders first, then files, each alphabetical — mirrors desktop order.
      const sorted = visible.sort((a, b) => {
        if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      setState({ status: "ready", entries: sorted });
    } catch (err) {
      if (loadIdRef.current !== loadId) return;
      setState({ status: "error", message: String(err) });
    } finally {
      if (spinFloor) await spinFloor;
      setRefreshing(false);
    }
  }, [currentRelPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const onActivate = (entry: FileEntry) => {
    if (entry.is_directory) {
      enterFolder({ relPath: entry.path, name: entry.name });
    } else {
      openDocument({ relPath: entry.path, name: entry.name });
    }
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
          ? {
              id: "back",
              icon: "chevron.backward",
              menu: ancestors.map((f, depth) => ({ id: `jump-${depth}`, title: f.name })),
            }
          : { id: "pick", icon: "folder" },
      topRight: { id: "refresh", icon: "arrow.clockwise", busy: refreshing },
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
      refresh: () => void load(true),
    },
  );

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

  return (
    <div className="relative h-full w-full bg-background">
      {/* Full-height scroller — content flows edge to edge and passes UNDER
          the translucent top/bottom chrome (Apple Notes / Quiet Composer
          pattern, issue #581). The large title lives IN the content, so it
          scrolls away like Notes' does. */}
      <div
        key={currentRelPath}
        className="view-enter absolute inset-0 overflow-y-auto"
        style={CONTENT_INSETS}
      >
        <div className="px-4 pb-1 pt-2">
          <h1 className="truncate text-2xl font-bold text-foreground">{currentName}</h1>
          {folderStack.length > 0 && (
            <nav className="mt-0.5 flex items-center gap-1 overflow-x-auto text-xs text-muted-foreground">
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

        {state.status === "loading" && <BrowserSkeleton />}
        {state.status === "error" && <BrowserError message={state.message} onRetry={() => void load()} />}
        {state.status === "ready" &&
          (() => {
            const visible = query
              ? state.entries.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
              : state.entries;
            if (state.entries.length === 0) return <EmptyFolder />;
            if (visible.length === 0)
              return (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nothing matches "{query}"
                </p>
              );
            return (
              <ul>
                {visible.map((entry) => (
                  <li key={entry.path}>
                    <FileRow entry={entry} onActivate={onActivate} />
                  </li>
                ))}
              </ul>
            );
          })()}
      </div>

      {/* Button islands (iOS 26 / Notes layout): nav top-left, actions
          top-right, passive status bottom-center. */}
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
      <Island corner="top-right">
        <ChromeButton label="Refresh" onClick={() => void load(true)}>
          <RefreshCw strokeWidth={1.5} className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </ChromeButton>
      </Island>
      )}
      {ancestorMenuOpen &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              aria-hidden
              onClick={() => setAncestorMenuOpen(false)}
            />
            <div
              role="menu"
              aria-label="Jump to folder"
              className="island-glass morph-from-button fixed left-3 z-50 min-w-44 rounded-2xl py-1"
              style={{ top: "max(0.5rem, env(safe-area-inset-top))" }}
            >
              {[{ relPath: "", name: libraryName || "Notesage" }, ...folderStack.slice(0, -1)].map(
                (f, depth) => (
                  <button
                    key={f.relPath || "__root"}
                    type="button"
                    role="menuitem"
                    className="ios-press-row block w-full px-4 py-2.5 text-left text-sm text-foreground"
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
      <p className="mt-3 text-sm font-medium text-foreground">Nothing here yet</p>
      <p className="mt-1 text-xs text-muted-foreground">This folder is empty.</p>
    </div>
  );
}

function BrowserError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <AlertCircle strokeWidth={1.25} className="h-8 w-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium text-foreground">Couldn't open this folder</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground break-words">{message}</p>
      <Button variant="outline" size="sm" className="ios-press-row mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
