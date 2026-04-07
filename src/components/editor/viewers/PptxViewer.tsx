import { useEffect, useState, useRef, useCallback } from "react";
import { StickyNote, ChevronLeft, ChevronRight, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getBinaryData } from "@/lib/binary-cache";
import { parsePptx } from "@/lib/pptx-parser";
import type { PptxPresentation } from "@/lib/pptx-types";
import { SlideRenderer } from "./PptxSlideRenderer";
import { PptxSearchBar, usePptxSearch } from "./PptxSearchBar";
import { PptxZoomControls, usePptxZoom } from "./PptxZoomControls";

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
  const [currentSlide, setCurrentSlide] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [jumpInput, setJumpInput] = useState(false);
  const [jumpValue, setJumpValue] = useState("");

  const viewerRef = useRef<HTMLDivElement>(null);
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const slideContentRef = useRef<HTMLDivElement>(null);
  const jumpInputRef = useRef<HTMLInputElement>(null);

  const isLegacyPpt = fileName.toLowerCase().endsWith(".ppt");
  const slideCount = presentation?.slides.length ?? 0;
  const slide = presentation?.slides[currentSlide] ?? null;

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
        setCurrentSlide(0);
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
    [presentation],
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
    <div ref={viewerRef} className="h-full flex flex-col outline-none" tabIndex={-1}>
      {/* Toolbar */}
      <div className="h-9 border-b border-border px-3 flex items-center gap-1 shrink-0 bg-background">
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {fileName}
        </span>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <PptxZoomControls zoom={zoom} />
        <Separator orientation="vertical" className="h-4 mx-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setNotesOpen(!notesOpen)}
          className={notesOpen ? "bg-accent text-foreground" : "text-muted-foreground"}
          title="Speaker notes"
        >
          <StickyNote className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        {slideCount > 0 && (
          <>
            <Separator orientation="vertical" className="h-4 mx-1" />
            <span className="text-xs text-muted-foreground tabular-nums">
              Slide {currentSlide + 1} / {slideCount}
            </span>
          </>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        <PptxSearchBar searchState={search} />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <p className="text-sm text-muted-foreground">Loading presentation...</p>
          </div>
        )}

        {/* Slide area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto bg-muted/50 flex flex-col items-center justify-start"
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
                </div>
              </div>
            </div>
          )}

          {/* Navigation bar */}
          {slideCount > 0 && (
            <div className="shrink-0 flex items-center justify-center gap-2 pb-4">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={goPrev}
                disabled={currentSlide === 0}
                title="Previous slide"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
              </Button>
              {jumpInput ? (
                <input
                  ref={jumpInputRef}
                  className="w-12 text-center text-xs bg-transparent border border-border rounded px-1 py-0.5 outline-none"
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
                  className="text-xs text-muted-foreground tabular-nums hover:text-foreground transition-colors"
                  onClick={() => {
                    setJumpInput(true);
                    setJumpValue(String(currentSlide + 1));
                  }}
                  title="Click to jump to slide"
                >
                  Slide {currentSlide + 1} of {slideCount}
                </button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={goNext}
                disabled={currentSlide === slideCount - 1}
                title="Next slide"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
              </Button>
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
