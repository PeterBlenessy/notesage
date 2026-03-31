import { useEffect, useState, useRef, useCallback } from "react";
import { renderAsync } from "docx-preview";
import { FileDown, ZoomIn, ZoomOut, RectangleVertical, SquareDashedBottom } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getBinaryData } from "@/lib/binary-cache";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { FindBar } from "@/components/editor/FindBar";

interface DocxViewerProps {
  filePath: string;
  fileName: string;
  onConvertToMarkdown?: (fileName: string) => void;
}

const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0,
  2.5, 3.0, 4.0,
];
const DEFAULT_ZOOM_INDEX = 7; // 1.0

type FitMode = "width" | "page" | null;

export function DocxViewer({ filePath, fileName, onConvertToMarkdown }: DocxViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [zoom, setZoom] = useState(1);

  // Search state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<HTMLElement[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);

  const contentRef = useRef<HTMLDivElement>(null);
  const styleContainerRef = useRef<HTMLStyleElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const searchMatchesRef = useRef<HTMLElement[]>([]);

  // Compute effective zoom from fit mode
  const computeFitZoom = useCallback((mode: FitMode) => {
    if (!mode || !scrollContainerRef.current || !contentRef.current) return null;

    const container = scrollContainerRef.current;
    const containerWidth = container.clientWidth - 64; // padding
    const containerHeight = container.clientHeight - 64;

    // Get the first page section's natural width
    const firstSection = contentRef.current.querySelector("section") as HTMLElement | null;
    if (!firstSection) return null;

    // Read the natural (unscaled) dimensions from docx-preview's inline styles
    const sectionWidth = firstSection.offsetWidth;
    const sectionHeight = firstSection.offsetHeight;
    if (!sectionWidth) return null;

    if (mode === "width") {
      return containerWidth / sectionWidth;
    }
    return Math.min(containerWidth / sectionWidth, containerHeight / sectionHeight);
  }, []);

  const updateZoom = useCallback((newZoomIndex: number, newFitMode: FitMode) => {
    if (newFitMode) {
      const fitZoom = computeFitZoom(newFitMode);
      if (fitZoom) {
        setZoom(fitZoom);
        return;
      }
    }
    setZoom(ZOOM_STEPS[newZoomIndex]);
  }, [computeFitZoom]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const data = getBinaryData(filePath);
    if (!data) {
      setError("No DOCX data available");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setTotalPages(0);
    setCurrentPage(1);

    // Clear previous content
    container.innerHTML = "";

    renderAsync(data.buffer, container, styleContainerRef.current ?? undefined, {
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      className: "docx-preview-body",
    })
      .then(() => {
        setLoading(false);
        // Count rendered page sections
        const sections = container.querySelectorAll("section.docx-preview-body");
        setTotalPages(sections.length);
        // Apply initial fit-to-width
        requestAnimationFrame(() => {
          updateZoom(DEFAULT_ZOOM_INDEX, "width");
        });
      })
      .catch((err) => {
        console.error("docx-preview render error:", err);
        setError(`Failed to render DOCX: ${err.message || err}`);
        setLoading(false);
      });
  }, [filePath, updateZoom]);

  // Recompute fit zoom on container resize
  useEffect(() => {
    if (!fitMode || !scrollContainerRef.current) return;

    const observer = new ResizeObserver(() => {
      updateZoom(zoomIndex, fitMode);
    });
    observer.observe(scrollContainerRef.current);
    return () => observer.disconnect();
  }, [fitMode, zoomIndex, updateZoom]);

  // Track current page from scroll position
  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = contentRef.current;
    if (!container || !content || totalPages === 0) return;

    const handleScroll = () => {
      const sections = content.querySelectorAll("section.docx-preview-body");
      const containerTop = container.scrollTop;
      const containerMid = containerTop + container.clientHeight / 3;

      let closest = 1;
      let closestDist = Infinity;

      sections.forEach((el, i) => {
        const htmlEl = el as HTMLElement;
        // Account for CSS transform scaling — offsetTop is in unscaled coordinates
        const top = htmlEl.offsetTop * zoom;
        const dist = Math.abs(top - containerMid);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i + 1;
        }
      });

      setCurrentPage(closest);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [totalPages, zoom]);

  // Clear search state on file change
  useEffect(() => {
    setFindBarOpen(false);
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
  }, [filePath]);

  const zoomIn = () => {
    setFitMode(null);
    setZoomIndex((i) => {
      const next = Math.min(ZOOM_STEPS.length - 1, i + 1);
      setZoom(ZOOM_STEPS[next]);
      return next;
    });
  };

  const zoomOut = () => {
    setFitMode(null);
    setZoomIndex((i) => {
      const next = Math.max(0, i - 1);
      setZoom(ZOOM_STEPS[next]);
      return next;
    });
  };

  const toggleFitWidth = () => {
    setFitMode((f) => {
      const next = f === "width" ? null : "width";
      if (!next) {
        setZoom(ZOOM_STEPS[zoomIndex]);
      } else {
        updateZoom(zoomIndex, next);
      }
      return next;
    });
  };

  const toggleFitPage = () => {
    setFitMode((f) => {
      const next = f === "page" ? null : "page";
      if (!next) {
        setZoom(ZOOM_STEPS[zoomIndex]);
      } else {
        updateZoom(zoomIndex, next);
      }
      return next;
    });
  };

  // Navigate to a specific mark element within the scroll container
  const scrollToMark = useCallback((mark: HTMLElement, marks: HTMLElement[]) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    for (const m of marks) {
      m.classList.remove("dom-find-highlight-active");
    }
    mark.classList.add("dom-find-highlight-active");

    const containerRect = container.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    const offsetTop = markRect.top - containerRect.top + container.scrollTop;
    container.scrollTop = offsetTop - containerRect.height / 3;
  }, []);

  // Search handler
  const handleSearch = useCallback((query: string) => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    clearDomHighlights(contentEl);

    if (!query) {
      setSearchMatches([]);
      searchMatchesRef.current = [];
      setSearchCurrentIndex(-1);
      return;
    }

    const marks = highlightDomMatches(contentEl, query);
    setSearchMatches(marks);
    searchMatchesRef.current = marks;

    if (marks.length > 0) {
      setSearchCurrentIndex(0);
      requestAnimationFrame(() => {
        scrollToMark(marks[0], marks);
      });
    } else {
      setSearchCurrentIndex(-1);
    }
  }, [scrollToMark]);

  const handleNext = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const nextIndex = (prev + 1) % marks.length;
      scrollToMark(marks[nextIndex], marks);
      return nextIndex;
    });
  }, [scrollToMark]);

  const handlePrevious = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const prevIndex = (prev - 1 + marks.length) % marks.length;
      scrollToMark(marks[prevIndex], marks);
      return prevIndex;
    });
  }, [scrollToMark]);

  const handleClose = useCallback(() => {
    setFindBarOpen(false);
    if (contentRef.current) {
      clearDomHighlights(contentRef.current);
    }
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
    viewerRef.current?.focus({ preventScroll: true });
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

  return (
    <div ref={viewerRef} className="h-full flex flex-col" tabIndex={-1}>
      {/* Toolbar */}
      <div className="h-9 border-b border-border px-3 flex items-center gap-1 shrink-0 bg-background">
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {fileName}
        </span>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <Button variant="ghost" size="icon-xs" onClick={zoomOut} title="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums min-w-[40px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <Button variant="ghost" size="icon-xs" onClick={zoomIn} title="Zoom in">
          <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={toggleFitWidth}
          className={fitMode === "width" ? "bg-accent text-foreground" : "text-muted-foreground"}
          title="Fit to width"
        >
          <SquareDashedBottom className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={toggleFitPage}
          className={fitMode === "page" ? "bg-accent text-foreground" : "text-muted-foreground"}
          title="Fit to page"
        >
          <RectangleVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        {totalPages > 0 && (
          <>
            <Separator orientation="vertical" className="h-4 mx-1" />
            <span className="text-xs text-muted-foreground tabular-nums">
              Page {currentPage} / {totalPages}
            </span>
          </>
        )}
        <span className="flex-1" />
        {onConvertToMarkdown && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onConvertToMarkdown(fileName)}
          >
            <FileDown className="h-3 w-3" strokeWidth={1.5} />
            Convert to Markdown
          </Button>
        )}
      </div>

      {/* Content area with FindBar overlay */}
      <div className="flex-1 overflow-hidden relative">
        <FindBar
          open={findBarOpen}
          onClose={handleClose}
          matchCount={searchMatches.length}
          currentMatch={searchCurrentIndex}
          onSearch={handleSearch}
          onNext={handleNext}
          onPrevious={handlePrevious}
          replaceEnabled={false}
          replaceExpanded={false}
          onReplaceExpandedChange={() => {}}
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <p className="text-sm text-muted-foreground">Loading document...</p>
          </div>
        )}
        <div ref={scrollContainerRef} className="h-full overflow-auto bg-muted/50 p-8">
          <div className="docx-preview-wrapper">
            {/* Scoped style container — docx-preview injects its CSS here instead of <head> */}
            <style ref={styleContainerRef} />
            <div
              ref={contentRef}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top center",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
