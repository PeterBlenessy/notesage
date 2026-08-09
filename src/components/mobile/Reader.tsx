import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { ChevronLeft, CloudDownload, AlertCircle, FileQuestion } from "lucide-react";
import { iosReadFile, iosReadBinary, iosEnsureDownloaded } from "@/lib/ios-api";
import { renderMarkdownFragment } from "@/lib/markdown-render";
import { useMobileStore } from "@/stores/mobile-store";
import { classifyFile } from "./FileRow";
import { Button } from "@/components/ui/button";
import { setBinaryData, clearBinaryData } from "@/lib/binary-cache";
import { Island, ChromeButton, SearchIsland, CONTENT_INSETS } from "./Chrome";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";

// Lazy-loaded — pdf.js is heavy (and pulls in browser-only globals like
// DOMMatrix), so it's only imported when a PDF is actually opened.
const PdfViewer = lazy(() =>
  import("@/components/editor/viewers/PdfViewer").then((m) => ({ default: m.PdfViewer })),
);

/**
 * Resolve a relative markdown link against the directory of the current doc.
 * Returns null when the link would escape the library root — the reader must
 * never navigate outside the grant.
 */
export function resolveRelativeLink(currentRelPath: string, href: string): string | null {
  const clean = decodeURIComponent(href.split(/[?#]/)[0]);
  if (!clean) return null;
  const baseDir = currentRelPath.includes("/")
    ? currentRelPath.slice(0, currentRelPath.lastIndexOf("/"))
    : "";
  const joined = clean.startsWith("/") ? clean.slice(1) : baseDir ? `${baseDir}/${clean}` : clean;
  const out: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes the library root
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length ? out.join("/") : null;
}

type ReaderState =
  | { status: "loading" }
  | { status: "downloading" }
  | { status: "error"; message: string }
  | { status: "unsupported" }
  | { status: "text"; content: string }
  | { status: "markdown"; html: string }
  | { status: "image"; url: string }
  | { status: "html"; url: string; previewId: string }
  | { status: "pdf"; filePath: string };

/**
 * Mobile reader (PRD task #14). Renders markdown (via the shared Rust comrak
 * pipeline, same as the desktop preview), self-contained HTML reports with
 * their scripts running, plain text / code, images, and PDFs (lazy-loaded
 * desktop PdfViewer); EPUB/DOCX/PPTX show an unsupported state in v1. iCloud
 * placeholders are downloaded on demand.
 */
export function Reader() {
  const openDoc = useMobileStore((s) => s.openDoc);
  const goBack = useMobileStore((s) => s.goBack);
  const openDocument = useMobileStore((s) => s.openDocument);
  const [state, setState] = useState<ReaderState>({ status: "loading" });
  const articleRef = useRef<HTMLElement | null>(null);
  // Raw markdown of the open doc — kept so a theme flip can re-render without
  // re-reading the file (and without re-fetching PDFs/images at all).
  const rawMarkdownRef = useRef<string | null>(null);
  const renderedThemeRef = useRef<"light" | "dark" | null>(null);

  // The resolved app theme, tracked via the `.dark` class ThemeProvider owns.
  // Markdown must re-render when it flips: syntect's syntax colors are inline
  // styles from the Rust renderer, and mermaid diagrams bake their theme and
  // background at render time — neither follows a CSS-variable swap.
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setResolvedTheme(root.classList.contains("dark") ? "dark" : "light");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const relPath = openDoc?.relPath ?? "";
  const name = openDoc?.name ?? "";
  const kind = useMemo(() => (name ? classifyFile(name) : "other"), [name]);

  // Find-in-document (markdown/text): matches marked via the shared
  // dom-search utility the desktop's DOCX/plain viewers use. PDFs search
  // through the viewer's own toolbar; HTML reports are cross-origin
  // sandboxed frames (deferred).
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [findTotal, setFindTotal] = useState(0);
  const findMarksRef = useRef<HTMLElement[]>([]);
  const searchable =
    state.status === "markdown" || state.status === "text";

  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const t = setTimeout(() => {
      clearDomHighlights(root);
      findMarksRef.current = findQuery ? highlightDomMatches(root, findQuery) : [];
      setFindIndex(0);
      setFindTotal(findMarksRef.current.length);
      if (findMarksRef.current.length > 0) {
        findMarksRef.current[0].classList.add("dom-find-highlight-active");
        findMarksRef.current[0].scrollIntoView({ block: "center" });
      }
    }, 150);
    return () => clearTimeout(t);
  }, [findQuery, state]);

  const goToMatch = (next: boolean) => {
    const marks = findMarksRef.current;
    if (marks.length === 0) return;
    const cur = findIndex;
    const idx = (cur + (next ? 1 : marks.length - 1)) % marks.length;
    marks[cur]?.classList.remove("dom-find-highlight-active");
    marks[idx].classList.add("dom-find-highlight-active");
    marks[idx].scrollIntoView({ block: "center" });
    setFindIndex(idx);
  };

  const load = useCallback(async () => {
    if (!relPath) return;
    setState({ status: "loading" });
    try {
      if (kind === "image") {
        const bytes = await iosReadBinary(relPath);
        // Copy into a fresh ArrayBuffer-backed view so the BlobPart type is
        // unambiguous (TS 6 distinguishes ArrayBuffer from SharedArrayBuffer).
        const buffer = bytes.slice().buffer;
        const blob = new Blob([buffer], { type: imageMimeFor(name) });
        setState({ status: "image", url: URL.createObjectURL(blob) });
        return;
      }
      if (kind === "pdf") {
        // pdf.js renders from in-memory bytes (works in WKWebView). Feed the
        // shared binary cache the desktop PdfViewer reads from, keyed by the
        // relative path, then mount the full viewer (zoom / fit / search).
        const bytes = await iosReadBinary(relPath);
        setBinaryData(relPath, bytes);
        setState({ status: "pdf", filePath: relPath });
        return;
      }
      if (kind === "html") {
        // Served from the `htmlpreview://` custom scheme — the same mechanism
        // as the desktop HtmlViewer, for the same reason: srcDoc, blob: AND
        // data: documents all INHERIT the host window's CSP, and in the
        // embedded build Tauri's nonce injection neutralises 'unsafe-inline',
        // so a report's own <style>/<script> blocks are refused and it renders
        // bare (dev builds hide this — Vite serves the app with no CSP). A
        // custom-scheme response carries its own empty policy; the
        // `sandbox="allow-scripts"` attribute is what isolates the document.
        const raw = await iosReadFile(relPath);
        const id = crypto.randomUUID();
        await invoke("html_preview_register", { id, content: raw });
        setState({ status: "html", url: `htmlpreview://localhost/${id}`, previewId: id });
        return;
      }
      if (kind === "markdown" || kind === "text") {
        const raw = await iosReadFile(relPath);
        if (kind === "markdown") {
          // Rendered by the same comrak pipeline as the desktop, so a note
          // looks the same on both. Frontmatter stripping happens there too.
          // The theme drives syntect's syntax-highlight colors, which are
          // inline styles — without it, code blocks stay light in dark mode.
          // Read the theme from the DOM at call time (not a dependency):
          // depending on resolvedTheme here made EVERY document kind re-load
          // on a theme flip — re-downloading an open PDF because the sun set.
          // The raw source is cached so the theme effect below can re-render
          // markdown without touching the file again.
          const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
          const html = await renderMarkdownFragment(raw, theme);
          rawMarkdownRef.current = raw;
          renderedThemeRef.current = theme;
          setState({ status: "markdown", html });
        } else {
          setState({ status: "text", content: raw });
        }
        return;
      }
      // EPUB / DOCX / PPTX / unknown — not previewable in v1.
      setState({ status: "unsupported" });
    } catch (err) {
      // The file may be an iCloud placeholder — kick off a download and let the
      // user retry once it's local.
      try {
        const dl = await iosEnsureDownloaded(relPath);
        if (dl === "downloading") {
          setState({ status: "downloading" });
          return;
        }
      } catch {
        /* fall through to the original read error */
      }
      setState({ status: "error", message: String(err) });
    }
  }, [relPath, kind]);

  useEffect(() => {
    rawMarkdownRef.current = null;
    renderedThemeRef.current = null;
    void load();
  }, [load]);

  // Re-render the open MARKDOWN doc when the theme flips — from the cached
  // raw source, never by re-reading the file. Other kinds are untouched.
  useEffect(() => {
    const raw = rawMarkdownRef.current;
    if (raw === null || renderedThemeRef.current === resolvedTheme) return;
    let cancelled = false;
    void (async () => {
      const html = await renderMarkdownFragment(raw, resolvedTheme);
      if (cancelled) return;
      renderedThemeRef.current = resolvedTheme;
      setState({ status: "markdown", html });
    })();
    return () => {
      cancelled = true;
    };
  }, [resolvedTheme]);

  // Intercept link taps in the rendered article. Without this, an external
  // link navigates the app's own WebView (a dead end with no back chrome —
  // a store-review rejection class) and a relative note link 404s the frame.
  useEffect(() => {
    if (state.status !== "markdown") return;
    const root = articleRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      if (/^(https?:|mailto:)/i.test(href)) {
        void openUrl(href).catch(() => toast.error("Couldn't open the link"));
        return;
      }
      if (href.startsWith("#")) return; // in-page anchors: no-op in v1
      const target = resolveRelativeLink(relPath, href);
      if (!target) {
        toast.error("This link points outside your library");
        return;
      }
      openDocument({ relPath: target, name: target.split("/").pop() ?? target });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [state, relPath, openDocument]);

  // Revoke the image object URL when the document changes or unmounts.
  useEffect(() => {
    if (state.status !== "image") return;
    const url = state.url;
    return () => URL.revokeObjectURL(url);
  }, [state]);

  // Free the registered HTML preview document when it changes or unmounts.
  const htmlPreviewId = state.status === "html" ? state.previewId : null;
  useEffect(() => {
    if (!htmlPreviewId) return;
    return () => {
      void invoke("html_preview_unregister", { id: htmlPreviewId }).catch(() => {});
    };
  }, [htmlPreviewId]);

  // Render ```mermaid fences into SVG diagrams — parity with the desktop
  // editor's Mermaid node view, using the same lazily-imported library. The
  // Rust renderer leaves these fences as code blocks with a
  // `language-mermaid` class (it only swaps them for SVG when the desktop
  // passes pre-rendered ones). A diagram that fails to parse keeps its code
  // block — same graceful degradation as the desktop.
  useEffect(() => {
    if (state.status !== "markdown") return;
    const root = articleRef.current;
    if (!root) return;
    const blocks = Array.from(root.querySelectorAll('pre code[class*="language-mermaid"]'));
    if (blocks.length === 0) return;
    let cancelled = false;
    // The cleanup closure iterates this array by REFERENCE, and ids are pushed
    // as soon as each diagram registers — populating it only after the loop
    // finished leaked every already-registered document when the user backed
    // out mid-render (the htmlpreview store has no eviction).
    const cleanupIds: string[] = [];
    void (async () => {
      const mermaid = (await import("mermaid")).default;
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        theme: resolvedTheme === "dark" ? "dark" : "default",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        securityLevel: "strict",
        flowchart: { useMaxWidth: true },
        sequence: { useMaxWidth: true },
      });
      for (const [i, code] of blocks.entries()) {
        const source = code.textContent ?? "";
        try {
          const { svg } = await mermaid.render(`mobile-mermaid-${Date.now()}-${i}`, source);
          if (cancelled) return;
          const wrap = document.createElement("div");
          // Inline styles, not Tailwind: editor.css is un-layered and would
          // beat utility classes; inline always wins.
          wrap.style.cssText = "margin:1em 0;max-width:100%";
          // The SVG goes into a fully sandboxed iframe served from the
          // htmlpreview:// scheme — the same own-empty-policy mechanism as the
          // HTML reports. Every lighter-weight option fails somewhere:
          // innerHTML loses the SVG's internal <style> to the embedded
          // build's CSP nonce rewrite (black boxes); an <img> — whether from
          // a data: URL or the scheme — hits WebKit's refusal to render
          // <foreignObject> inside an SVG-as-image, which mermaid emits for
          // composite-state labels (broken-image icon on exactly the bigger
          // diagrams). A sandboxed document renders foreignObject fine.
          // `sandbox=""` (no allowances at all): the diagram needs no
          // scripts, so it gets none.
          const ratio = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(svg);
          // WebKit gives a sandboxed iframe an opaque white backing —
          // `background: transparent` in the framed document does nothing —
          // so paint it with the app's actual computed background instead.
          const bg = getComputedStyle(root).backgroundColor || "transparent";
          const doc =
            `<!doctype html><html><head><meta charset="utf-8">` +
            `<style>html,body{margin:0;padding:0;background:${bg}}svg{display:block;width:100%;height:auto}</style>` +
            `</head><body>${svg}</body></html>`;
          const id = crypto.randomUUID();
          await invoke("html_preview_register", { id, content: doc });
          if (cancelled) {
            void invoke("html_preview_unregister", { id }).catch(() => {});
            return;
          }
          cleanupIds.push(id);
          const frame = document.createElement("iframe");
          frame.src = `htmlpreview://localhost/${id}`;
          frame.setAttribute("sandbox", "");
          frame.title = "Mermaid diagram";
          frame.style.cssText =
            "display:block;width:100%;border:0;" +
            (ratio ? `aspect-ratio:${ratio[1]}/${ratio[2]}` : "height:20rem");
          wrap.appendChild(frame);
          code.closest("pre")?.replaceWith(wrap);
        } catch {
          /* leave the code block as readable source */
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const id of cleanupIds) {
        void invoke("html_preview_unregister", { id }).catch(() => {});
      }
    };
  }, [state]);

  // Free cached PDF bytes when the open document changes / unmounts. Keyed on
  // the path, NOT the state object: load() can commit the pdf state twice
  // (React StrictMode double-invokes the load effect in dev), and a cleanup
  // keyed on object identity would clear the cache out from under the mounted
  // PdfViewer on the second commit ("No PDF data available").
  const pdfPath = state.status === "pdf" ? state.filePath : null;
  useEffect(() => {
    if (!pdfPath) return;
    return () => clearBinaryData(pdfPath);
  }, [pdfPath]);

  if (!openDoc) return null;

  return (
    <div className="relative h-full w-full bg-background">
      {/* Button islands (iOS 26 / Notes layout, #581). For PDFs the viewer's
          own toolbar pill owns the top row, so back moves to the bottom-left
          island — the two never collide. Top-right is reserved for share /
          edit (issue #582, MVP task #6). */}
      {searchable && (
        <SearchIsland
          query={findQuery}
          onQueryChange={setFindQuery}
          placeholder="Find in document"
          matches={
            findQuery && findTotal > 0
              ? {
                  current: findIndex + 1,
                  total: findTotal,
                  onNext: () => goToMatch(true),
                  onPrev: () => goToMatch(false),
                }
              : undefined
          }
        />
      )}
      {state.status === "pdf" ? (
        <Island corner="bottom-left">
          <ChromeButton label="Back" onClick={() => goBack()}>
            <ChevronLeft strokeWidth={1.5} className="h-5 w-5" />
          </ChromeButton>
        </Island>
      ) : (
        <>
          <Island corner="top-left">
            <ChromeButton label="Back" onClick={() => goBack()}>
              <ChevronLeft strokeWidth={1.5} className="h-5 w-5" />
            </ChromeButton>
          </Island>
          <h1 className="pointer-events-none absolute left-1/2 top-[max(1.25rem,env(safe-area-inset-top))] z-40 max-w-[55vw] -translate-x-1/2 truncate text-sm font-medium text-muted-foreground">
            {name}
          </h1>
        </>
      )}

      {state.status === "pdf" ? (
        // The PdfViewer owns the full screen; its own toolbar pill is the top
        // chrome (repositioned below the safe area by the .mobile-shell rule
        // in editor.css).
        <div className="absolute inset-0">
          <Suspense fallback={<ReaderMessage spinner>Loading…</ReaderMessage>}>
            <PdfViewer filePath={state.filePath} fileName={name} />
          </Suspense>
        </div>
      ) : state.status === "html" ? (
        // Scripts run; nothing else does. `allow-scripts` WITHOUT
        // `allow-same-origin` leaves the document on an opaque origin, so a
        // report can execute its own charts but cannot reach this app's DOM,
        // storage, or the Tauri IPC bridge. The document scrolls itself,
        // starting below the top islands.
        <div className="absolute inset-x-0 bottom-0" style={{ top: "calc(3.75rem + env(safe-area-inset-top))" }}>
          <iframe
            key={state.url}
            src={state.url}
            title={name}
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-white"
          />
        </div>
      ) : (
      <div className="absolute inset-0 overflow-y-auto" style={CONTENT_INSETS}>
        {state.status === "loading" && <ReaderMessage spinner>Loading…</ReaderMessage>}

        {state.status === "downloading" && (
          <ReaderMessage icon={CloudDownload} title="Downloading from iCloud">
            This note isn't on your device yet. It'll be ready in a moment.
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
              Retry
            </Button>
          </ReaderMessage>
        )}

        {state.status === "error" && (
          <ReaderMessage icon={AlertCircle} title="Couldn't open this file">
            <span className="break-words">{state.message}</span>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
              Try again
            </Button>
          </ReaderMessage>
        )}

        {state.status === "unsupported" && (
          <ReaderMessage icon={FileQuestion} title="Can't preview this format yet">
            {name.split(".").pop()?.toUpperCase()} files aren't viewable in the
            mobile app yet — open it on your Mac.
          </ReaderMessage>
        )}

        {state.status === "image" && (
          <div className="flex justify-center p-4">
            <img src={state.url} alt={name} className="max-h-full max-w-full rounded-md" />
          </div>
        )}

        {state.status === "text" && (
          // Shares articleRef with the markdown article (they never render
          // together) so find-in-document walks this text too.
          <pre
            ref={(el) => {
              articleRef.current = el;
            }}
            className="mx-auto max-w-[720px] whitespace-pre-wrap break-words px-5 py-8 font-mono text-sm leading-relaxed text-foreground"
          >
            {state.content}
          </pre>
        )}

        {state.status === "markdown" && (
          // Safe to inject: the fragment comes from comrak run WITHOUT
          // `unsafe_`, which strips raw HTML (including <script>) from the
          // source. Pinned by a Rust test in preview.rs.
          <article
            ref={articleRef}
            // `.ProseMirror` is reused for typographic parity with the desktop,
            // but its padding is desktop-sized (6rem each side) and `prose`
            // caps the measure at 65ch — together they left barely half the
            // width of a phone for text. The padding is variable-driven, so
            // retune it here rather than fight the cascade; `max-w-none` drops
            // the measure cap so the column follows the screen.
            // `.ProseMirror` alone, no Tailwind `prose`: editor.css is the
            // complete desktop rendering (headings, lists, tables, code), and
            // stacking prose on top double-applied paragraph/list margins —
            // every line break gained prose's extra 1.25em on top of the
            // editor's own spacing.
            // The inline `whiteSpace: "normal"` overrides the editor
            // container's `white-space: pre-wrap` (a ProseMirror requirement).
            // This is static comrak HTML, and comrak pretty-prints — newlines
            // between <li> tags and at source-wrap points inside paragraphs.
            // Under pre-wrap every one of those renders as a literal line
            // break: phantom mid-paragraph breaks and huge gaps between
            // bullets. It must be an inline style, not the Tailwind
            // `whitespace-normal` utility: editor.css is un-layered while
            // Tailwind v4 utilities live in `@layer utilities`, so the
            // utility class loses to `.ProseMirror` no matter the order.
            // <pre> code blocks keep their own UA white-space and are unaffected.
            className="ProseMirror pb-[max(2rem,env(safe-area-inset-bottom))]"
            style={
              {
                whiteSpace: "normal",
                "--editor-padding-left": "1.25rem",
                "--editor-padding-right": "1.25rem",
                "--editor-padding-top": "1.5rem",
                "--editor-padding-bottom": "1.5rem",
              } as React.CSSProperties
            }
            dangerouslySetInnerHTML={{ __html: state.html }}
          />
        )}
      </div>
      )}

    </div>
  );
}

/** Map an image filename to a MIME type so blob-URL `<img>` renders correctly. */
function imageMimeFor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

function ReaderMessage({
  icon: Icon,
  title,
  spinner,
  children,
}: {
  icon?: typeof AlertCircle;
  title?: string;
  spinner?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      {spinner && (
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-hidden />
      )}
      {Icon && <Icon strokeWidth={1.25} className="h-8 w-8 text-muted-foreground" />}
      {title && <p className="mt-3 text-sm font-medium text-foreground">{title}</p>}
      <div className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
