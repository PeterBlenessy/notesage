import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { FindBar } from "@/components/editor/FindBar";
import type { PptxPresentation } from "@/lib/pptx-types";

// ---------------------------------------------------------------------------
// Hook: usePptxSearch
// ---------------------------------------------------------------------------

interface UsePptxSearchOptions {
  presentation: PptxPresentation | null;
  currentSlide: number;
  setCurrentSlide: (index: number) => void;
  slideContentRef: React.RefObject<HTMLDivElement | null>;
  viewerRef: React.RefObject<HTMLDivElement | null>;
  filePath: string;
}

interface PptxSearchState {
  findBarOpen: boolean;
  totalMatchCount: number;
  globalMatchIndex: number;
  handleSearch: (query: string) => void;
  handleSearchNext: () => void;
  handleSearchPrev: () => void;
  handleSearchClose: () => void;
}

export function usePptxSearch({
  presentation,
  currentSlide,
  setCurrentSlide,
  slideContentRef,
  viewerRef,
  filePath,
}: UsePptxSearchOptions): PptxSearchState {
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [, setSearchMatches] = useState<HTMLElement[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  const [totalMatchCount, setTotalMatchCount] = useState(0);
  const [globalMatchIndex, setGlobalMatchIndex] = useState(-1);

  const searchMatchesRef = useRef<HTMLElement[]>([]);

  // Pre-compute per-slide match info for search
  const slideMatchInfo = useMemo(() => {
    if (!presentation || !searchQuery) return [];
    return presentation.slides.map((s) => {
      const matches = s.searchText.toLowerCase().split(searchQuery.toLowerCase());
      return matches.length - 1;
    });
  }, [presentation, searchQuery]);

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
  }, [currentSlide, searchQuery, slideContentRef]);

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
    [presentation, slideContentRef, computeGlobalIndex],
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
        return;
      }
    }
  }, [presentation, currentSlide, searchCurrentIndex, slideMatchInfo, computeGlobalIndex, setCurrentSlide]);

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
        setSearchCurrentIndex(-2); // sentinel: go to last
        return;
      }
    }
  }, [presentation, currentSlide, searchCurrentIndex, slideMatchInfo, computeGlobalIndex, setCurrentSlide]);

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
  }, [slideContentRef, viewerRef]);

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

  return {
    findBarOpen,
    totalMatchCount,
    globalMatchIndex,
    handleSearch,
    handleSearchNext,
    handleSearchPrev,
    handleSearchClose,
  };
}

// ---------------------------------------------------------------------------
// Search bar wrapper component
// ---------------------------------------------------------------------------

interface PptxSearchBarProps {
  searchState: PptxSearchState;
}

export function PptxSearchBar({ searchState }: PptxSearchBarProps) {
  return (
    <FindBar
      open={searchState.findBarOpen}
      onClose={searchState.handleSearchClose}
      matchCount={searchState.totalMatchCount}
      currentMatch={searchState.globalMatchIndex}
      onSearch={searchState.handleSearch}
      onNext={searchState.handleSearchNext}
      onPrevious={searchState.handleSearchPrev}
      replaceEnabled={false}
      replaceExpanded={false}
      onReplaceExpandedChange={() => {}}
    />
  );
}
