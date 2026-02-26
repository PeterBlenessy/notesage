import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, RectangleVertical, SquareDashedBottom } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getBinaryData } from "@/lib/binary-cache";
import * as pdfjsLib from "pdfjs-dist";

// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfViewerProps {
  filePath: string;
  fileName: string;
}

const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0,
  2.5, 3.0, 4.0,
];
const DEFAULT_ZOOM_INDEX = 7; // 1.0

type FitMode = "width" | "page" | null;

const PAGE_GAP = 16;

export function PdfViewer({ filePath, fileName }: PdfViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [error, setError] = useState<string | null>(null);
  const renderingPages = useRef<Set<number>>(new Set());
  const renderedScales = useRef<Map<number, number>>(new Map());
  const pageHeights = useRef<Map<number, number>>(new Map());
  // Counter to trigger re-renders when scale changes (for fit modes + resize)
  const [scaleVersion, setScaleVersion] = useState(0);

  const zoom = ZOOM_STEPS[zoomIndex];

  // Load the PDF document
  useEffect(() => {
    const data = getBinaryData(filePath);
    if (!data) {
      setError("No PDF data available");
      return;
    }

    let cancelled = false;
    const loadTask = pdfjsLib.getDocument({ data: data.slice() });

    loadTask.promise
      .then((doc) => {
        if (cancelled) return;
        setPdf(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
        setError(null);
        // Reset rendering state for new document
        renderingPages.current.clear();
        renderedScales.current.clear();
        pageHeights.current.clear();
        canvasRefs.current.clear();
      })
      .catch((err) => {
        if (cancelled) return;
        setError(`Failed to load PDF: ${err.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Compute the effective scale for a given page
  const getEffectiveScale = useCallback(
    (pageWidth: number, pageHeight: number) => {
      if (!fitMode || !scrollContainerRef.current) return zoom;

      const container = scrollContainerRef.current;
      const containerWidth = container.clientWidth - 64; // padding (p-8 = 32px each side)

      if (fitMode === "width") {
        return containerWidth / pageWidth;
      }
      // fitMode === "page"
      const containerHeight = container.clientHeight - 64;
      return Math.min(containerWidth / pageWidth, containerHeight / pageHeight);
    },
    [fitMode, zoom],
  );

  // Render a single page onto its canvas
  const renderPage = useCallback(
    async (pageNum: number) => {
      if (!pdf || renderingPages.current.has(pageNum)) return;

      const canvas = canvasRefs.current.get(pageNum);
      if (!canvas) return;

      renderingPages.current.add(pageNum);

      try {
        const page = await pdf.getPage(pageNum);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = getEffectiveScale(
          baseViewport.width,
          baseViewport.height,
        );

        // Skip if already rendered at this scale
        if (renderedScales.current.get(pageNum) === scale) {
          renderingPages.current.delete(pageNum);
          return;
        }

        const viewport = page.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;

        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        await page.render({
          canvasContext: ctx,
          canvas,
          viewport,
        }).promise;

        renderedScales.current.set(pageNum, scale);
        pageHeights.current.set(pageNum, viewport.height);
      } catch (err) {
        console.error(`Failed to render PDF page ${pageNum}:`, err);
      } finally {
        renderingPages.current.delete(pageNum);
      }
    },
    [pdf, getEffectiveScale],
  );

  // IntersectionObserver for lazy rendering
  useEffect(() => {
    if (!pdf || totalPages === 0) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNum = Number(
              (entry.target as HTMLElement).dataset.pageNum,
            );
            if (pageNum) renderPage(pageNum);
          }
        }
      },
      {
        root: container,
        rootMargin: "200px 0px",
        threshold: 0,
      },
    );

    // Observe all page wrappers
    const wrappers = container.querySelectorAll("[data-page-num]");
    wrappers.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [pdf, totalPages, renderPage, scaleVersion]);

  // Track current page from scroll position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || totalPages === 0) return;

    const handleScroll = () => {
      const wrappers = container.querySelectorAll("[data-page-num]");
      const containerTop = container.scrollTop;
      const containerMid = containerTop + container.clientHeight / 3;

      let closest = 1;
      let closestDist = Infinity;

      wrappers.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const top = htmlEl.offsetTop;
        const dist = Math.abs(top - containerMid);
        if (dist < closestDist) {
          closestDist = dist;
          closest = Number(htmlEl.dataset.pageNum) || 1;
        }
      });

      setCurrentPage(closest);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [totalPages, scaleVersion]);

  // Re-render all visible pages on resize (for fit modes)
  useEffect(() => {
    if (!fitMode || !scrollContainerRef.current) return;

    const observer = new ResizeObserver(() => {
      // Invalidate all rendered scales so pages re-render at new size
      renderedScales.current.clear();
      setScaleVersion((v) => v + 1);
    });

    observer.observe(scrollContainerRef.current);
    return () => observer.disconnect();
  }, [fitMode]);

  // When zoom/fit changes, invalidate rendered scales
  useEffect(() => {
    renderedScales.current.clear();
    setScaleVersion((v) => v + 1);
  }, [zoom, fitMode]);

  const zoomIn = () => {
    setFitMode(null);
    setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
  };

  const zoomOut = () => {
    setFitMode(null);
    setZoomIndex((i) => Math.max(0, i - 1));
  };

  const toggleFitWidth = () => {
    setFitMode((f) => (f === "width" ? null : "width"));
    setZoomIndex(DEFAULT_ZOOM_INDEX);
  };

  const toggleFitPage = () => {
    setFitMode((f) => (f === "page" ? null : "page"));
    setZoomIndex(DEFAULT_ZOOM_INDEX);
  };

  // Compute display zoom percentage
  const getDisplayZoom = useCallback(() => {
    if (!fitMode) return `${Math.round(zoom * 100)}%`;
    if (!pdf || !scrollContainerRef.current) return "Fit";

    // Approximate from first page dimensions (most PDFs are uniform)
    const container = scrollContainerRef.current;
    const containerWidth = container.clientWidth - 64;
    // Use a standard A4-ish ratio as approximation: 595 x 842 points
    const approxPageW = 595;
    const approxPageH = 842;

    let scale: number;
    if (fitMode === "width") {
      scale = containerWidth / approxPageW;
    } else {
      const containerHeight = container.clientHeight - 64;
      scale = Math.min(containerWidth / approxPageW, containerHeight / approxPageH);
    }
    return `${Math.round(scale * 100)}%`;
  }, [fitMode, zoom, pdf, scaleVersion]);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
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
          {getDisplayZoom()}
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
        <span className="text-xs text-muted-foreground tabular-nums">
          Page {currentPage} / {totalPages}
        </span>
      </div>

      {/* Scrollable page area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto bg-muted/50 p-8"
      >
        <div className="flex flex-col items-center" style={{ gap: `${PAGE_GAP}px` }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
            <div
              key={pageNum}
              data-page-num={pageNum}
              className="shrink-0"
            >
              <canvas
                ref={(el) => {
                  if (el) {
                    canvasRefs.current.set(pageNum, el);
                  } else {
                    canvasRefs.current.delete(pageNum);
                  }
                }}
                className="shadow-md rounded-sm"
                style={{ backgroundColor: "white" }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
