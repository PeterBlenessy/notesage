import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  StickyNote,
  ChevronLeft,
  ChevronRight,
  Box,
  MessageSquare,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBinaryData } from "@/lib/binary-cache";
import { parsePptx } from "@/lib/pptx-parser";
import type { PptxPresentation } from "@/lib/pptx-types";
import { SlideRenderer } from "./PptxSlideRenderer";
import { PptxSearchBar, usePptxSearch } from "./PptxSearchBar";
import { PptxZoomControls, usePptxZoom } from "./PptxZoomControls";
import { PptxCommentOverlay } from "./PptxCommentOverlay";
import { ViewerToolbarPill } from "./ViewerToolbarPill";
import { useEditorStore } from "@/stores/editor-store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMU_PER_PX = 9525;
const NAV_ZONE_PERCENT = 0.15;

interface PptxViewerProps {
  filePath: string;
  fileName: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PptxViewer({ filePath, fileName }: PptxViewerProps) {
  const [presentation, setPresentation] = useState<PptxPresentation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Restore last-viewed slide from persisted scroll positions
  const savedSlideRef = useRef(Math.round(useEditorStore.getState().scrollPositions[filePath] ?? 0));
  const setScrollPosition = useEditorStore((s) => s.setScrollPosition);
  const [currentSlide, setCurrentSlideRaw] = useState(0);
  const setCurrentSlide = useCallback((idx: number) => {
    setCurrentSlideRaw(idx);
    setScrollPosition(filePath, idx);
  }, [filePath, setScrollPosition]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [jumpInput, setJumpInput] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [commentsVisible, setCommentsVisible] = useState(false);

  const viewerRef = useRef<HTMLDivElement>(null);
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const slideContentRef = useRef<HTMLDivElement>(null);
  const jumpInputRef = useRef<HTMLInputElement>(null);

  const isLegacyPpt = fileName.toLowerCase().endsWith(".ppt");
  const slideCount = presentation?.slides.length ?? 0;
  const slide = presentation?.slides[currentSlide] ?? null;
  const hasAnyComments = useMemo(
    () => presentation?.slides.some((s) => s.comments && s.comments.length > 0) ?? false,
    [presentation],
  );
  const currentSection = useMemo(() => {
    if (!presentation?.sections) return undefined;
    let section = presentation.sections[0];
    for (const s of presentation.sections) {
      if (s.startSlide <= currentSlide) section = s;
      else break;
    }
    return section;
  }, [presentation, currentSlide]);

  // ---------------------------------------------------------------------------
  // Zoom
  // ---------------------------------------------------------------------------

  const zoom = usePptxZoom({ presentation, scrollContainerRef });

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  const search = usePptxSearch({
    presentation,
    currentSlide,
    setCurrentSlide,
    slideContentRef,
    viewerRef,
    filePath,
  });

  // ---------------------------------------------------------------------------
  // Parse PPTX on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (isLegacyPpt) {
      setLoading(false);
      return;
    }

    const data = getBinaryData(filePath);
    if (!data) {
      setError("No PPTX data available");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    parsePptx(data)
      .then((pres) => {
        setPresentation(pres);
        // Restore saved slide, clamped to valid range
        const maxSlide = Math.max(0, pres.slides.length - 1);
        const restoredSlide = Math.min(savedSlideRef.current, maxSlide);
        setCurrentSlideRaw(restoredSlide);
        setLoading(false);
      })
      .catch((err) => {
        console.error("PPTX parse error:", err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [filePath, isLegacyPpt]);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const goToSlide = useCallback(
    (index: number) => {
      if (!presentation) return;
      const clamped = Math.max(0, Math.min(index, presentation.slides.length - 1));
      setCurrentSlide(clamped);
    },
    [presentation, setCurrentSlide],
  );

  const goNext = useCallback(() => goToSlide(currentSlide + 1), [currentSlide, goToSlide]);
  const goPrev = useCallback(() => goToSlide(currentSlide - 1), [currentSlide, goToSlide]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (search.findBarOpen) return;
      if (jumpInput) return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      } else if (e.metaKey && e.key === "=") {
        e.preventDefault();
        zoom.zoomIn();
      } else if (e.metaKey && e.key === "-") {
        e.preventDefault();
        zoom.zoomOut();
      } else if (e.metaKey && e.key === "0") {
        e.preventDefault();
        zoom.toggleFitPage();
      }
    };

    const el = viewerRef.current;
    if (el) {
      el.addEventListener("keydown", handleKeyDown);
      return () => el.removeEventListener("keydown", handleKeyDown);
    }
  }, [goNext, goPrev, search.findBarOpen, jumpInput, zoom]);

  // Click nav zones
  const handleSlideClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      if (relX < NAV_ZONE_PERCENT) goPrev();
      else if (relX > 1 - NAV_ZONE_PERCENT) goNext();
    },
    [goPrev, goNext],
  );

  // Direct slide jump
  const handleJumpSubmit = useCallback(() => {
    const num = parseInt(jumpValue, 10);
    if (!isNaN(num)) goToSlide(num - 1);
    setJumpInput(false);
    setJumpValue("");
    viewerRef.current?.focus();
  }, [jumpValue, goToSlide]);

  const openFindBar = useCallback(() => {
    // Dispatch the shared find-open event that the search hook listens for.
    window.dispatchEvent(new Event("notesage:find-open"));
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLegacyPpt) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground p-8">
        <Box className="h-12 w-12" strokeWidth={1} />
        <p className="text-sm font-medium">Legacy .ppt format is not supported</p>
        <p className="text-xs text-center max-w-md">
          Please convert to .pptx using PowerPoint, LibreOffice, or Google Slides.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  const slideW = presentation ? presentation.slideWidth / EMU_PER_PX : 960;
  const slideH = presentation ? presentation.slideHeight / EMU_PER_PX : 540;

  return (
    <div ref={viewerRef} className="h-full flex flex-col outline-none relative" tabIndex={-1}>
      {/* Floating toolbar pill */}
      <ViewerToolbarPill viewerId="pptx" scrollRef={scrollContainerRef}>
        <PptxZoomControls zoom={zoom} />
        {slideCount > 0 && (
          <>
            <span className="w-px h-3.5 bg-border/60 mx-0.5" aria-hidden="true" />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={goPrev}
              disabled={currentSlide === 0}
              title="Previous slide"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
            {jumpInput ? (
              <input
                ref={jumpInputRef}
                className="w-12 text-center text-xs bg-transparent border border-border rounded px-1 py-0.5 outline-none tabular-nums"
                value={jumpValue}
                onChange={(e) => setJumpValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJumpSubmit();
                  if (e.key === "Escape") {
                    setJumpInput(false);
                    viewerRef.current?.focus();
                  }
                }}
                onBlur={() => {
                  handleJumpSubmit();
                }}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className="text-xs text-muted-foreground tabular-nums hover:text-foreground transition-colors px-1"
                onClick={() => {
                  setJumpInput(true);
                  setJumpValue(String(currentSlide + 1));
                }}
                title="Click to jump to slide"
              >
                {currentSlide + 1} / {slideCount}
              </button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={goNext}
              disabled={currentSlide === slideCount - 1}
              title="Next slide"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          </>
        )}
        <span className="w-px h-3.5 bg-border/60 mx-0.5" aria-hidden="true" />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setNotesOpen(!notesOpen)}
          className={notesOpen ? "bg-[var(--color-accent-primary)]/12 text-foreground" : "text-muted-foreground"}
          title="Speaker notes"
          aria-pressed={notesOpen}
        >
          <StickyNote className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        {hasAnyComments && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setCommentsVisible(!commentsVisible)}
            className={commentsVisible ? "bg-[var(--color-accent-primary)]/12 text-foreground" : "text-muted-foreground"}
            title="Comments"
            aria-pressed={commentsVisible}
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={openFindBar}
          className={search.findBarOpen ? "bg-[var(--color-accent-primary)]/12 text-foreground" : "text-muted-foreground"}
          title="Find in slides"
          aria-pressed={search.findBarOpen}
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        {currentSection && (
          <>
            <span className="w-px h-3.5 bg-border/60 mx-0.5" aria-hidden="true" />
            <span
              className="text-xs text-muted-foreground truncate max-w-[140px] px-1"
              title={currentSection.name}
            >
              {currentSection.name}
            </span>
          </>
        )}
      </ViewerToolbarPill>

      {/* Content area */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        <PptxSearchBar searchState={search} />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <p className="text-sm text-muted-foreground">Loading presentation...</p>
          </div>
        )}

        {/* Slide area. pt-14 reserves space for the floating pill at top-4 so
            the first slide doesn't collide with the toolbar on short viewports. */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto bg-muted/50 flex flex-col items-center justify-start pt-14"
        >
          {slide && (
            <div className="flex-1 flex items-center justify-center p-8 min-h-0">
              <div
                ref={slideContainerRef}
                onClick={handleSlideClick}
                className="relative cursor-default"
                style={{
                  width: slideW * zoom.scale,
                  height: slideH * zoom.scale,
                }}
              >
                <div
                  ref={slideContentRef}
                  className="absolute inset-0 origin-top-left shadow-lg rounded-sm overflow-hidden"
                  style={{
                    width: slideW,
                    height: slideH,
                    transform: `scale(${zoom.scale})`,
                    transformOrigin: "top left",
                  }}
                >
                  <SlideRenderer slide={slide} theme={presentation!.theme} onSlideNavigate={goToSlide} />
                  {commentsVisible && slide.comments && slide.comments.length > 0 && (
                    <PptxCommentOverlay
                      comments={slide.comments}
                      px={(emu: number) => emu / EMU_PER_PX}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Slide counter text (accessible readout — pill handles nav buttons). */}
          {slideCount > 0 && (
            <div className="shrink-0 pb-4 text-xs text-muted-foreground tabular-nums" aria-live="polite">
              Slide {currentSlide + 1} of {slideCount}
            </div>
          )}
        </div>

        {/* Speaker notes panel */}
        {notesOpen && slide && (
          <div className="shrink-0 border-t border-border bg-background overflow-auto" style={{ height: 150 }}>
            <div className="p-3">
              {slide.notes ? (
                <div className="text-sm text-foreground whitespace-pre-wrap">
                  {slide.notes}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No notes for this slide
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
