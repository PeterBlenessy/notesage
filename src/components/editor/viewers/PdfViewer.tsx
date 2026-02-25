import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize } from "lucide-react";
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

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const DEFAULT_ZOOM_INDEX = 2; // 1x

export function PdfViewer({ filePath, fileName }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [fitMode, setFitMode] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const renderingRef = useRef(false);

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
      })
      .catch((err) => {
        if (cancelled) return;
        setError(`Failed to load PDF: ${err.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Render the current page
  const renderPage = useCallback(async () => {
    if (!pdf || !canvasRef.current || renderingRef.current) return;
    renderingRef.current = true;

    try {
      const page = await pdf.getPage(currentPage);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let scale = zoom;

      if (fitMode && containerRef.current) {
        const containerWidth = containerRef.current.clientWidth - 64; // padding
        const viewport = page.getViewport({ scale: 1 });
        scale = containerWidth / viewport.width;
      }

      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;

      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      await page.render({
        canvasContext: ctx,
        canvas,
        viewport,
      }).promise;
    } catch (err) {
      console.error("Failed to render PDF page:", err);
    } finally {
      renderingRef.current = false;
    }
  }, [pdf, currentPage, zoom, fitMode]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  // Re-render on container resize (for fit mode)
  useEffect(() => {
    if (!fitMode || !containerRef.current) return;
    const observer = new ResizeObserver(() => renderPage());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fitMode, renderPage]);

  const goToPrev = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goToNext = () => setCurrentPage((p) => Math.min(totalPages, p + 1));
  const zoomIn = () => {
    setFitMode(false);
    setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
  };
  const zoomOut = () => {
    setFitMode(false);
    setZoomIndex((i) => Math.max(0, i - 1));
  };
  const toggleFit = () => {
    setFitMode((f) => !f);
    setZoomIndex(DEFAULT_ZOOM_INDEX);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goToNext();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [totalPages]);

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
        <Button variant="ghost" size="icon-xs" onClick={goToPrev} disabled={currentPage <= 1} title="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums min-w-[60px] text-center">
          {currentPage} / {totalPages}
        </span>
        <Button variant="ghost" size="icon-xs" onClick={goToNext} disabled={currentPage >= totalPages} title="Next page">
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <Button variant="ghost" size="icon-xs" onClick={zoomOut} title="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums min-w-[40px] text-center">
          {fitMode ? "Fit" : `${Math.round(zoom * 100)}%`}
        </span>
        <Button variant="ghost" size="icon-xs" onClick={zoomIn} title="Zoom in">
          <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={toggleFit}
          className={fitMode ? "bg-accent text-foreground" : "text-muted-foreground"}
          title="Fit to width"
        >
          <Maximize className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 overflow-auto flex justify-center bg-muted/50 p-8">
        <canvas
          ref={canvasRef}
          className="shadow-md rounded-sm"
          style={{ backgroundColor: "white" }}
        />
      </div>
    </div>
  );
}
