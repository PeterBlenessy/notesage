import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, RectangleVertical, SquareDashedBottom } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getBinaryData } from "@/lib/binary-cache";
import { FindBar } from "@/components/editor/FindBar";
import { usePdfStore } from "@/stores/pdf-store";
import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

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

// Per-page extracted text for searching
interface PageText {
  pageNum: number;
  // Concatenated text with spaces between items for reliable searching
  text: string;
}

// A search match: which page and which occurrence on that page
interface PdfSearchMatch {
  pageNum: number;
  indexOnPage: number; // 0-based occurrence index within the page
}

/**
 * Extract searchable text from all pages.
 * Joins text items with spaces to handle PDFs that split words across items.
 */
async function extractAllPageText(
  pdf: pdfjsLib.PDFDocumentProxy,
): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter(
      (item): item is TextItem => "str" in item,
    );
    // Join with spaces to handle word boundaries, then collapse whitespace
    const text = items
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ");
    pages.push({ pageNum: i, text });
  }
  return pages;
}

/**
 * Find which pages contain matches for the query.
 * Returns one PdfSearchMatch per occurrence.
 */
function findMatches(
  pageTexts: PageText[],
  query: string,
): PdfSearchMatch[] {
  if (!query.trim()) return [];

  const needle = query.toLowerCase();
  const matches: PdfSearchMatch[] = [];

  for (const page of pageTexts) {
    const haystack = page.text.toLowerCase();
    let searchFrom = 0;
    let indexOnPage = 0;

    while (true) {
      const idx = haystack.indexOf(needle, searchFrom);
      if (idx === -1) break;
      matches.push({ pageNum: page.pageNum, indexOnPage });
      indexOnPage++;
      searchFrom = idx + 1;
    }
  }
  return matches;
}

/**
 * Render a pdfjs TextLayer into a container div for the given page.
 * The TextLayer creates invisible, positioned <span> elements that overlay
 * the canvas, enabling text selection and DOM-based search highlighting.
 */
async function renderTextLayer(
  page: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport,
  container: HTMLDivElement,
): Promise<pdfjsLib.TextLayer> {
  container.innerHTML = "";
  const textContentSource = await page.getTextContent();
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource,
    container,
    viewport,
  });
  await textLayer.render();
  return textLayer;
}

/**
 * Walk through a text layer's DOM spans, concatenate their text with spaces
 * (matching the text extraction logic), find all matches in the concatenated
 * text, and highlight by wrapping matched portions in <mark> elements.
 *
 * Returns one <mark> element per match (the first span segment of each match).
 * This ensures the DOM highlight count matches the text-based match count.
 */
function highlightTextLayerMatches(
  container: HTMLDivElement,
  query: string,
): HTMLElement[] {
  if (!query.trim()) return [];

  const needle = query.toLowerCase();

  // Collect text-bearing spans (skip structural wrappers)
  const spans: HTMLSpanElement[] = [];
  const collectSpans = (node: Element) => {
    for (const child of node.children) {
      if (child.tagName === "BR") continue;
      if (child.classList.contains("markedContent")) {
        collectSpans(child);
      } else if (child.tagName === "SPAN") {
        spans.push(child as HTMLSpanElement);
      }
    }
  };
  collectSpans(container);
  if (spans.length === 0) return [];

  // Build concatenated text with spaces between spans, matching extractAllPageText
  // Also build a character map: for each char position in fullText, record (spanIdx, charOffset)
  // Spaces between spans get spanIdx = -1.
  const charMap: Array<{ spanIdx: number; offset: number }> = [];
  let fullText = "";

  for (let i = 0; i < spans.length; i++) {
    const text = spans[i].textContent || "";
    if (i > 0) {
      fullText += " ";
      charMap.push({ spanIdx: -1, offset: -1 });
    }
    for (let j = 0; j < text.length; j++) {
      charMap.push({ spanIdx: i, offset: j });
    }
    fullText += text;
  }

  // Collapse whitespace to match extractAllPageText's .replace(/\s+/g, " ")
  // But we need to maintain the charMap mapping, so instead search the raw text
  // (single-word queries won't be affected by whitespace differences)
  const lowerText = fullText.toLowerCase();

  // Find all match positions in the concatenated text
  type MatchRange = { start: number; end: number };
  const matchRanges: MatchRange[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = lowerText.indexOf(needle, searchFrom);
    if (idx === -1) break;
    matchRanges.push({ start: idx, end: idx + needle.length });
    searchFrom = idx + 1;
  }
  if (matchRanges.length === 0) return [];

  // For each span, collect segments that need to be wrapped in <mark>
  type MarkSegment = { startOffset: number; endOffset: number; matchIdx: number };
  const spanSegments = new Map<number, MarkSegment[]>();

  for (let mi = 0; mi < matchRanges.length; mi++) {
    const { start, end } = matchRanges[mi];
    for (let pos = start; pos < end; pos++) {
      const { spanIdx, offset } = charMap[pos];
      if (spanIdx === -1) continue; // inter-span space

      if (!spanSegments.has(spanIdx)) spanSegments.set(spanIdx, []);
      const segs = spanSegments.get(spanIdx)!;
      const last = segs[segs.length - 1];

      if (last && last.matchIdx === mi && last.endOffset === offset) {
        // Extend current segment
        last.endOffset = offset + 1;
      } else {
        // Start new segment
        segs.push({ startOffset: offset, endOffset: offset + 1, matchIdx: mi });
      }
    }
  }

  // Rebuild affected spans with <mark> wrappers
  const primaryMarks = new Map<number, HTMLElement>(); // matchIdx → first mark

  for (const [spanIdx, segments] of spanSegments) {
    const span = spans[spanIdx];
    const text = span.textContent || "";

    const frag = document.createDocumentFragment();
    let lastEnd = 0;

    for (const seg of segments) {
      if (seg.startOffset > lastEnd) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd, seg.startOffset)));
      }
      const mark = document.createElement("mark");
      mark.className = "pdf-find-highlight";
      mark.textContent = text.slice(seg.startOffset, seg.endOffset);
      frag.appendChild(mark);

      if (!primaryMarks.has(seg.matchIdx)) {
        primaryMarks.set(seg.matchIdx, mark);
      }
      lastEnd = seg.endOffset;
    }

    if (lastEnd < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastEnd)));
    }

    span.textContent = "";
    span.appendChild(frag);
  }

  // Return one primary mark per match, in match order
  const highlights: HTMLElement[] = [];
  for (let mi = 0; mi < matchRanges.length; mi++) {
    const mark = primaryMarks.get(mi);
    if (mark) highlights.push(mark);
  }
  return highlights;
}

/**
 * Clear all highlights from a text layer container.
 */
function clearTextLayerHighlights(container: HTMLDivElement) {
  const marks = container.querySelectorAll("mark.pdf-find-highlight");
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
      // Normalize to merge adjacent text nodes
      parent.normalize();
    }
  }
}

export function PdfViewer({ filePath, fileName }: PdfViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pdfStore = usePdfStore();
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(pdfStore.zoomIndex);
  const [fitMode, setFitMode] = useState<FitMode>(pdfStore.fitMode);
  const [error, setError] = useState<string | null>(null);
  const renderingPages = useRef<Set<number>>(new Set());
  const renderedScales = useRef<Map<number, number>>(new Map());
  const pageHeights = useRef<Map<number, number>>(new Map());
  const textLayerScales = useRef<Map<number, number>>(new Map());
  // Counter to trigger re-renders when scale changes (for fit modes + resize)
  const [scaleVersion, setScaleVersion] = useState(0);
  // Base page dimensions (from page 1 at scale=1) for placeholder sizing
  const [pageBaseDims, setPageBaseDims] = useState<{ width: number; height: number } | null>(null);

  // Search state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<PdfSearchMatch[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  const pageTextsRef = useRef<PageText[] | null>(null);
  const lastSearchQueryRef = useRef("");
  // All <mark> elements across all pages, for navigating between matches
  const highlightMarksRef = useRef<HTMLElement[]>([]);
  // Ref mirrors of state for access from renderPage callback (avoids stale closures)
  const searchMatchesRef = useRef<PdfSearchMatch[]>([]);
  // Pending navigation: execute after a specific page finishes rendering
  const pendingNavRef = useRef<{ pageNum: number; execute: () => void } | null>(null);

  const zoom = ZOOM_STEPS[zoomIndex];

  // Load the PDF document
  useEffect(() => {
    const data = getBinaryData(filePath);
    if (!data) {
      setError("No PDF data available");
      return;
    }

    let cancelled = false;
    const loadTask = pdfjsLib.getDocument({
      data: data.slice(),
      // Disable ReadableStream transport — WKWebView doesn't fully support it
      disableStream: true,
      disableAutoFetch: true,
    });

    loadTask.promise
      .then(async (doc) => {
        if (cancelled) return;
        setPdf(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
        setError(null);
        // Reset rendering state for new document
        restoredRef.current = false;
        renderingPages.current.clear();
        renderedScales.current.clear();
        pageHeights.current.clear();
        canvasRefs.current.clear();
        textLayerRefs.current.clear();
        textLayerScales.current.clear();
        pageTextsRef.current = null;
        // Get base page dimensions for placeholder sizing
        try {
          const page1 = await doc.getPage(1);
          const vp = page1.getViewport({ scale: 1 });
          if (!cancelled) setPageBaseDims({ width: vp.width, height: vp.height });
        } catch { /* ignore */ }
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

  // Render a single page onto its canvas + text layer
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
          // Still check pending nav — page may have highlights from applySearchHighlights
          if (pendingNavRef.current && pendingNavRef.current.pageNum === pageNum) {
            const nav = pendingNavRef.current;
            pendingNavRef.current = null;
            nav.execute();
          }
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

        // Set --total-scale-factor on the page wrapper for TextLayer CSS
        const wrapper = canvas.parentElement;
        if (wrapper) {
          wrapper.style.setProperty("--total-scale-factor", String(scale));
        }

        // Render text layer for this page
        const textLayerDiv = textLayerRefs.current.get(pageNum);
        if (textLayerDiv) {
          await renderTextLayer(page, viewport, textLayerDiv);
          textLayerScales.current.set(pageNum, scale);

          // If a search is active, re-apply highlights and rebuild the marks array
          if (lastSearchQueryRef.current) {
            highlightTextLayerMatches(textLayerDiv, lastSearchQueryRef.current);
            rebuildHighlightMarks();

            // Execute pending navigation if waiting for this specific page
            if (pendingNavRef.current && pendingNavRef.current.pageNum === pageNum) {
              const nav = pendingNavRef.current;
              pendingNavRef.current = null;
              nav.execute();
            }
          }
        }
      } catch (err) {
        // Suppress pdfjs ReadableStream errors — WKWebView doesn't fully
        // support ReadableStream but rendering completes fine regardless.
        if (!String(err).includes("readableStream")) {
          console.error(`Failed to render PDF page ${pageNum}:`, err);
        }
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

  // Track current page from scroll position and save bookmark (debounced)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || totalPages === 0) return;

    let bookmarkTimer: ReturnType<typeof setTimeout> | null = null;

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

      // Debounce bookmark save (500ms after scrolling stops)
      if (bookmarkTimer) clearTimeout(bookmarkTimer);
      bookmarkTimer = setTimeout(() => {
        usePdfStore.getState().setBookmark(filePath, closest);
      }, 500);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (bookmarkTimer) clearTimeout(bookmarkTimer);
    };
  }, [totalPages, scaleVersion, filePath]);

  // Re-render all visible pages on resize (for fit modes)
  useEffect(() => {
    if (!fitMode || !scrollContainerRef.current) return;

    const observer = new ResizeObserver(() => {
      // Invalidate all rendered scales so pages re-render at new size
      renderedScales.current.clear();
      textLayerScales.current.clear();
      setScaleVersion((v) => v + 1);
    });

    observer.observe(scrollContainerRef.current);
    return () => observer.disconnect();
  }, [fitMode]);

  // When zoom/fit changes, invalidate rendered scales
  useEffect(() => {
    renderedScales.current.clear();
    textLayerScales.current.clear();
    setScaleVersion((v) => v + 1);
  }, [zoom, fitMode]);

  // Restore reading position from bookmark once PDF and page dimensions are ready
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!pdf || !pageBaseDims || restoredRef.current) return;
    restoredRef.current = true;

    const bookmark = usePdfStore.getState().getBookmark(filePath);
    if (bookmark && bookmark.page > 1) {
      setCurrentPage(bookmark.page);
      // Defer scroll until page wrappers have been laid out with placeholder dimensions
      requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const wrapper = container.querySelector(
          `[data-page-num="${bookmark.page}"]`,
        ) as HTMLElement | null;
        if (!wrapper) return;
        const containerRect = container.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const wrapperTop =
          wrapperRect.top - containerRect.top + container.scrollTop;
        container.scrollTo({
          top: wrapperTop - container.clientHeight / 3,
          behavior: "auto",
        });
      });
    }
  }, [pdf, pageBaseDims, filePath]);

  const zoomIn = () => {
    setFitMode(null);
    pdfStore.setFitMode(null);
    setZoomIndex((i) => {
      const next = Math.min(ZOOM_STEPS.length - 1, i + 1);
      pdfStore.setZoomIndex(next);
      return next;
    });
  };

  const zoomOut = () => {
    setFitMode(null);
    pdfStore.setFitMode(null);
    setZoomIndex((i) => {
      const next = Math.max(0, i - 1);
      pdfStore.setZoomIndex(next);
      return next;
    });
  };

  const toggleFitWidth = () => {
    setFitMode((f) => {
      const next = f === "width" ? null : "width";
      pdfStore.setFitMode(next);
      return next;
    });
    setZoomIndex(DEFAULT_ZOOM_INDEX);
    pdfStore.setZoomIndex(DEFAULT_ZOOM_INDEX);
  };

  const toggleFitPage = () => {
    setFitMode((f) => {
      const next = f === "page" ? null : "page";
      pdfStore.setFitMode(next);
      return next;
    });
    setZoomIndex(DEFAULT_ZOOM_INDEX);
    pdfStore.setZoomIndex(DEFAULT_ZOOM_INDEX);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode, zoom, pdf, scaleVersion]);

  // Collect all <mark> elements from text layers in page order.
  // Called after highlighting or after a new text layer renders.
  function rebuildHighlightMarks() {
    const allMarks: HTMLElement[] = [];
    const sortedPages = [...textLayerRefs.current.entries()].sort(
      ([a], [b]) => a - b,
    );
    for (const [, div] of sortedPages) {
      const marks = div.querySelectorAll("mark.pdf-find-highlight");
      for (const mark of marks) {
        allMarks.push(mark as HTMLElement);
      }
    }
    highlightMarksRef.current = allMarks;
  }

  // Apply search highlights to all rendered text layers and collect all <mark> elements
  function applySearchHighlights(query: string) {
    const sortedPages = [...textLayerRefs.current.entries()].sort(
      ([a], [b]) => a - b,
    );
    for (const [, div] of sortedPages) {
      clearTextLayerHighlights(div);
      if (query.trim()) {
        highlightTextLayerMatches(div, query);
      }
    }
    rebuildHighlightMarks();
  }

  // Navigate to a specific DOM mark — scrolls within the scroll container only
  const scrollToMark = useCallback(
    (mark: HTMLElement) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      // Clear previous active highlight
      for (const m of highlightMarksRef.current) {
        m.classList.remove("pdf-find-highlight-active");
      }
      mark.classList.add("pdf-find-highlight-active");

      // Compute mark position relative to the scroll container
      const containerRect = container.getBoundingClientRect();
      const markRect = mark.getBoundingClientRect();
      const markTop = markRect.top - containerRect.top + container.scrollTop;
      const targetScroll = markTop - container.clientHeight / 2;
      container.scrollTo({ top: targetScroll, behavior: "smooth" });
    },
    [],
  );

  // Scroll to a page's wrapper div within the scroll container (instant for reliable positioning)
  const scrollToPage = useCallback((pageNum: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const wrapper = container.querySelector(`[data-page-num="${pageNum}"]`) as HTMLElement | null;
    if (!wrapper) return;
    const containerRect = container.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const wrapperTop = wrapperRect.top - containerRect.top + container.scrollTop;
    const targetScroll = wrapperTop - container.clientHeight / 3;
    container.scrollTo({ top: targetScroll, behavior: "auto" });
  }, []);

  // Navigate to a search match by index. If the page's text layer is rendered,
  // scroll to the specific mark. Otherwise scroll to the page and defer navigation
  // until renderPage completes for that page.
  const navigateToSearchMatch = useCallback(
    (matchIndex: number, matches: PdfSearchMatch[]) => {
      if (matchIndex < 0 || matchIndex >= matches.length) return;

      const match = matches[matchIndex];

      // Helper: try to find and scroll to the mark on the page
      const tryScrollToMark = (): boolean => {
        const textLayerDiv = textLayerRefs.current.get(match.pageNum);
        if (!textLayerDiv) return false;
        const pageMarks = textLayerDiv.querySelectorAll("mark.pdf-find-highlight");
        const targetMark = pageMarks[match.indexOnPage] as HTMLElement | undefined;
        if (!targetMark) return false;
        scrollToMark(targetMark);
        return true;
      };

      if (tryScrollToMark()) return;

      // Text layer not ready — scroll to the page and defer navigation
      // until renderPage completes for this specific page
      pendingNavRef.current = { pageNum: match.pageNum, execute: () => tryScrollToMark() };
      scrollToPage(match.pageNum);
    },
    [scrollToMark, scrollToPage],
  );

  // Search handlers
  const handleSearch = useCallback(
    async (query: string) => {
      lastSearchQueryRef.current = query;

      if (!query.trim() || !pdf) {
        // Clear all highlights
        for (const [, div] of textLayerRefs.current) {
          clearTextLayerHighlights(div);
        }
        highlightMarksRef.current = [];
        setSearchMatches([]);
        setSearchCurrentIndex(-1);
        return;
      }

      // Lazy-extract text on first search
      if (!pageTextsRef.current) {
        pageTextsRef.current = await extractAllPageText(pdf);
      }

      // Find all matches across all pages (text-based, accurate count)
      const matches = findMatches(pageTextsRef.current, query);
      setSearchMatches(matches);
      searchMatchesRef.current = matches;

      // Apply highlights to rendered text layers
      applySearchHighlights(query);

      if (matches.length > 0) {
        setSearchCurrentIndex(0);
        navigateToSearchMatch(0, matches);
      } else {
        setSearchCurrentIndex(-1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdf, navigateToSearchMatch],
  );

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (searchCurrentIndex + 1) % searchMatches.length;
    setSearchCurrentIndex(next);
    navigateToSearchMatch(next, searchMatches);
  }, [searchCurrentIndex, searchMatches, navigateToSearchMatch]);

  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prev = (searchCurrentIndex - 1 + searchMatches.length) % searchMatches.length;
    setSearchCurrentIndex(prev);
    navigateToSearchMatch(prev, searchMatches);
  }, [searchCurrentIndex, searchMatches, navigateToSearchMatch]);

  const handleFindClose = useCallback(() => {
    // Focus the viewer before closing to prevent ancestor scrolling when FindBar unmounts
    viewerRef.current?.focus({ preventScroll: true });
    setFindBarOpen(false);
    lastSearchQueryRef.current = "";
    pendingNavRef.current = null;
    for (const [, div] of textLayerRefs.current) {
      clearTextLayerHighlights(div);
    }
    highlightMarksRef.current = [];
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
  }, []);

  // Listen for Cmd+F / notesage:find-open event
  useEffect(() => {
    const handleFindOpen = () => {
      setFindBarOpen(true);
    };
    window.addEventListener("notesage:find-open", handleFindOpen);
    return () => window.removeEventListener("notesage:find-open", handleFindOpen);
  }, []);

  // Always use text-based match count (accurate across all pages)
  const displayMatchCount = searchMatches.length;

  // Compute placeholder dimensions for unrendered pages so scroll positions are correct
  // even before canvases render (critical for deterministic search navigation)
  const placeholderScale = pageBaseDims
    ? getEffectiveScale(pageBaseDims.width, pageBaseDims.height)
    : null;
  const placeholderStyle: React.CSSProperties | undefined =
    placeholderScale && pageBaseDims
      ? {
          minWidth: `${pageBaseDims.width * placeholderScale}px`,
          minHeight: `${pageBaseDims.height * placeholderScale}px`,
        }
      : undefined;

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

      {/* Scrollable page area with FindBar overlay */}
      <div className="flex-1 overflow-hidden relative">
        <FindBar
          open={findBarOpen}
          onClose={handleFindClose}
          matchCount={displayMatchCount}
          currentMatch={searchCurrentIndex}
          onSearch={handleSearch}
          onNext={handleSearchNext}
          onPrevious={handleSearchPrev}
          replaceEnabled={false}
          replaceExpanded={false}
          onReplaceExpandedChange={() => {}}
        />
        <div
          ref={scrollContainerRef}
          className="h-full overflow-auto bg-muted/50 p-8"
        >
          <div className="flex flex-col items-center" style={{ gap: `${PAGE_GAP}px` }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <div
                key={pageNum}
                data-page-num={pageNum}
                className="shrink-0 relative"
                style={placeholderStyle}
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
                {/* Text layer overlay for search highlighting and text selection */}
                <div
                  ref={(el) => {
                    if (el) {
                      textLayerRefs.current.set(pageNum, el);
                    } else {
                      textLayerRefs.current.delete(pageNum);
                    }
                  }}
                  className="textLayer"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
