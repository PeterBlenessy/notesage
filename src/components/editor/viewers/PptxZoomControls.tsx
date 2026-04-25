import { useState, useEffect, useCallback } from "react";
import {
  ZoomIn,
  ZoomOut,
  RectangleVertical,
  SquareDashedBottom,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { PptxPresentation } from "@/lib/pptx-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const DEFAULT_ZOOM_INDEX = 2; // 1.0
const EMU_PER_PX = 9525;

type FitMode = "width" | "page" | null;

// ---------------------------------------------------------------------------
// Hook: usePptxZoom
// ---------------------------------------------------------------------------

interface UsePptxZoomOptions {
  presentation: PptxPresentation | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

interface PptxZoomState {
  scale: number;
  fitMode: FitMode;
  zoomIn: () => void;
  zoomOut: () => void;
  toggleFitWidth: () => void;
  toggleFitPage: () => void;
  updateScale: (zoomIndex: number, fitMode: FitMode) => void;
}

export function usePptxZoom({ presentation, scrollContainerRef }: UsePptxZoomOptions): PptxZoomState {
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [fitMode, setFitMode] = useState<FitMode>("page");
  const [scale, setScale] = useState(1);

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
    [presentation, scrollContainerRef],
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
  }, [fitMode, zoomIndex, updateScale, scrollContainerRef]);

  // Initial fit
  useEffect(() => {
    if (presentation) {
      requestAnimationFrame(() => updateScale(DEFAULT_ZOOM_INDEX, "page"));
    }
  }, [presentation, updateScale]);

  // Cmd+scroll wheel zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.metaKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomInFn();
      else zoomOutFn();
    };
    const el = scrollContainerRef.current;
    if (el) {
      el.addEventListener("wheel", handleWheel, { passive: false });
      return () => el.removeEventListener("wheel", handleWheel);
    }
  });

  const zoomInFn = () => {
    setFitMode(null);
    setZoomIndex((i) => {
      const next = Math.min(ZOOM_STEPS.length - 1, i + 1);
      setScale(ZOOM_STEPS[next]);
      return next;
    });
  };

  const zoomOutFn = () => {
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

  return {
    scale,
    fitMode,
    zoomIn: zoomInFn,
    zoomOut: zoomOutFn,
    toggleFitWidth,
    toggleFitPage,
    updateScale,
  };
}

// ---------------------------------------------------------------------------
// Zoom toolbar buttons
// ---------------------------------------------------------------------------

interface PptxZoomControlsProps {
  zoom: PptxZoomState;
}

export function PptxZoomControls({ zoom }: PptxZoomControlsProps) {
  return (
    <>
      <Button variant="ghost" size="icon-xs" onClick={zoom.zoomOut} title="Zoom out">
        <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.5} />
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums min-w-[40px] text-center">
        {Math.round(zoom.scale * 100)}%
      </span>
      <Button variant="ghost" size="icon-xs" onClick={zoom.zoomIn} title="Zoom in">
        <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.5} />
      </Button>
      <Separator orientation="vertical" className="h-4 mx-1" />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={zoom.toggleFitWidth}
        className={zoom.fitMode === "width" ? "bg-[var(--color-accent-primary)]/12 text-foreground" : "text-muted-foreground"}
        title="Fit to width"
      >
        <SquareDashedBottom className="h-3.5 w-3.5" strokeWidth={1.5} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={zoom.toggleFitPage}
        className={zoom.fitMode === "page" ? "bg-[var(--color-accent-primary)]/12 text-foreground" : "text-muted-foreground"}
        title="Fit to page"
      >
        <RectangleVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
      </Button>
    </>
  );
}
