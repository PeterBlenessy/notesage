import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  ZoomIn,
  ZoomOut,
  RectangleVertical,
  SquareDashedBottom,
  StickyNote,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Play,
  Box,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getBinaryData } from "@/lib/binary-cache";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { FindBar } from "@/components/editor/FindBar";
import { parsePptx } from "@/lib/pptx-parser";
import type {
  PptxPresentation,
  PptxSlide,
  PptxElement,
  PptxTextBox,
  PptxImage,
  PptxShape,
  PptxTable,
  PptxChart,
  PptxGroup,
  PptxFill,
  PptxParagraph,
  PptxBackground,
} from "@/lib/pptx-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const DEFAULT_ZOOM_INDEX = 2; // 1.0
const EMU_PER_PX = 9525; // 1 inch = 914400 EMU, 96 DPI → 9525 EMU/px
const NAV_ZONE_PERCENT = 0.15;
const DEFAULT_CHART_COLORS = [
  "#6b7280", "#9ca3af", "#4b5563", "#d1d5db", "#374151", "#e5e7eb",
];

type FitMode = "width" | "page" | null;

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
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [fitMode, setFitMode] = useState<FitMode>("page");
  const [scale, setScale] = useState(1);
  const [notesOpen, setNotesOpen] = useState(false);
  const [jumpInput, setJumpInput] = useState(false);
  const [jumpValue, setJumpValue] = useState("");

  // Search state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [, setSearchMatches] = useState<HTMLElement[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  const [totalMatchCount, setTotalMatchCount] = useState(0);
  const [globalMatchIndex, setGlobalMatchIndex] = useState(-1);

  const viewerRef = useRef<HTMLDivElement>(null);
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const slideContentRef = useRef<HTMLDivElement>(null);
  const searchMatchesRef = useRef<HTMLElement[]>([]);
  const jumpInputRef = useRef<HTMLInputElement>(null);

  const isLegacyPpt = fileName.toLowerCase().endsWith(".ppt");
  const slideCount = presentation?.slides.length ?? 0;
  const slide = presentation?.slides[currentSlide] ?? null;

  // Pre-compute per-slide match info for search
  const slideMatchInfo = useMemo(() => {
    if (!presentation || !searchQuery) return [];
    return presentation.slides.map((s) => {
      const matches = s.searchText.toLowerCase().split(searchQuery.toLowerCase());
      return matches.length - 1; // number of occurrences
    });
  }, [presentation, searchQuery]);

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
  // Zoom / fit
  // ---------------------------------------------------------------------------

  const computeFitScale = useCallback(
    (mode: FitMode) => {
      if (!mode || !scrollContainerRef.current || !presentation) return null;
      const container = scrollContainerRef.current;
      const padding = 64;
      const containerW = container.clientWidth - padding;
      const containerH = container.clientHeight - padding;
      const slideW = presentation.slideWidth / EMU_PER_PX;
      const slideH = presentation.slideHeight / EMU_PER_PX;
      if (mode === "width") return containerW / slideW;
      return Math.min(containerW / slideW, containerH / slideH);
    },
    [presentation],
  );

  const updateScale = useCallback(
    (newZoomIndex: number, newFitMode: FitMode) => {
      if (newFitMode) {
        const fit = computeFitScale(newFitMode);
        if (fit) {
          setScale(fit);
          return;
        }
      }
      setScale(ZOOM_STEPS[newZoomIndex]);
    },
    [computeFitScale],
  );

  // Recompute fit on resize
  useEffect(() => {
    if (!fitMode || !scrollContainerRef.current) return;
    const observer = new ResizeObserver(() => updateScale(zoomIndex, fitMode));
    observer.observe(scrollContainerRef.current);
    return () => observer.disconnect();
  }, [fitMode, zoomIndex, updateScale]);

  // Initial fit
  useEffect(() => {
    if (presentation) {
      requestAnimationFrame(() => updateScale(DEFAULT_ZOOM_INDEX, "page"));
    }
  }, [presentation, updateScale]);

  const zoomIn = () => {
    setFitMode(null);
    setZoomIndex((i) => {
      const next = Math.min(ZOOM_STEPS.length - 1, i + 1);
      setScale(ZOOM_STEPS[next]);
      return next;
    });
  };

  const zoomOut = () => {
    setFitMode(null);
    setZoomIndex((i) => {
      const next = Math.max(0, i - 1);
      setScale(ZOOM_STEPS[next]);
      return next;
    });
  };

  const toggleFitWidth = () => {
    setFitMode((f) => {
      const next = f === "width" ? null : "width";
      if (!next) setScale(ZOOM_STEPS[zoomIndex]);
      else updateScale(zoomIndex, next);
      return next;
    });
  };

  const toggleFitPage = () => {
    setFitMode((f) => {
      const next = f === "page" ? null : "page";
      if (!next) setScale(ZOOM_STEPS[zoomIndex]);
      else updateScale(zoomIndex, next);
      return next;
    });
  };

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
      if (findBarOpen) return;
      if (jumpInput) return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      } else if (e.metaKey && e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.metaKey && e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (e.metaKey && e.key === "0") {
        e.preventDefault();
        setFitMode("page");
        updateScale(DEFAULT_ZOOM_INDEX, "page");
      }
    };

    const el = viewerRef.current;
    if (el) {
      el.addEventListener("keydown", handleKeyDown);
      return () => el.removeEventListener("keydown", handleKeyDown);
    }
  }, [goNext, goPrev, findBarOpen, jumpInput, updateScale]);

  // Cmd+scroll wheel zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.metaKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    };
    const el = scrollContainerRef.current;
    if (el) {
      el.addEventListener("wheel", handleWheel, { passive: false });
      return () => el.removeEventListener("wheel", handleWheel);
    }
  }, []);

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
  // Search
  // ---------------------------------------------------------------------------

  // Re-highlight DOM when slide changes while search is active
  useEffect(() => {
    if (!searchQuery || !slideContentRef.current) return;
    clearDomHighlights(slideContentRef.current);
    const marks = highlightDomMatches(slideContentRef.current, searchQuery);
    setSearchMatches(marks);
    searchMatchesRef.current = marks;
    if (marks.length > 0) {
      marks[0].classList.add("dom-find-highlight-active");
      setSearchCurrentIndex(0);
    } else {
      setSearchCurrentIndex(-1);
    }
  }, [currentSlide, searchQuery]);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (!query) {
        if (slideContentRef.current) clearDomHighlights(slideContentRef.current);
        setSearchMatches([]);
        searchMatchesRef.current = [];
        setSearchCurrentIndex(-1);
        setTotalMatchCount(0);
        setGlobalMatchIndex(-1);
        return;
      }

      // Count total matches across all slides
      if (presentation) {
        let total = 0;
        for (const s of presentation.slides) {
          const parts = s.searchText.toLowerCase().split(query.toLowerCase());
          total += parts.length - 1;
        }
        setTotalMatchCount(total);
      }

      // Highlight current slide DOM
      if (slideContentRef.current) {
        clearDomHighlights(slideContentRef.current);
        const marks = highlightDomMatches(slideContentRef.current, query);
        setSearchMatches(marks);
        searchMatchesRef.current = marks;
        if (marks.length > 0) {
          setSearchCurrentIndex(0);
          setGlobalMatchIndex(computeGlobalIndex(0));
          requestAnimationFrame(() => {
            marks[0].classList.add("dom-find-highlight-active");
          });
        } else {
          setSearchCurrentIndex(-1);
          setGlobalMatchIndex(-1);
        }
      }
    },
    [presentation],
  );

  const computeGlobalIndex = useCallback(
    (localIndex: number) => {
      let offset = 0;
      for (let i = 0; i < currentSlide; i++) {
        offset += slideMatchInfo[i] ?? 0;
      }
      return offset + localIndex;
    },
    [currentSlide, slideMatchInfo],
  );

  const handleSearchNext = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length > 0) {
      const nextLocal = searchCurrentIndex + 1;
      if (nextLocal < marks.length) {
        for (const m of marks) m.classList.remove("dom-find-highlight-active");
        marks[nextLocal].classList.add("dom-find-highlight-active");
        setSearchCurrentIndex(nextLocal);
        setGlobalMatchIndex(computeGlobalIndex(nextLocal));
        return;
      }
    }
    // Move to next slide with matches
    if (!presentation) return;
    for (let offset = 1; offset <= presentation.slides.length; offset++) {
      const idx = (currentSlide + offset) % presentation.slides.length;
      if ((slideMatchInfo[idx] ?? 0) > 0) {
        setCurrentSlide(idx);
        setSearchCurrentIndex(0);
        // globalMatchIndex will update via effect
        return;
      }
    }
  }, [presentation, currentSlide, searchCurrentIndex, slideMatchInfo, computeGlobalIndex]);

  const handleSearchPrev = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length > 0 && searchCurrentIndex > 0) {
      const prevLocal = searchCurrentIndex - 1;
      for (const m of marks) m.classList.remove("dom-find-highlight-active");
      marks[prevLocal].classList.add("dom-find-highlight-active");
      setSearchCurrentIndex(prevLocal);
      setGlobalMatchIndex(computeGlobalIndex(prevLocal));
      return;
    }
    // Move to previous slide with matches
    if (!presentation) return;
    for (let offset = 1; offset <= presentation.slides.length; offset++) {
      const idx = (currentSlide - offset + presentation.slides.length) % presentation.slides.length;
      if ((slideMatchInfo[idx] ?? 0) > 0) {
        setCurrentSlide(idx);
        // Set to last match on that slide — will be applied after re-render
        setSearchCurrentIndex(-2); // sentinel: go to last
        return;
      }
    }
  }, [presentation, currentSlide, searchCurrentIndex, slideMatchInfo, computeGlobalIndex]);

  // Handle sentinel for "go to last match on slide"
  useEffect(() => {
    if (searchCurrentIndex === -2 && searchMatchesRef.current.length > 0) {
      const marks = searchMatchesRef.current;
      const last = marks.length - 1;
      for (const m of marks) m.classList.remove("dom-find-highlight-active");
      marks[last].classList.add("dom-find-highlight-active");
      setSearchCurrentIndex(last);
      setGlobalMatchIndex(computeGlobalIndex(last));
    }
  }, [searchCurrentIndex, computeGlobalIndex]);

  const handleSearchClose = useCallback(() => {
    setFindBarOpen(false);
    setSearchQuery("");
    if (slideContentRef.current) clearDomHighlights(slideContentRef.current);
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
    setTotalMatchCount(0);
    setGlobalMatchIndex(-1);
    viewerRef.current?.focus({ preventScroll: true });
  }, []);

  // Listen for Cmd+F
  useEffect(() => {
    const handleFindOpen = () => setFindBarOpen(true);
    window.addEventListener("notesage:find-open", handleFindOpen);
    return () => window.removeEventListener("notesage:find-open", handleFindOpen);
  }, []);

  // Clear search on file change
  useEffect(() => {
    setFindBarOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
    setTotalMatchCount(0);
    setGlobalMatchIndex(-1);
  }, [filePath]);

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
        <Button variant="ghost" size="icon-xs" onClick={zoomOut} title="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums min-w-[40px] text-center">
          {Math.round(scale * 100)}%
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
        <FindBar
          open={findBarOpen}
          onClose={handleSearchClose}
          matchCount={totalMatchCount}
          currentMatch={globalMatchIndex}
          onSearch={handleSearch}
          onNext={handleSearchNext}
          onPrevious={handleSearchPrev}
          replaceEnabled={false}
          replaceExpanded={false}
          onReplaceExpandedChange={() => {}}
        />

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
                  width: slideW * scale,
                  height: slideH * scale,
                }}
              >
                <div
                  ref={slideContentRef}
                  className="absolute inset-0 origin-top-left shadow-lg rounded-sm overflow-hidden"
                  style={{
                    width: slideW,
                    height: slideH,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                  }}
                >
                  <SlideRenderer slide={slide} theme={presentation!.theme} />
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

// ---------------------------------------------------------------------------
// Slide renderer
// ---------------------------------------------------------------------------

function SlideRenderer({ slide, theme }: { slide: PptxSlide; theme: PptxPresentation["theme"] }) {
  return (
    <div className="w-full h-full relative" style={backgroundStyle(slide.background)}>
      {slide.elements.map((el, i) => (
        <ElementRenderer key={i} element={el} theme={theme} />
      ))}
    </div>
  );
}

function backgroundStyle(bg: PptxBackground | null): React.CSSProperties {
  const base: React.CSSProperties = { backgroundColor: "#ffffff" };
  if (!bg) return base;
  if (bg.imageDataUrl) {
    return { ...base, backgroundImage: `url(${bg.imageDataUrl})`, backgroundSize: "cover" };
  }
  if (bg.fill) {
    return { ...base, ...fillToCSS(bg.fill) };
  }
  return base;
}

function fillToCSS(fill: PptxFill): React.CSSProperties {
  switch (fill.type) {
    case "solid":
      return { backgroundColor: fill.color };
    case "linear":
      return {
        background: `linear-gradient(${fill.angle}deg, ${fill.stops.map((s) => `${s.color} ${s.position}%`).join(", ")})`,
      };
    case "radial":
      return {
        background: `radial-gradient(ellipse at center, ${fill.stops.map((s) => `${s.color} ${s.position}%`).join(", ")})`,
      };
    case "pattern":
      return { backgroundColor: fill.foreground };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Element renderers
// ---------------------------------------------------------------------------

function ElementRenderer({ element, theme }: { element: PptxElement; theme: PptxPresentation["theme"] }) {
  const px = (emu: number) => emu / EMU_PER_PX;

  switch (element.type) {
    case "textbox":
      return <TextBoxRenderer el={element} px={px} />;
    case "image":
      return <ImageRenderer el={element} px={px} />;
    case "shape":
      return <ShapeRenderer el={element} px={px} />;
    case "table":
      return <TableRenderer el={element} px={px} />;
    case "chart":
      return <ChartRenderer el={element} px={px} />;
    case "group":
      return <GroupRenderer el={element} px={px} theme={theme} />;
    default:
      return null;
  }
}

function positionStyle(
  el: { x: number; y: number; width: number; height: number; rotation?: number },
  px: (emu: number) => number,
): React.CSSProperties {
  return {
    position: "absolute",
    left: px(el.x),
    top: px(el.y),
    width: px(el.width),
    height: px(el.height),
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
}

// Text box
function TextBoxRenderer({ el, px }: { el: PptxTextBox; px: (n: number) => number }) {
  return (
    <div style={{ ...positionStyle(el, px), overflow: "hidden", padding: 4 }}>
      <ParagraphsRenderer paragraphs={el.paragraphs} />
    </div>
  );
}

// Paragraphs (shared between text boxes, shapes, table cells)
function ParagraphsRenderer({ paragraphs }: { paragraphs: PptxParagraph[] }) {
  return (
    <>
      {paragraphs.map((p, i) => (
        <div
          key={i}
          style={{
            textAlign: p.alignment,
            paddingLeft: p.bulletLevel ? p.bulletLevel * 20 : undefined,
            display: "flex",
            gap: p.bulletChar ? 4 : undefined,
          }}
        >
          {p.bulletChar && (
            <span style={{ flexShrink: 0 }}>{p.bulletChar}</span>
          )}
          <span>
            {p.runs.map((r, j) => (
              <span
                key={j}
                style={{
                  fontWeight: r.bold ? 700 : 400,
                  fontStyle: r.italic ? "italic" : "normal",
                  textDecoration: r.underline ? "underline" : "none",
                  fontSize: r.fontSize,
                  fontFamily: r.fontFamily,
                  color: r.color,
                  whiteSpace: "pre-wrap",
                }}
              >
                {r.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </>
  );
}

// Image
function ImageRenderer({ el, px }: { el: PptxImage; px: (n: number) => number }) {
  return (
    <img
      src={el.dataUrl}
      alt=""
      style={{
        ...positionStyle(el, px),
        objectFit: "contain",
      }}
    />
  );
}

// Shape
function ShapeRenderer({ el, px }: { el: PptxShape; px: (n: number) => number }) {
  if (el.shapeType === "line" || el.shapeType === "arrow") {
    return <LineRenderer el={el} px={px} />;
  }

  const style: React.CSSProperties = {
    ...positionStyle(el, px),
    ...(el.fill ? fillToCSS(el.fill) : {}),
    border: el.stroke ? `${Math.max(1, el.strokeWidth)}px solid ${el.stroke}` : undefined,
    borderRadius: el.shapeType === "ellipse" ? "50%" : el.shapeType === "roundRect" ? 8 : undefined,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  };

  // Placeholder-style shapes (SmartArt, embedded objects, media)
  const isPlaceholder = el.shapeType === "other" && !el.fill && el.stroke;

  return (
    <div style={style}>
      {isPlaceholder ? (
        <div className="flex flex-col items-center gap-1 text-center">
          <PlaceholderIcon text={el.text} />
          <ParagraphsRenderer paragraphs={el.text} />
        </div>
      ) : (
        el.text.length > 0 && <ParagraphsRenderer paragraphs={el.text} />
      )}
    </div>
  );
}

function PlaceholderIcon({ text }: { text: PptxParagraph[] }) {
  const label = text[0]?.runs[0]?.text?.toLowerCase() ?? "";
  if (label.includes("media")) return <Play className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />;
  if (label.includes("chart")) return <BarChart3 className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />;
  return <Box className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />;
}

// Line / arrow
function LineRenderer({ el, px }: { el: PptxShape; px: (n: number) => number }) {
  const w = px(el.width);
  const h = px(el.height);
  const strokeColor = el.stroke ?? "#000000";
  const sw = Math.max(1, el.strokeWidth);

  return (
    <svg
      style={{
        position: "absolute",
        left: px(el.x),
        top: px(el.y),
        width: Math.max(w, 2),
        height: Math.max(h, 2),
        overflow: "visible",
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    >
      {el.shapeType === "arrow" && (
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={strokeColor} />
          </marker>
        </defs>
      )}
      <line
        x1={0}
        y1={0}
        x2={w || 1}
        y2={h || 0}
        stroke={strokeColor}
        strokeWidth={sw}
        markerEnd={el.shapeType === "arrow" ? "url(#arrowhead)" : undefined}
      />
    </svg>
  );
}

// Table
function TableRenderer({ el, px }: { el: PptxTable; px: (n: number) => number }) {
  return (
    <div style={{ ...positionStyle(el, px), overflow: "hidden" }}>
      <table
        style={{
          width: "100%",
          height: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
        }}
      >
        <tbody>
          {el.rows.map((row, ri) => (
            <tr key={ri} style={{ height: px(row.height) }}>
              {row.cells.map((cell, ci) => {
                // Skip merged-away cells
                if (cell.colspan === 0 || cell.rowspan === 0) return null;
                return (
                  <td
                    key={ci}
                    colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                    rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                    style={{
                      backgroundColor: cell.fill ?? undefined,
                      border: "1px solid #d1d5db",
                      padding: "4px 6px",
                      verticalAlign: "top",
                      fontSize: 12,
                      overflow: "hidden",
                    }}
                  >
                    <ParagraphsRenderer paragraphs={cell.paragraphs} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Chart
function ChartRenderer({ el, px }: { el: PptxChart; px: (n: number) => number }) {

  if (el.chartType === "other" || el.series.length === 0) {
    return (
      <div
        style={{
          ...positionStyle(el, px),
          border: "1px dashed #9ca3af",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(156, 163, 175, 0.05)",
        }}
      >
        <div className="flex flex-col items-center gap-1">
          <BarChart3 className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs text-muted-foreground italic">Chart</span>
        </div>
      </div>
    );
  }

  const chartData = el.categories.map((cat, i) => {
    const point: Record<string, unknown> = { name: cat };
    el.series.forEach((s, si) => {
      point[`s${si}`] = s.values[i] ?? 0;
    });
    return point;
  });

  return (
    <div style={{ ...positionStyle(el, px), overflow: "hidden" }}>
      <ResponsiveContainer width="100%" height="100%">
        {renderChart(el, chartData)}
      </ResponsiveContainer>
    </div>
  );
}

function renderChart(
  el: PptxChart,
  data: Record<string, unknown>[],
): React.ReactElement {
  const seriesColors = el.series.map((s, i) => s.color ?? DEFAULT_CHART_COLORS[i % DEFAULT_CHART_COLORS.length]);

  switch (el.chartType) {
    case "bar":
      return (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          {el.series.map((_, i) => (
            <Bar key={i} dataKey={`s${i}`} fill={seriesColors[i]} />
          ))}
        </BarChart>
      );
    case "line":
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          {el.series.map((_, i) => (
            <Line key={i} dataKey={`s${i}`} stroke={seriesColors[i]} dot={false} />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          {el.series.map((_, i) => (
            <Area key={i} dataKey={`s${i}`} fill={seriesColors[i]} stroke={seriesColors[i]} fillOpacity={0.3} />
          ))}
        </AreaChart>
      );
    case "scatter":
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          {el.series.map((_, i) => (
            <Scatter key={i} data={data} dataKey={`s${i}`} fill={seriesColors[i]} />
          ))}
        </ScatterChart>
      );
    case "pie":
    case "doughnut": {
      const pieData = el.categories.map((cat, i) => ({
        name: cat,
        value: el.series[0]?.values[i] ?? 0,
      }));
      return (
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={el.chartType === "doughnut" ? "40%" : 0}
            outerRadius="80%"
            dataKey="value"
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={seriesColors[i % seriesColors.length]} />
            ))}
          </Pie>
        </PieChart>
      );
    }
    default:
      return <BarChart data={data}><Bar dataKey="s0" fill="#6b7280" /></BarChart>;
  }
}

// Group
function GroupRenderer({
  el,
  px,
  theme,
}: {
  el: PptxGroup;
  px: (n: number) => number;
  theme: PptxPresentation["theme"];
}) {
  return (
    <div style={positionStyle(el, px)}>
      {el.children.map((child, i) => (
        <ElementRenderer key={i} element={child} theme={theme} />
      ))}
    </div>
  );
}
