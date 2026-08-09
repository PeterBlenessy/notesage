import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, CloudDownload, AlertCircle, FileQuestion } from "lucide-react";
import { iosReadFile, iosReadBinary, iosEnsureDownloaded } from "@/lib/ios-api";
import { renderMarkdownFragment } from "@/lib/markdown-render";
import { useMobileStore } from "@/stores/mobile-store";
import { classifyFile } from "./FileRow";
import { Button } from "@/components/ui/button";
import { setBinaryData, clearBinaryData } from "@/lib/binary-cache";

// Lazy-loaded — pdf.js is heavy (and pulls in browser-only globals like
// DOMMatrix), so it's only imported when a PDF is actually opened.
const PdfViewer = lazy(() =>
  import("@/components/editor/viewers/PdfViewer").then((m) => ({ default: m.PdfViewer })),
);

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
  const [state, setState] = useState<ReaderState>({ status: "loading" });
  const articleRef = useRef<HTMLElement | null>(null);

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
          const html = await renderMarkdownFragment(raw, resolvedTheme);
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
  }, [relPath, kind, resolvedTheme]);

  useEffect(() => {
    void load();
  }, [load]);

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
    let cleanupIds: string[] = [];
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
      const registeredIds: string[] = [];
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
          registeredIds.push(id);
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
      cleanupIds = registeredIds;
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
    <div className="flex h-full w-full flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => goBack()}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft strokeWidth={1.5} className="h-5 w-5" />
        </button>
        <h1 className="flex-1 truncate text-base font-medium text-foreground">{name}</h1>
      </header>

      {state.status === "pdf" ? (
        // The PdfViewer owns its own scroll container + toolbar, so it sits in a
        // plain flex child (no overflow wrapper).
        <div className="min-h-0 flex-1">
          <Suspense fallback={<ReaderMessage spinner>Loading…</ReaderMessage>}>
            <PdfViewer filePath={state.filePath} fileName={name} />
          </Suspense>
        </div>
      ) : state.status === "html" ? (
        // Scripts run; nothing else does. `allow-scripts` WITHOUT
        // `allow-same-origin` leaves the document on an opaque origin, so a
        // report can execute its own charts but cannot reach this app's DOM,
        // storage, or the Tauri IPC bridge. The document scrolls itself.
        <div className="min-h-0 flex-1">
          <iframe
            key={state.url}
            src={state.url}
            title={name}
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-white"
          />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto">
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
          <pre className="mx-auto max-w-[720px] whitespace-pre-wrap break-words px-5 py-8 font-mono text-sm leading-relaxed text-foreground">
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
