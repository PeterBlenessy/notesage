import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, CloudDownload, AlertCircle, FileQuestion } from "lucide-react";
import { iosReadFile, iosReadBinary, iosEnsureDownloaded } from "@/lib/ios-api";
import { parseFrontmatter } from "@/lib/frontmatter";
import { useMobileStore } from "@/stores/mobile-store";
import { classifyFile } from "./FileRow";
import { Button } from "@/components/ui/button";
import { markdownComponents } from "./markdown-components";

type ReaderState =
  | { status: "loading" }
  | { status: "downloading" }
  | { status: "error"; message: string }
  | { status: "unsupported" }
  | { status: "text"; content: string }
  | { status: "markdown"; content: string }
  | { status: "image"; url: string };

/**
 * Mobile reader (PRD task #14). Renders markdown (react-markdown + GFM), plain
 * text / code, and images inline; other formats (PDF/EPUB/DOCX/PPTX) show an
 * unsupported state in v1. iCloud placeholders are downloaded on demand.
 */
export function Reader() {
  const openDoc = useMobileStore((s) => s.openDoc);
  const goBack = useMobileStore((s) => s.goBack);
  const [state, setState] = useState<ReaderState>({ status: "loading" });

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
      if (kind === "markdown" || kind === "text") {
        const raw = await iosReadFile(relPath);
        if (kind === "markdown") {
          // Strip YAML frontmatter from the read view (mirrors the editor).
          const { content } = parseFrontmatter(raw);
          setState({ status: "markdown", content });
        } else {
          setState({ status: "text", content: raw });
        }
        return;
      }
      // PDF / EPUB / DOCX / PPTX / unknown — not previewable in v1.
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
    void load();
  }, [load]);

  // Revoke object URLs when the image changes / unmounts.
  useEffect(() => {
    if (state.status !== "image") return;
    const url = state.url;
    return () => URL.revokeObjectURL(url);
  }, [state]);

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
          <article className="mx-auto max-w-[720px] px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {state.content}
            </Markdown>
          </article>
        )}
      </div>
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
