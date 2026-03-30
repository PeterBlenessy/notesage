import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FindBar } from "@/components/editor/FindBar";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";
import { useSettingsStore } from "@/stores/settings-store";
import { toast } from "sonner";

interface HtmlViewerProps {
  content: string;
  filePath: string;
  fileName: string;
  projectRoot?: string;
}

export function HtmlViewer({ content, filePath, fileName, projectRoot }: HtmlViewerProps) {
  const [htmlDoc, setHtmlDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const theme = useSettingsStore((s) => s.theme);

  // Search state
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<HTMLElement[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const searchMatchesRef = useRef<HTMLElement[]>([]);

  // Render HTML via Tauri command
  useEffect(() => {
    let cancelled = false;

    const renderHtml = async () => {
      setLoading(true);
      setError(null);
      try {
        const resolvedTheme = theme === "system"
          ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
          : theme;

        const title = fileName.replace(/\.[^.]+$/, "");
        const result = await invoke<string>("render_html", {
          markdown: content,
          title,
          theme: resolvedTheme,
          includeStyles: true,
          projectRoot: projectRoot ?? null,
        });

        if (!cancelled) {
          setHtmlDoc(result);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Failed to render HTML: ${err}`);
          setLoading(false);
        }
      }
    };

    renderHtml();
    return () => { cancelled = true; };
  }, [content, theme, fileName, projectRoot]);

  // Copy HTML to clipboard
  const handleCopyHtml = useCallback(async () => {
    try {
      const resolvedTheme = theme === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;

      // Get body-only fragment for clipboard
      const bodyHtml = await invoke<string>("render_html", {
        markdown: content,
        title: fileName.replace(/\.[^.]+$/, ""),
        theme: resolvedTheme,
        includeStyles: false,
        projectRoot: projectRoot ?? null,
      });

      // Write both text/html and text/plain to clipboard
      const htmlBlob = new Blob([bodyHtml], { type: "text/html" });
      const textBlob = new Blob([content], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": htmlBlob,
          "text/plain": textBlob,
        }),
      ]);

      toast.success("HTML copied to clipboard");
    } catch (err) {
      toast.error(`Failed to copy: ${err}`);
    }
  }, [content, theme, fileName, projectRoot]);

  // Export HTML to file
  const handleExportHtml = useCallback(async () => {
    try {
      if (!htmlDoc) return;

      const defaultName = fileName.replace(/\.[^.]+$/, ".html");
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "HTML", extensions: ["html", "htm"] }],
      });

      if (savePath) {
        await invoke("write_file", { path: savePath, content: htmlDoc });
        toast.success("HTML exported");
      }
    } catch (err) {
      toast.error(`Failed to export: ${err}`);
    }
  }, [htmlDoc, fileName]);

  // Clear search state on file change
  useEffect(() => {
    setFindBarOpen(false);
    setSearchMatches([]);
    searchMatchesRef.current = [];
    setSearchCurrentIndex(-1);
  }, [filePath]);

  // Navigate to a search match
  const scrollToMark = useCallback((mark: HTMLElement, marks: HTMLElement[]) => {
    for (const m of marks) {
      m.classList.remove("dom-find-highlight-active");
    }
    mark.classList.add("dom-find-highlight-active");
    mark.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  // Search handler — operates on iframe content
  const handleSearch = useCallback((query: string) => {
    const doc = iframeRef.current?.contentDocument;
    const contentEl = doc?.querySelector(".notesage-document") as HTMLElement | null;
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

  const handleNext = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const nextIndex = (prev + 1) % marks.length;
      scrollToMark(marks[nextIndex], marks);
      return nextIndex;
    });
  }, [scrollToMark]);

  const handlePrevious = useCallback(() => {
    const marks = searchMatchesRef.current;
    if (marks.length === 0) return;
    setSearchCurrentIndex((prev) => {
      const prevIndex = (prev - 1 + marks.length) % marks.length;
      scrollToMark(marks[prevIndex], marks);
      return prevIndex;
    });
  }, [scrollToMark]);

  const handleClose = useCallback(() => {
    setFindBarOpen(false);
    const doc = iframeRef.current?.contentDocument;
    const contentEl = doc?.querySelector(".notesage-document") as HTMLElement | null;
    if (contentEl) {
      clearDomHighlights(contentEl);
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

  return (
    <div ref={viewerRef} className="h-full flex flex-col" tabIndex={-1}>
      {/* Toolbar */}
      <div className="h-9 border-b border-border px-3 flex items-center gap-2 shrink-0 bg-background">
        <span className="text-xs text-muted-foreground">HTML Preview</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={handleCopyHtml}
          disabled={loading}
        >
          <Copy className="h-3 w-3" strokeWidth={1.5} />
          Copy HTML
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={handleExportHtml}
          disabled={loading || !htmlDoc}
        >
          <Download className="h-3 w-3" strokeWidth={1.5} />
          Export
        </Button>
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
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Rendering HTML...</p>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            sandbox="allow-same-origin"
            srcDoc={htmlDoc ?? ""}
            className="w-full h-full border-0"
            title="HTML Preview"
          />
        )}
      </div>
    </div>
  );
}
