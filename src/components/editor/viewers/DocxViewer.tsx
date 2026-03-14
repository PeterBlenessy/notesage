import { useEffect, useState, useRef, useCallback } from "react";
import DOMPurify from "dompurify";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBinaryData } from "@/lib/binary-cache";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { FindBar } from "@/components/editor/FindBar";
import mammoth from "mammoth";

interface DocxViewerProps {
  filePath: string;
  fileName: string;
  onConvertToMarkdown?: (html: string, fileName: string) => void;
}

export function DocxViewer({ filePath, fileName, onConvertToMarkdown }: DocxViewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<HTMLElement[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const searchMatchesRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const data = getBinaryData(filePath);
    if (!data) {
      setError("No DOCX data available");
      return;
    }

    mammoth
      .convertToHtml({ arrayBuffer: data.buffer })
      .then((result) => {
        setHtml(DOMPurify.sanitize(result.value));
        if (result.messages.length > 0) {
          console.warn("mammoth warnings:", result.messages);
        }
      })
      .catch((err) => {
        setError(`Failed to render DOCX: ${err.message}`);
      });
  }, [filePath]);

  // Clear search state on file change
  useEffect(() => {
    setFindBarOpen(false);
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
  }, [filePath]);

  // Navigate to a specific mark element within the scroll container
  const scrollToMark = useCallback((mark: HTMLElement, marks: HTMLElement[]) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Clear previous active highlight
    for (const m of marks) {
      m.classList.remove("dom-find-highlight-active");
    }
    mark.classList.add("dom-find-highlight-active");

    // Manual scroll (same pattern as PdfViewer — no scrollIntoView)
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

  if (html === null) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-sm">Loading document...</p>
      </div>
    );
  }

  return (
    <div ref={viewerRef} className="h-full flex flex-col" tabIndex={-1}>
      {/* Toolbar */}
      <div className="h-9 border-b border-border px-3 flex items-center gap-2 shrink-0 bg-background">
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {fileName}
        </span>
        <span className="flex-1" />
        {onConvertToMarkdown && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onConvertToMarkdown(html, fileName)}
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
        <div ref={scrollContainerRef} className="h-full overflow-auto">
          <div className="max-w-[720px] mx-auto py-10 px-8">
            <div
              ref={contentRef}
              className="docx-content prose prose-slate dark:prose-invert max-w-none text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
