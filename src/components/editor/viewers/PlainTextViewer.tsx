import { useEffect, useState, useRef, useCallback } from "react";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { FindBar } from "@/components/editor/FindBar";

interface PlainTextViewerProps {
  content: string;
  fileName: string;
}

export function PlainTextViewer({ content, fileName }: PlainTextViewerProps) {
  // Search state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<HTMLElement[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);

  const preRef = useRef<HTMLPreElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const searchMatchesRef = useRef<HTMLElement[]>([]);

  // Clear search state on content change
  useEffect(() => {
    setFindBarOpen(false);
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
  }, [content]);

  // Navigate to a specific mark element within the scroll container
  const scrollToMark = useCallback((mark: HTMLElement, marks: HTMLElement[]) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Clear previous active highlight
    for (const m of marks) {
      m.classList.remove("dom-find-highlight-active");
    }
    mark.classList.add("dom-find-highlight-active");

    // Manual scroll (same pattern as PdfViewer)
    const containerRect = container.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    const offsetTop = markRect.top - containerRect.top + container.scrollTop;
    container.scrollTop = offsetTop - containerRect.height / 3;
  }, []);

  // Search handler
  const handleSearch = useCallback((query: string) => {
    const preEl = preRef.current;
    if (!preEl) return;

    clearDomHighlights(preEl);

    if (!query) {
      setSearchMatches([]);
      searchMatchesRef.current = [];
      setSearchCurrentIndex(-1);
      return;
    }

    const marks = highlightDomMatches(preEl, query);
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

  // Navigate to next match
  const handleNext = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const nextIndex = (prev + 1) % marks.length;
      scrollToMark(marks[nextIndex], marks);
      return nextIndex;
    });
  }, [scrollToMark]);

  // Navigate to previous match
  const handlePrevious = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const prevIndex = (prev - 1 + marks.length) % marks.length;
      scrollToMark(marks[prevIndex], marks);
      return prevIndex;
    });
  }, [scrollToMark]);

  // Close handler
  const handleClose = useCallback(() => {
    setFindBarOpen(false);
    if (preRef.current) {
      clearDomHighlights(preRef.current);
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

  return (
    <div ref={viewerRef} className="h-full flex flex-col" tabIndex={-1}>
      {/* Toolbar */}
      <div className="h-9 border-b border-border px-3 flex items-center shrink-0 bg-background">
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {fileName}
        </span>
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
        <div ref={scrollContainerRef} className="h-full overflow-auto">
          <div className="max-w-[720px] mx-auto py-10 px-8">
            <pre
              ref={preRef}
              className="text-sm font-mono whitespace-pre-wrap break-words text-foreground leading-relaxed"
            >
              {content}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
