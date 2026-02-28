import { useEffect, useRef, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getBinaryData } from "@/lib/binary-cache";
import { useEpubStore } from "@/stores/epub-store";
import { useSettingsStore } from "@/stores/settings-store";
import { FindBar } from "@/components/editor/FindBar";

type ViewMode = "scroll" | "paginated";

interface EpubViewerProps {
  filePath: string;
  fileName: string;
}

interface TocItem {
  label: string;
  href: string;
  id?: number;
  subitems?: TocItem[];
}

// foliate-js relocate event detail
interface RelocateDetail {
  cfi?: string;
  tocItem?: TocItem | null;
  fraction?: number;
  section?: { current: number; total: number };
  location?: { current: number; next: number; total: number };
}

// foliate-js search result yielded by view.search()
interface FoliateSearchResult {
  cfi?: string;
  excerpt?: { pre: string; match: string; post: string };
  subitems?: Array<{ cfi: string; excerpt: { pre: string; match: string; post: string } }>;
  label?: string;
  progress?: number;
}

// foliate-js View element interface
interface FoliateView extends HTMLElement {
  open(file: File | Blob): Promise<void>;
  init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  close(): void;
  goTo(target: string | number): Promise<unknown>;
  goToFraction(frac: number): Promise<void>;
  select(target: string): Promise<void>;
  deselect(): void;
  prev(): Promise<void>;
  next(): Promise<void>;
  search(opts: { query: string; index?: number }): AsyncGenerator<FoliateSearchResult | "done">;
  clearSearch(): void;
  renderer: FoliateRenderer;
  book: FoliateBook;
  lastLocation?: RelocateDetail;
}

interface FoliateRenderer extends HTMLElement {
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  setStyles(styles: string): void;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  atStart: boolean;
  atEnd: boolean;
  /** 0-indexed page within the current section. Page 0 is the leading margin,
   *  page 1 is the first content page. */
  page: number;
  /** Total number of "pages" including the 2 boundary pages (leading + trailing). */
  pages: number;
  scrolled: boolean;
  /** Array of header DOM elements (one per displayed column). null in scrolled mode. */
  heads: HTMLElement[] | null;
  /** Array of footer DOM elements (one per displayed column). null in scrolled mode. */
  feet: HTMLElement[] | null;
}

interface FoliateBook {
  metadata?: {
    title?: string | Record<string, string>;
    [key: string]: unknown;
  };
  toc?: TocItem[];
}

/** Extract a plain string title from the book metadata */
function getBookTitle(book: FoliateBook): string {
  const t = book.metadata?.title;
  if (!t) return "";
  if (typeof t === "string") return t;
  // Language map — pick first available value
  const vals = Object.values(t);
  return vals[0] ?? "";
}

/** Resolve the effective theme ("light" | "dark") from the settings store value. */
function resolveTheme(theme: "light" | "dark" | "system"): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

/** Generate CSS to inject into the EPUB iframe for the given theme.
 *  The paginator's #background div auto-syncs to the iframe's computed
 *  background after setStyles() is called, so we only need to style the
 *  iframe content — the surrounding page area follows automatically. */
function getContentStyles(isDark: boolean): string {
  if (isDark) {
    const bg = "#222222";
    const fg = "#e0e0e0";
    return `
      html {
        color-scheme: dark;
        background-color: ${bg} !important;
      }
      html, body {
        background-color: ${bg} !important;
        color: ${fg} !important;
      }
      /* Force text color on all block and inline elements — many EPUBs
         hardcode black via inline styles or element-level CSS rules. */
      h1, h2, h3, h4, h5, h6,
      p, div, span, li, dt, dd,
      blockquote, figcaption, caption,
      section, article, aside, nav, header, footer, main,
      b, strong, i, em, u, small, sub, sup,
      th, td, tr, table,
      font, pre, code {
        color: ${fg} !important;
        background-color: transparent !important;
      }
      a:any-link {
        color: #8ab4f8 !important;
      }
      /* Override hardcoded black text via HTML attributes */
      font[color="#000000"], font[color="#000"], font[color="black"],
      *[style*="color: rgb(0, 0, 0)"],
      *[style*="color: #000000"],
      *[style*="color: #000"],
      *[style*="color:rgb(0, 0, 0)"],
      *[style*="color:#000000"],
      *[style*="color:#000"],
      *[style*="color: black"],
      *[style*="color:black"] {
        color: ${fg} !important;
      }
      /* Subtle distinction for blockquotes and code */
      blockquote {
        border-color: #555 !important;
      }
      pre, code {
        background-color: #2a2a2a !important;
      }
      /* Don't invert images */
      img, svg, video {
        background-color: transparent !important;
      }
      hr {
        border-color: #444 !important;
      }
      table, th, td, tr, thead, tbody, tfoot {
        border-color: #555 !important;
      }
    `;
  }
  return `
    html, body {
      background: #ffffff !important;
      color: #1a1a1a !important;
    }
  `;
}

/**
 * Load foliate-js by injecting a module script tag.
 * Vite blocks `import()` for files in public/, so we load it as a script instead.
 * The script registers the <foliate-view> custom element globally.
 */
const foliateReady = new Promise<void>((resolve, reject) => {
  // Already loaded (e.g. HMR re-evaluation)
  if (customElements.get("foliate-view")) {
    resolve();
    return;
  }
  const script = document.createElement("script");
  script.type = "module";
  script.src = "/foliate-js/view.js";
  script.onload = () => {
    // Custom element registration is synchronous within the module, so it's
    // available as soon as the script's onload fires.
    resolve();
  };
  script.onerror = () => reject(new Error("Failed to load foliate-js"));
  document.head.appendChild(script);
});

export function EpubViewer({ filePath, fileName }: EpubViewerProps) {
  // containerRef holds the <foliate-view> and is ALWAYS rendered at the same
  // DOM position. The foliate-view fills this container completely and uses
  // its own internal CSS grid to create page margins and center content.
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const destroyedRef = useRef(false);
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  const [bookTitle, setBookTitle] = useState("");
  const [toc, setToc] = useState<TocItem[]>([]);
  const [currentChapter, setCurrentChapter] = useState("");
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageInfo, setPageInfo] = useState({ current: 0, total: 0 });

  const { viewMode, setViewMode, setBookmark, getBookmark } = useEpubStore();
  const theme = useSettingsStore((s) => s.theme);
  const effectiveTheme = resolveTheme(theme);
  const isDark = effectiveTheme === "dark";

  const savedCfiRef = useRef<string | null>(null);
  const bookmarkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookTitleRef = useRef("");
  /** Physical page counts per section index, accumulated as sections are visited. */
  const sectionPageCounts = useRef<Map<number, number>>(new Map());

  // Search state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<Array<{ cfi: string }>>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchAbortRef = useRef(false);

  /** Inject a keydown listener into a foliate-js section document so Cmd+F
   *  works when the iframe has focus (paginated mode). Called from the `load`
   *  event which provides the iframe's contentDocument directly — we cannot
   *  access it via shadowRoot since foliate-js uses closed Shadow DOM. */
  const injectKeyboardForwarding = useCallback((doc: Document) => {
    try {
      if ((doc as unknown as Record<string, unknown>).__notesageFindHandler) return;
      doc.addEventListener("keydown", (e: KeyboardEvent) => {
        // Forward all keydown events from the iframe to the parent window
        // so app-level shortcuts (Cmd+F, Cmd+T, Escape, etc.) work when
        // the EPUB content has focus.
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: e.key,
          code: e.code,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        }));
      });
      (doc as unknown as Record<string, unknown>).__notesageFindHandler = true;
    } catch {
      // Cross-origin or sandboxed — skip
    }
  }, []);

  /** Configure the renderer for the current view mode.
   *  The foliate-view fills the full available area. The paginator's internal
   *  5-column CSS grid handles centering and margins via max-inline-size.
   *  We only configure the essentials — flow mode and content width limits. */
  const applyLayout = useCallback((renderer: FoliateRenderer, mode: ViewMode) => {
    const isScroll = mode === "scroll";
    // Set max-column-count FIRST so the CSS variable is ready before render().
    // max-inline-size and flow both trigger render(), so they go last.
    renderer.setAttribute("max-column-count", "1");
    renderer.setAttribute("max-inline-size", isScroll ? "720px" : "720px");
    renderer.setAttribute("flow", isScroll ? "scrolled" : "paginated");
  }, []);

  // Initialize book on file change
  useEffect(() => {
    const data = getBinaryData(filePath);
    if (!data) {
      setError("No EPUB data available");
      setLoading(false);
      return;
    }
    if (!containerRef.current) return;

    destroyedRef.current = false;
    sectionPageCounts.current.clear();
    setLoading(true);
    setError(null);

    let view: FoliateView | null = null;

    const initBook = async () => {
      try {
        await foliateReady;

        if (destroyedRef.current) return;

        // Create the <foliate-view> element
        view = document.createElement("foliate-view") as unknown as FoliateView;
        viewRef.current = view;

        // Size the view to fill its container — the paginator's internal grid
        // handles content centering and page margins.
        const viewEl = view as unknown as HTMLElement;
        viewEl.style.width = "100%";
        viewEl.style.height = "100%";
        viewEl.style.display = "block";

        // Append to container
        containerRef.current!.innerHTML = "";
        containerRef.current!.appendChild(viewEl);

        // Create a File blob from binary data
        const blob = new File([data], fileName, { type: "application/epub+zip" });

        // Open the book
        await view.open(blob);

        if (destroyedRef.current) return;

        // Extract metadata
        const title = getBookTitle(view.book);
        if (title) {
          setBookTitle(title);
          bookTitleRef.current = title;
        }
        if (view.book.toc) setToc(view.book.toc);

        // Configure layout
        applyLayout(view.renderer, viewMode);

        // Inject themed content styles — the paginator's #background div
        // auto-syncs to the iframe's computed background color.
        view.renderer.setStyles(getContentStyles(isDark));

        // Listen for section loads — foliate-js emits { doc, index } on each section
        viewEl.addEventListener("load", ((e: Event) => {
          if (destroyedRef.current) return;
          // Re-apply styles to each newly loaded section
          view?.renderer.setStyles(getContentStyles(
            resolveTheme(useSettingsStore.getState().theme) === "dark"
          ));
          // Inject keyboard forwarding into the new section's iframe document
          const doc = (e as CustomEvent<{ doc: Document }>).detail?.doc;
          if (doc) injectKeyboardForwarding(doc);
        }) as EventListener);

        // Listen for relocate events
        viewEl.addEventListener("relocate", ((e: CustomEvent<RelocateDetail>) => {
          if (destroyedRef.current) return;
          const detail = e.detail;
          const renderer = view?.renderer;

          // Update navigation state
          if (renderer) {
            setAtStart(renderer.atStart);
            setAtEnd(renderer.atEnd);
          }

          // Chapter label
          let chapterLabel: string | undefined;
          if (detail.tocItem?.label) {
            chapterLabel = detail.tocItem.label.trim();
            setCurrentChapter(chapterLabel);
          }

          // Page info — accumulate physical page counts per section to build
          // book-wide page numbers that advance by exactly 1 per flip.
          // SectionProgress "locations" are character-based estimates and can
          // jump by 2+ per physical page, so we avoid them for display.
          if (renderer && !renderer.scrolled && renderer.pages > 2) {
            const sectionIdx = detail.section?.current ?? 0;
            const totalSections = detail.section?.total ?? 1;
            const sectionPhysPages = renderer.pages - 2;
            const pageInSection = Math.max(1, Math.min(renderer.page, sectionPhysPages));

            // Record this section's physical page count
            sectionPageCounts.current.set(sectionIdx, sectionPhysPages);

            // Sum physical pages for all sections before the current one.
            // For unvisited sections, estimate from the average of known ones.
            const known = [...sectionPageCounts.current.values()];
            const avgPages = known.reduce((a, b) => a + b, 0) / known.length;

            let pagesBefore = 0;
            for (let i = 0; i < sectionIdx; i++) {
              pagesBefore += sectionPageCounts.current.get(i) ?? avgPages;
            }
            const displayCurrent = Math.round(pagesBefore) + pageInSection;

            // Estimate total book pages
            let displayTotal = 0;
            for (let i = 0; i < totalSections; i++) {
              displayTotal += sectionPageCounts.current.get(i) ?? avgPages;
            }
            displayTotal = Math.max(1, Math.round(displayTotal));

            setPageInfo({ current: displayCurrent, total: displayTotal });

            // Populate the paginator's built-in running footer with page info
            if (renderer.feet) {
              for (const foot of renderer.feet) {
                foot.textContent = `${displayCurrent} / ${displayTotal}`;
              }
            }
            // Populate the running header with chapter title (hidden on page 1
            // automatically by the paginator)
            if (renderer.heads) {
              const headerText = chapterLabel || bookTitleRef.current;
              for (const head of renderer.heads) {
                head.textContent = headerText;
              }
            }
          }

          // Save CFI and debounced bookmark
          if (detail.cfi) {
            savedCfiRef.current = detail.cfi;

            if (bookmarkTimerRef.current) clearTimeout(bookmarkTimerRef.current);
            bookmarkTimerRef.current = setTimeout(() => {
              if (!destroyedRef.current) {
                setBookmark(filePathRef.current, detail.cfi!, chapterLabel);
              }
            }, 1000);
          }
        }) as EventListener);

        // Restore saved reading position or start from beginning
        const bookmark = getBookmark(filePath);
        const startCfi = bookmark?.cfi ?? null;
        savedCfiRef.current = startCfi;

        if (startCfi) {
          await view.init({ lastLocation: startCfi });
        } else {
          await view.init({ showTextStart: true });
        }

        if (!destroyedRef.current) {
          setLoading(false);
        }
      } catch (err) {
        if (!destroyedRef.current) {
          setError(`Failed to render EPUB: ${err instanceof Error ? err.message : String(err)}`);
          setLoading(false);
        }
      }
    };

    initBook();

    return () => {
      destroyedRef.current = true;

      // Flush any pending bookmark save
      if (bookmarkTimerRef.current) {
        clearTimeout(bookmarkTimerRef.current);
        bookmarkTimerRef.current = null;
      }
      // Save final position before cleanup
      if (savedCfiRef.current) {
        setBookmark(filePathRef.current, savedCfiRef.current);
      }

      if (view) {
        view.close();
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Re-apply content styles when theme changes (without reopening the book)
  useEffect(() => {
    const view = viewRef.current;
    if (!view?.renderer) return;
    view.renderer.setStyles(getContentStyles(isDark));
  }, [isDark]);

  // Switch view mode (scroll <-> paginated) without reopening the book
  const prevModeRef = useRef(viewMode);
  useEffect(() => {
    if (prevModeRef.current === viewMode) return;
    prevModeRef.current = viewMode;

    const view = viewRef.current;
    if (!view?.renderer) return;

    applyLayout(view.renderer, viewMode);
  }, [viewMode, applyLayout]);

  // Arrow key navigation (paginated only)
  useEffect(() => {
    if (viewMode !== "paginated") return;
    const handleKey = (e: KeyboardEvent) => {
      const view = viewRef.current;
      if (!view) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        view.prev();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        view.next();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [viewMode]);

  // Listen for system theme changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const view = viewRef.current;
      if (!view?.renderer) return;
      view.renderer.setStyles(getContentStyles(mq.matches));
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const goPrev = useCallback(() => { viewRef.current?.prev(); }, []);
  const goNext = useCallback(() => { viewRef.current?.next(); }, []);
  const goToChapter = useCallback((href: string) => { viewRef.current?.goTo(href); }, []);

  // Search: run foliate-js search to collect CFIs, use view.select() for
  // native text selection on the current match. Overlay drawing is disabled
  // in the vendored view.js — we handle all visual feedback.
  const handleSearch = useCallback(async (query: string) => {
    const view = viewRef.current;
    if (!view) return;

    // Clear previous search
    searchAbortRef.current = true;
    view.clearSearch();
    view.deselect();
    setSearchMatches([]);
    setSearchCurrentIndex(-1);

    if (!query.trim()) {
      setSearchLoading(false);
      return;
    }

    searchAbortRef.current = false;
    setSearchLoading(true);

    const matches: Array<{ cfi: string }> = [];
    let navigatedToFirst = false;

    try {
      for await (const result of view.search({ query })) {
        if (searchAbortRef.current) break;
        if (result === "done") break;

        if (result.subitems) {
          for (const item of result.subitems) {
            matches.push({ cfi: item.cfi });
            if (!navigatedToFirst) {
              navigatedToFirst = true;
              setSearchCurrentIndex(0);
              view.select(item.cfi);
            }
          }
        } else if (result.cfi) {
          matches.push({ cfi: result.cfi });
          if (!navigatedToFirst) {
            navigatedToFirst = true;
            setSearchCurrentIndex(0);
            view.select(result.cfi);
          }
        }
        // Update match count progressively
        setSearchMatches([...matches]);
      }
    } catch {
      // Search may fail if view is destroyed
    }

    if (!searchAbortRef.current) {
      setSearchMatches([...matches]);
      setSearchLoading(false);
    }
  }, []);

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchCurrentIndex + 1) % searchMatches.length;
    setSearchCurrentIndex(next);
    viewRef.current?.select(searchMatches[next].cfi);
  }, [searchMatches, searchCurrentIndex]);

  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prev = (searchCurrentIndex - 1 + searchMatches.length) % searchMatches.length;
    setSearchCurrentIndex(prev);
    viewRef.current?.select(searchMatches[prev].cfi);
  }, [searchMatches, searchCurrentIndex]);

  const handleFindClose = useCallback(() => {
    setFindBarOpen(false);
    searchAbortRef.current = true;
    viewRef.current?.clearSearch();
    viewRef.current?.deselect();
    setSearchMatches([]);
    setSearchCurrentIndex(-1);
    setSearchLoading(false);
  }, []);

  // Listen for Cmd+F / notesage:find-open event
  useEffect(() => {
    const handleFindOpen = () => {
      setFindBarOpen(true);
    };
    window.addEventListener("notesage:find-open", handleFindOpen);
    return () => window.removeEventListener("notesage:find-open", handleFindOpen);
  }, []);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  const isPaginated = viewMode === "paginated";

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-9 border-b border-border px-3 flex items-center gap-1 shrink-0 bg-background">
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {bookTitle || fileName}
        </span>
        {currentChapter && (
          <>
            <Separator orientation="vertical" className="h-4 mx-1" />
            <span className="text-xs text-muted-foreground truncate max-w-[300px]">
              {currentChapter}
            </span>
          </>
        )}
        <span className="flex-1" />

        {/* View mode */}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setViewMode("scroll")}
          className={!isPaginated ? "bg-accent text-foreground" : "text-muted-foreground"}
          title="Continuous scroll"
        >
          <ScrollText className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setViewMode("paginated")}
          className={isPaginated ? "bg-accent text-foreground" : "text-muted-foreground"}
          title="Paginated"
        >
          <BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>

        <Separator orientation="vertical" className="h-4 mx-1" />

        {/* Navigation */}
        <Button variant="ghost" size="icon-xs" onClick={goPrev} disabled={atStart} title="Previous">
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        {pageInfo.total > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums min-w-[50px] text-center">
            {pageInfo.current} / {pageInfo.total}
          </span>
        )}
        <Button variant="ghost" size="icon-xs" onClick={goNext} disabled={atEnd} title="Next">
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>

        {/* TOC */}
        {toc.length > 0 && (
          <>
            <Separator orientation="vertical" className="h-4 mx-1" />
            <select
              className="text-xs bg-transparent border-none outline-none text-muted-foreground cursor-pointer max-w-[200px]"
              value=""
              onChange={(e) => { if (e.target.value) goToChapter(e.target.value); }}
            >
              <option value="" disabled>Chapters</option>
              {toc.map((item, i) => (
                <option key={item.id ?? i} value={item.href}>{item.label.trim()}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Content area — foliate-view fills this entirely.
          The paginator's internal CSS grid handles page margins,
          content centering, and the header/footer areas.
          The #background div inside the paginator auto-syncs to the
          iframe's computed background, so the surrounding area matches. */}
      <div className="flex-1 overflow-hidden relative bg-background">
        <FindBar
          open={findBarOpen}
          onClose={handleFindClose}
          matchCount={searchMatches.length}
          currentMatch={searchCurrentIndex}
          onSearch={handleSearch}
          onNext={handleSearchNext}
          onPrevious={handleSearchPrev}
          replaceEnabled={false}
          replaceExpanded={false}
          onReplaceExpandedChange={() => {}}
        />
        <div ref={containerRef} className="w-full h-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        )}
        {searchLoading && findBarOpen && (
          <div className="absolute top-8 right-4 z-20">
            <span className="text-[10px] text-muted-foreground">Searching…</span>
          </div>
        )}
      </div>
    </div>
  );
}
