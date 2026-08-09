import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, FolderOpen, RefreshCw, AlertCircle } from "lucide-react";
import type { FileEntry } from "@/lib/tauri";
import { iosListDirectory } from "@/lib/ios-api";
import { useMobileStore } from "@/stores/mobile-store";
import { FileRow } from "./FileRow";
import { Button } from "@/components/ui/button";

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

  const currentRelPath = folderStack.length === 0 ? "" : folderStack[folderStack.length - 1].relPath;
  const currentName = folderStack.length === 0 ? libraryName || "Notesage" : folderStack[folderStack.length - 1].name;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Drives the refresh icon's spin. Kept spinning for a beat even when the
  // listing returns instantly — an animation too short to see reads as a dead
  // button.
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (viaRefresh = false) => {
    if (viaRefresh) setRefreshing(true);
    else setState({ status: "loading" });
    const spinFloor = viaRefresh ? new Promise((r) => setTimeout(r, 600)) : null;
    try {
      const entries = await iosListDirectory(currentRelPath);
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

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Header: back + title + refresh */}
      <header className="flex items-center gap-2 border-b border-border px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {/* 44px (h-11) touch targets — Apple's HIG minimum for tap controls. */}
        {folderStack.length > 0 ? (
          <button
            type="button"
            onClick={() => goBack()}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft strokeWidth={1.5} className="h-5 w-5" />
          </button>
        ) : (
          <div className="flex h-11 w-11 items-center justify-center text-muted-foreground">
            <FolderOpen strokeWidth={1.5} className="h-5 w-5" />
          </div>
        )}
        <h1 className="flex-1 truncate text-base font-semibold text-foreground">{currentName}</h1>
        <button
          type="button"
          onClick={() => void load(true)}
          aria-label="Refresh"
          className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw strokeWidth={1.5} className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </header>

      {/* Breadcrumb (only when nested) */}
      {folderStack.length > 0 && (
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <button type="button" className="shrink-0 hover:text-foreground" onClick={() => goToDepth(0)}>
            {libraryName || "Notesage"}
          </button>
          {folderStack.map((f, i) => (
            <span key={f.relPath} className="flex shrink-0 items-center gap-1">
              <span>/</span>
              <button
                type="button"
                className={i === folderStack.length - 1 ? "text-foreground" : "hover:text-foreground"}
                onClick={() => goToDepth(i + 1)}
              >
                {f.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {state.status === "loading" && <BrowserSkeleton />}
        {state.status === "error" && <BrowserError message={state.message} onRetry={() => void load()} />}
        {state.status === "ready" &&
          (state.entries.length === 0 ? (
            <EmptyFolder />
          ) : (
            <ul>
              {state.entries.map((entry) => (
                <li key={entry.path}>
                  <FileRow entry={entry} onActivate={onActivate} />
                </li>
              ))}
            </ul>
          ))}
      </div>
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
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
