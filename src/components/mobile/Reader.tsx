import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { ChevronLeft, CloudDownload, AlertCircle, FileQuestion, FileWarning, Share, Pencil, Check } from "lucide-react";
import {
  iosReadFile,
  iosReadBinary,
  iosEnsureDownloaded,
  iosShareFile,
  iosWriteFile,
  iosRepairHtmlDoctype,
  iosRenameFile,
  iosCreateFile,
  iosStatFile,
  iosContextMenu,
  iosMoveFile,
  iosInlineArticleImages,
  iosPresentReport,
  iosDismissReport,
  iosFindInReport,
  iosSpeechVoices,
  iosArticleThumbnail,
} from "@/lib/ios-api";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { renderMarkdownFragment } from "@/lib/markdown-render";
import { useMobileStore } from "@/stores/mobile-store";
import { collectFolders } from "./library-folders";
import { evictThumbnail } from "@/lib/mobile-thumbnails";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";
import { classifyFile } from "./FileRow";
import { Button } from "@/components/ui/button";
import { setBinaryData, clearBinaryData } from "@/lib/binary-cache";
import { Island, ChromeButton, SearchIsland, CONTENT_INSETS } from "./Chrome";
import { useNativeChrome } from "./useNativeChrome";
import { withFindAgent } from "./html-find-agent";
import { withLinkAgent } from "./html-link-agent";
import { documentToSpeechText } from "./speech-text";
import { SpeechPlayerBar } from "./SpeechPlayerBar";
import { useSpeechPlayer } from "@/hooks/useSpeechPlayer";
import { measureReaderInsets, withReaderInsets } from "./html-insets";
import { highlightDomMatches, clearDomHighlights } from "@/lib/dom-search";

// Lazy-loaded — pdf.js is heavy (and pulls in browser-only globals like
// DOMMatrix), so it's only imported when a PDF is actually opened.
const PdfViewer = lazy(() =>
  import("@/components/editor/viewers/PdfViewer").then((m) => ({ default: m.PdfViewer })),
);
import type { PdfMobileFindHandle, PdfMobileFindState } from "@/components/editor/viewers/PdfViewer";

/**
 * Resolve a relative markdown link against the directory of the current doc.
 * Returns null when the link would escape the library root — the reader must
 * never navigate outside the grant.
 */
export function resolveRelativeLink(currentRelPath: string, href: string): string | null {
  // An href carrying a URI scheme is not a path, and must not be coerced into
  // one. Without this, `about:blank#top` — which is what an in-document anchor
  // becomes once WebKit resolves it against a `baseURL: nil` document — was
  // joined onto the current directory and returned as `Inbox/about:blank`: a
  // library path to a file that cannot exist. The reader then tried to open
  // it, failed, and showed nothing, which is why a dead anchor tap looked like
  // the app ignoring the tap rather than like an error.
  //
  // Callers handle `http(s):` and `mailto:` before reaching here; everything
  // else with a scheme (`about:`, `data:`, `javascript:`, `file:`) is
  // something this function has no answer for, and `null` says so.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
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
  | { status: "too-large"; sizeBytes: number }
  | { status: "text"; content: string }
  | { status: "markdown"; html: string }
  | { status: "image"; url: string }
  | { status: "html"; url: string; previewId: string }
  // The report is on screen in a NATIVE web view sitting above this one
  // (#606, ADR 0010), so this branch renders nothing. It is a distinct status
  // rather than a flag on `html` because the two are mutually exclusive and
  // every consumer — find, cleanup, the render switch — has to pick one.
  | { status: "html-native" }
  | { status: "pdf"; filePath: string };

/**
 * Repair a saved article that lost its `<!doctype html>` to #805, returning
 * the content to render.
 *
 * Articles saved before that fix are still in quirks mode on disk, and the
 * image sweep will not revisit them — it returns early once no remote image is
 * left. Opening one is the moment we know it needs fixing, so it is fixed
 * then.
 *
 * **The file is rewritten, not just patched for display.** A saved article is
 * meant to be self-contained and portable — opened in Safari, Quick Looked in
 * Finder, handed to someone. Patching only our own renderer would leave the
 * artifact broken everywhere else.
 *
 * The write is deliberately NOT awaited. It is a coordinated iCloud write, and
 * making the reader wait for it would add its latency to opening every report
 * to fix fifteen bytes. Rendering uses the repaired text either way, so a
 * failed write costs nothing but a retry on the next open — the repair is
 * idempotent and converges.
 *
 * Returns the original content unchanged when there is nothing to repair,
 * which is the normal case; no write happens then, so an already-correct
 * article is never touched and its modification date never moves.
 */
export async function repairDoctypeOnOpen(relPath: string, raw: string): Promise<string> {
  const repaired = await iosRepairHtmlDoctype(raw).catch(() => null);
  if (!repaired) return raw;
  void iosWriteFile(relPath, repaired).catch(() => {
    // Read-only volume, a vanished grant, an iCloud stall. The reader still
    // shows the repaired document; the file is retried next time it opens.
  });
  return repaired;
}

/**
 * Above this, a text/markdown/html file is declined instead of read (issue
 * #616): `ios_read_file` ships the whole file across IPC as one JSON string,
 * and for a multi-hundred-MB file that parse blocks the WebView's main
 * thread — the loading spinner freezes and the back button stops responding.
 *
 * This was 5 MB, taken from the issue's own "a few MB" assumption, which was
 * a guess and never measured. It was wrong by more than an order of
 * magnitude, and once captures started inlining their images it began
 * refusing the app's OWN documents: a 48-image article filled the inliner's
 * 12 MB budget and then could not be opened at all. Saving something you
 * cannot read is a worse failure than a slow read.
 *
 * Measured cost of the parse this guards (M3, node; a phone WebView is some
 * multiple slower):
 *
 *     1-25 MB   under 0.25 s, allocation-dominated and hard to even measure
 *        50 MB   0.7 s
 *       100 MB   1.2 s
 *       250 MB   3.5 s
 *       500 MB   6.5 s
 *
 * So the hang is a hundreds-of-MB phenomenon — which is precisely the Health
 * export that prompted the guard, and nothing a captured article approaches.
 * 100 MB refuses what would genuinely wedge the app while leaving an order of
 * magnitude of headroom over anything the capture pipeline can produce.
 *
 * That headroom is not a coincidence to be re-derived later: it is locked by
 * `reader-limit-vs-inliner-budget.test.ts`, which reads the inliner's ceiling
 * out of the Swift source and fails if these two ever cross again.
 */
const MAX_INLINE_TEXT_BYTES = 100 * 1024 * 1024;

/**
 * Mobile reader (PRD task #14). Renders markdown (via the shared Rust comrak
 * pipeline, same as the desktop preview), self-contained HTML reports with
 * their scripts running, plain text / code, images, and PDFs (lazy-loaded
 * desktop PdfViewer); EPUB/DOCX/PPTX show an unsupported state in v1. iCloud
 * placeholders are downloaded on demand.
 */
export function Reader() {
  useLocale();
  const openDoc = useMobileStore((s) => s.openDoc);
  const goBack = useMobileStore((s) => s.goBack);
  const openDocument = useMobileStore((s) => s.openDocument);
  const openLinkedDocument = useMobileStore((s) => s.openLinkedDocument);
  const [state, setState] = useState<ReaderState>({ status: "loading" });
  const articleRef = useRef<HTMLElement | null>(null);
  // Raw markdown of the open doc — kept so a theme flip can re-render without
  // re-reading the file (and without re-fetching PDFs/images at all).
  const rawMarkdownRef = useRef<string | null>(null);
  // Raw HTML of a saved capture, kept for the speech player (#833). The
  // rendered document lives in a sandboxed iframe or a native web view, so
  // there is no DOM here to read prose out of — the source is the only path.
  const rawHtmlRef = useRef<string | null>(null);
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
  // Pending note (#586 follow-up): nothing exists on disk yet. The editor
  // opens on an empty draft and the file is only created on save/back when
  // the draft is non-empty — an accidental "+" tap leaves no file behind.
  const isNew = openDoc?.isNew === true;
  const kind = useMemo(() => (name ? classifyFile(name) : "other"), [name]);

  // Root cause of issue #605 (the article's rendered markup silently
  // reverting to pristine, detaching find-in-document marks): React's DOM
  // renderer diffs `dangerouslySetInnerHTML` by OBJECT IDENTITY, not by the
  // `__html` string's value — `{ __html: state.html }` is a fresh object
  // literal on every JSX evaluation, so React unconditionally re-executes
  // `element.innerHTML = html` on every commit that touches this component,
  // even when the html string itself hasn't changed and the only real state
  // change was something unrelated (find match index/count, a theme
  // MutationObserver firing, native-chrome activation, ...). That silently
  // wipes any DOM mutation made outside React — exactly what the find-in-
  // document marks are. Confirmed directly (not inferred) by reading React
  // 19's `updateProperties`/`setProp` in react-dom's dev bundle and by a
  // regression test below that reproduces the wipe deterministically in
  // jsdom via an ordinary match-navigation re-render — no device needed.
  // Memoizing the object so its reference only changes when the html STRING
  // does closes this at the source.
  const markdownHtml = state.status === "markdown" ? state.html : null;
  const articleInnerHtml = useMemo(
    () => (markdownHtml === null ? null : { __html: markdownHtml }),
    [markdownHtml],
  );

  // Find-in-document. Markdown/text: matches marked via the shared
  // dom-search utility the desktop's DOCX/plain viewers use. HTML reports:
  // the document is a cross-origin sandboxed frame, so search runs INSIDE it
  // via the injected find agent (html-find-agent.ts), driven over
  // postMessage. PDFs search through the PdfViewer's own island.
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [findTotal, setFindTotal] = useState(0);
  const findMarksRef = useRef<HTMLElement[]>([]);
  // Mirror of findIndex for event handlers: native chrome taps can arrive
  // faster than re-renders, and a stale state read wedges the navigation.
  const findIndexRef = useRef(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // PDF find lives inside PdfViewer; the native island drives it through
  // this handle and mirrors its state from the callback below.
  const pdfFindRef = useRef<PdfMobileFindHandle | null>(null);
  const [pdfFind, setPdfFind] = useState<PdfMobileFindState>({ current: -1, total: 0, page: 0, pages: 0 });
  const isPdf = state.status === "pdf";
  // Declared up here with the other status flags, not beside the effects that
  // use it: the native-chrome spec below reads it, and a `const` declared
  // after that point is a temporal-dead-zone crash on every render.
  const hasNativeReport = state.status === "html-native";
  const htmlFrameRef = useRef<HTMLIFrameElement | null>(null);
  // Which html url has finished loading and may therefore be shown. Keyed by
  // url rather than a boolean so opening a SECOND report re-hides the frame
  // instead of showing the previous one's last painted frame.
  const [htmlShownUrl, setHtmlShownUrl] = useState<string | null>(null);
  const htmlUrl = state.status === "html" ? state.url : null;
  useEffect(() => {
    if (!htmlUrl) return;
    // A frame that never fires `load` must not leave a blank pane: reveal it
    // regardless after a beat. Worst case that restores the old behaviour
    // (a brief white frame) rather than losing the document entirely.
    const timer = window.setTimeout(() => setHtmlShownUrl(htmlUrl), 1200);
    return () => window.clearTimeout(timer);
  }, [htmlUrl]);
  // A natively-presented report is searchable too, but not by the island —
  // WebKit's own find bar runs over it (#606), so the island must NOT expand
  // for it. `searchable` gates the island; `nativeReportSearch` is the
  // separate affordance.
  const searchable =
    state.status === "markdown" || state.status === "text" || state.status === "html";
  const isHtml = state.status === "html";

  useEffect(() => {
    if (isHtml) {
      const t = setTimeout(() => {
        htmlFrameRef.current?.contentWindow?.postMessage(
          { ns: "notesage-find", type: "query", q: findQuery },
          "*",
        );
      }, 150);
      return () => clearTimeout(t);
    }
    const root = articleRef.current;
    if (!root) return;
    const t = setTimeout(() => {
      // Mark-based highlighting, same mechanism as the HTML agent and the
      // PDF text layer — the ONLY one of the three that both paints and
      // scrolls in this WKWebView. (The CSS Custom Highlight API was tried
      // and registers ranges but never paints in the embedded webview —
      // matches were invisible; do not bring it back without an on-device
      // paint check.) Capped for hundreds-of-pages documents.
      clearDomHighlights(root);
      findMarksRef.current = findQuery ? highlightDomMatches(root, findQuery, 300) : [];
      findIndexRef.current = 0;
      setFindIndex(0);
      setFindTotal(findMarksRef.current.length);
      if (findMarksRef.current.length > 0) {
        findMarksRef.current[0].classList.add("dom-find-highlight-active");
        scrollMarkIntoView(findMarksRef.current[0]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [findQuery, state, isHtml]);

  // Watchdog (issue #605). The root cause of the article's innerHTML
  // silently reverting to pristine was found this session — see the
  // `articleInnerHtml` memo above — and the earlier framing here ("trigger
  // not yet identified", suspects "eliminated" including React's own
  // dangerouslySetInnerHTML diffing) was WRONG: it was exactly that diffing,
  // just not in the form that had been tested. React compares
  // `dangerouslySetInnerHTML` by object identity, not by the `__html`
  // string's value, so any unrelated re-render (e.g. a find-match nav
  // updating findIndex/findTotal, the theme observer firing, native-chrome
  // activation) re-executed `element.innerHTML = html` and wiped whatever
  // had been mutated outside React — including these marks. That is now
  // fixed at the source.
  //
  // This watchdog stays anyway, downgraded from "the fix" to a defense-in-
  // depth backstop: nothing rules out some OTHER actor (WebKit itself, a
  // future regression) also mutating this subtree outside React, and the
  // cost of keeping a cheap periodic connectivity check is far lower than
  // the cost of find-in-document silently breaking again undetected. Two
  // real gaps were closed while re-evaluating it: the connectivity check
  // only ever looked at marks[0], so a rewrite that detached SOME marks but
  // left the first one connected went undetected — the affected matches
  // stayed permanently dead. Checking every mark closes that gap.
  // Re-wrapping now also clears first: blindly re-highlighting over a
  // survivor (rather than a fully pristine subtree) nested a fresh <mark>
  // inside it instead of replacing it.
  useEffect(() => {
    if (isHtml || !findQuery) return;
    const t = window.setInterval(() => {
      const root = articleRef.current;
      if (!root) return;
      const marks = findMarksRef.current;
      if (marks.length > 0 && marks.some((m) => !m.isConnected)) {
        clearDomHighlights(root);
        findMarksRef.current = highlightDomMatches(root, findQuery, 300);
        const bounded = Math.min(findIndexRef.current, Math.max(0, findMarksRef.current.length - 1));
        findIndexRef.current = bounded;
        setFindTotal(findMarksRef.current.length);
        findMarksRef.current[bounded]?.classList.add("dom-find-highlight-active");
      }
    }, 500);
    return () => window.clearInterval(t);
  }, [isHtml, findQuery]);


  // Counter updates from the HTML find agent. Untrusted (the report's own
  // scripts share the frame) — shape-checked, and worst case a hostile report
  // lies about its own match count.
  useEffect(() => {
    if (!isHtml) return;
    const onMessage = (e: MessageEvent) => {
      // No e.source identity check: WKWebView does not reliably preserve
      // source identity for opaque-origin (sandboxed) frames, and a strict
      // comparison silently dropped every agent reply on-device — the match
      // counter stayed 0 and the nav chevrons rendered permanently disabled.
      // The payload is shape-checked and only ever drives a bounded counter
      // (worst case: a hostile report lies about its own match count).
      const d = e.data as { ns?: string; type?: string; total?: number; current?: number };
      if (!d || d.ns !== "notesage-find" || d.type !== "state") return;
      if (typeof d.total === "number" && Number.isFinite(d.total)) setFindTotal(Math.max(0, d.total));
      if (typeof d.current === "number" && Number.isFinite(d.current)) setFindIndex(Math.max(0, d.current));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isHtml]);

  // Links reported by the injected link agent. The agent only tells us an
  // href — every decision about what it means is made here, on the app side.
  // The href is untrusted (the report's own scripts share that frame), so it
  // goes through `resolveRelativeLink`, which refuses anything climbing out
  // of the granted library root.
  const handleFrameLink = useCallback(
    async (href: string, viaMenu: boolean) => {
      const remote = /^(https?:|mailto:)/i.test(href);
      const target = remote ? null : resolveRelativeLink(relPath, href);

      if (!remote && !target) {
        toast.error("This link points outside your library");
        return;
      }

      const openHere = () => {
        if (!target) return;
        openLinkedDocument({ relPath: target, name: target.split("/").pop() ?? target });
      };

      if (!viaMenu) {
        // Plain tap keeps the established default: local files open in the
        // reader, the web opens where the web belongs.
        if (target) openHere();
        else void openUrl(href).catch(() => toast.error(t("reader.openLinkFailed")));
        return;
      }

      // Long-press. A local file has no meaningful "open in browser" — Safari
      // cannot read through the security-scoped grant — so it is offered as
      // Share instead, which copies the file out the way sharing already does.
      const items = target
        ? [
            { id: "here", title: "Open here" },
            { id: "share", title: "Share…" },
          ]
        : [
            { id: "browser", title: "Open in browser" },
            { id: "copy", title: "Copy link" },
          ];

      const chosen = await iosContextMenu({ title: href, items }).catch(() => null);
      if (chosen === "here") openHere();
      else if (chosen === "share" && target) {
        void iosShareFile(target).catch(() => toast.error("Couldn't share that file"));
      } else if (chosen === "browser") {
        void openUrl(href).catch(() => toast.error(t("reader.openLinkFailed")));
      } else if (chosen === "copy") {
        void writeText(href)
          .then(() => toast.success("Link copied"))
          .catch(() => toast.error("Couldn't copy the link"));
      }
    },
    [relPath, openLinkedDocument],
  );

  useEffect(() => {
    if (!isHtml) return;
    const onMessage = (e: MessageEvent) => {
      // Same trust posture as the find listener above: shape-checked, no
      // source identity check (WKWebView does not preserve it for opaque
      // origins), and nothing here can reach outside the library.
      const d = e.data as { ns?: string; type?: string; href?: string; menu?: boolean };
      if (!d || d.ns !== "notesage-link" || d.type !== "open") return;
      if (typeof d.href !== "string" || !d.href) return;
      void handleFrameLink(d.href, d.menu === true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isHtml, handleFrameLink]);

  // Scroll to the active mark and KEEP it there: content above a match can
  // change height after the scroll (mermaid fences swap to sized iframes,
  // images resolve, fonts settle), which strands the viewport where the
  // match USED to be — in a long document that reads as "scrolled to the
  // wrong place entirely". The PDF viewer solves this with pre-sized page
  // placeholders; markdown can't know sizes up front, so navigation
  // re-checks the mark's real position after layout settles and corrects.
  const correctionTimersRef = useRef<number[]>([]);
  const scrollMarkIntoView = (mark: HTMLElement) => {
    for (const t of correctionTimersRef.current) window.clearTimeout(t);
    correctionTimersRef.current = [];
    mark.scrollIntoView({ block: "center" });
    for (const delay of [250, 700, 1500]) {
      correctionTimersRef.current.push(
        window.setTimeout(() => {
          if (!mark.isConnected) return; // the watchdog will re-wrap
          const scroller = scrollerRef.current;
          if (!scroller) return;
          const rect = mark.getBoundingClientRect();
          const srect = scroller.getBoundingClientRect();
          const offCenter = rect.top + rect.height / 2 - (srect.top + scroller.clientHeight / 2);
          if (Math.abs(offCenter) > 48) mark.scrollIntoView({ block: "center" });
        }, delay),
      );
    }
  };
  useEffect(
    () => () => {
      for (const t of correctionTimersRef.current) window.clearTimeout(t);
    },
    [],
  );

  const goToMatch = (next: boolean) => {
    if (isHtml) {
      htmlFrameRef.current?.contentWindow?.postMessage(
        { ns: "notesage-find", type: "nav", dir: next ? 1 : -1 },
        "*",
      );
      return;
    }
    let marks = findMarksRef.current;
    // Heal before use: if the article was rewritten since the last walk,
    // some (not necessarily all) of the stored marks are detached husks —
    // clear and re-wrap from the live DOM rather than trust a first-mark
    // check (see the watchdog comment above for why marks[0] alone isn't
    // enough, and why the clear has to happen before the re-wrap).
    if (marks.length > 0 && marks.some((m) => !m.isConnected)) {
      const root = articleRef.current;
      if (root) clearDomHighlights(root);
      marks = root && findQuery ? highlightDomMatches(root, findQuery, 300) : [];
      findMarksRef.current = marks;
      setFindTotal(marks.length);
    }
    if (marks.length === 0) return;
    const cur = Math.min(findIndexRef.current, marks.length - 1);
    const idx = (cur + (next ? 1 : marks.length - 1)) % marks.length;
    marks[cur]?.classList.remove("dom-find-highlight-active");
    marks[idx].classList.add("dom-find-highlight-active");
    scrollMarkIntoView(marks[idx]);
    findIndexRef.current = idx;
    setFindIndex(idx);
  };

  // Generation counter: every load() invocation takes a ticket, and a
  // superseded invocation (doc switched or component unmounted mid-flight)
  // must not setState — and must RELEASE what it just acquired (object URL,
  // html_preview registration; the Rust-side preview store has no eviction).
  // Same idiom as the theme + mermaid effects below.
  const loadIdRef = useRef(0);
  useEffect(() => () => { loadIdRef.current++; }, []);

  // --- Edit mode (#586): markdown/text notes edit as raw source in a
  // full-screen textarea. Save writes through ios_write_file; for markdown
  // the note's TITLE (first heading / non-empty line) becomes the filename
  // via ios_rename_file (deduped natively). A brand-new empty note drops
  // straight into edit mode, Notes-style.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const editable = state.status === "markdown" || state.status === "text";

  const startEdit = useCallback(() => {
    setFindQuery("");
    setDraft(
      state.status === "text" ? state.content : (rawMarkdownRef.current ?? ""),
    );
    setEditing(true);
  }, [state]);

  // A just-created empty note opens directly in edit mode (once per doc —
  // the ref guards against re-entering after the user deliberately saves an
  // empty draft and stays on the page).
  const autoEditRef = useRef<string | null>(null);
  useEffect(() => {
    if (editing || autoEditRef.current === relPath) return;
    const empty =
      (state.status === "markdown" && (rawMarkdownRef.current ?? "").trim() === "") ||
      (state.status === "text" && state.content.trim() === "");
    if (empty) {
      autoEditRef.current = relPath;
      startEdit();
    }
  }, [state, editing, relPath, startEdit]);

  /** Persist the draft. Existing notes: write + title-rename. Pending notes
   *  (`isNew`): CREATE the file — directly under its title-derived name — but
   *  only when the draft is non-empty; an empty draft returns null and leaves
   *  no file behind. Returns the final relative path, or null when nothing
   *  was (or should be) persisted. */
  const persistDraft = useCallback(async (): Promise<string | null> => {
    if (isNew) {
      if (draft.trim() === "") return null;
      const title = deriveNoteTitle(draft) ?? "Untitled";
      const folder = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
      const rel = folder ? `${folder}/${title}.md` : `${title}.md`;
      // The native side dedupes and returns the path actually created.
      return await iosCreateFile(rel, draft);
    }
    await iosWriteFile(relPath, draft);
    if (kind === "markdown") {
      const title = deriveNoteTitle(draft);
      const stem = name.replace(/\.[^.]+$/, "");
      if (title && title !== stem) {
        return await iosRenameFile(relPath, `${title}.md`);
      }
    }
    return relPath;
  }, [isNew, relPath, draft, kind, name]);

  // `load` is declared further down (it needs the chrome hook's siblings);
  // the ref indirection lets save re-trigger it without reordering the
  // component.
  const loadRef = useRef<(() => Promise<void>) | null>(null);
  const saveEdit = useCallback(async () => {
    try {
      const finalRel = await persistDraft();
      if (finalRel === null) {
        // Empty pending note — nothing to keep. Leave without a file.
        goBack();
        return;
      }
      setEditing(false);
      if (isNew || finalRel !== relPath) {
        // Re-open under the new name (the Reader is keyed by relPath — this
        // remounts with a fresh load of what was actually saved).
        openDocument({ relPath: finalRel, name: finalRel.split("/").pop() ?? name });
      } else {
        rawMarkdownRef.current = null;
        renderedThemeRef.current = null;
        await loadRef.current?.();
      }
    } catch (err) {
      toast.error(t("reader.saveFailed", { error: String(err) }));
    }
  }, [persistDraft, relPath, name, isNew, goBack, openDocument]);

  // Back while editing saves first (Notes semantics — no unsaved-changes
  // dialog), then leaves; the browser relists on mount so a rename shows.
  const backAction = useCallback(() => {
    if (!editing) {
      goBack();
      return;
    }
    void (async () => {
      try {
        await persistDraft();
      } catch (err) {
        toast.error(t("reader.saveFailed", { error: String(err) }));
      }
      goBack();
    })();
  }, [editing, persistDraft, goBack]);

  // "Update from source" (#829) — only offered for a capture that still knows
  // where it came from.
  //
  // Articles saved before captures kept a masthead have no hero, byline or
  // standfirst, and those bytes are NOT recoverable from the file: the only
  // record of the source is the "Clipped from" footer. So this is a deliberate,
  // user-invoked network fetch — never something that happens on open.
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  // Read aloud (#833). The player lives natively (audio has to survive
  // backgrounding and the lock screen); this is the controller plus the
  // per-document resume position.
  const speech = useSpeechPlayer(relPath);

  /** Prose for the open document, or "" when there is nothing to read. */
  const speechSource = useCallback((): string => {
    if (kind === "html") return documentToSpeechText(rawHtmlRef.current ?? "", "html");
    if (kind === "markdown") return documentToSpeechText(rawMarkdownRef.current ?? "", "markdown");
    if (kind === "text" && state.status === "text") {
      return documentToSpeechText(state.content, "text");
    }
    return "";
  }, [kind, state]);

  /**
   * Pick the reading voice for the article's language via a native sheet.
   *
   * Offered only once playback has started: the language is decided from the
   * article's text on the native side, and listing voices for the wrong
   * language would be worse than asking the user to press Listen first.
   */
  const pickVoice = useCallback(async () => {
    const language = speech.state.language;
    if (!language) {
      toast.message(t("reader.voiceStartFirst"));
      return;
    }
    let voices: Awaited<ReturnType<typeof iosSpeechVoices>>;
    try {
      voices = await iosSpeechVoices(language);
    } catch (err) {
      toast.error(String(err));
      return;
    }
    if (voices.length === 0) {
      toast.message(t("reader.voiceNone"));
      return;
    }
    const current = useMobileStore.getState().speechVoices[language];
    const qualityLabel = {
      premium: t("reader.voiceQualityPremium"),
      enhanced: t("reader.voiceQualityEnhanced"),
      default: t("reader.voiceQualityDefault"),
    } as const;
    const chosen = await iosContextMenu({
      title: t("reader.voiceTitle"),
      items: voices.map((v) => ({
        id: v.id,
        // "✓ Ava · Premium · en-US": the sheet has no checkmark affordance of
        // its own, and the region matters — premium en-AU and premium en-US
        // are both "Premium" and sound nothing alike.
        title: `${v.id === current ? "✓ " : ""}${v.name} · ${qualityLabel[v.quality]} · ${v.language}`,
      })),
    });
    if (chosen) speech.chooseVoice(chosen);
  }, [speech]);

  const startListening = useCallback(() => {
    const text = speechSource();
    if (!text) {
      toast.error(t("reader.listenNothing"));
      return;
    }
    // Title is resolved here, not at render: it comes from content held in a
    // ref, so a render-time read is empty on the first pass and would put a
    // blank name on the lock screen.
    const title = deriveNoteTitle(rawMarkdownRef.current ?? "") ?? name;
    // The article's lead image becomes the lock-screen artwork — the same
    // thumbnail the gallery card uses. It rejects for a document with no
    // inline image, in which case the player simply has none; the image
    // must never delay the first audio, hence start-on-either-outcome.
    void iosArticleThumbnail(relPath)
      .then((bytes) => speech.start(text, title, uint8ToBase64(bytes)))
      .catch(() => speech.start(text, title));
  }, [speechSource, speech, name, relPath]);

  useEffect(() => {
    setSourceUrl(null);
    rawHtmlRef.current = null;
    // `kind`, not the extension: `classifyFile` counts `.htm` as html too, and
    // an extension check here would leave those with no source for Listen —
    // the menu entry would appear and then report nothing to read.
    if (kind !== "html") return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await iosReadFile(relPath);
        // Reuse this read for the speech player rather than adding a third
        // one: a capture is ~500 KB of inlined base64, and reading it twice
        // to say the same thing is the kind of cost that only shows up on a
        // phone.
        if (!cancelled) rawHtmlRef.current = raw;
        const url = await invoke<string | null>("article_source_url", { content: raw });
        if (!cancelled) setSourceUrl(url);
      } catch {
        // No source, unreadable, or a build without the command — the menu
        // entry simply does not appear.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [relPath, kind]);

  const updateFromSource = useCallback(async () => {
    if (!sourceUrl || updating) return;
    setUpdating(true);
    try {
      const saved = await iosReadFile(relPath);
      // Fetched NATIVELY, not with the WebView's `fetch()`.
      //
      // The first version used `fetch()` on the reasoning that iOS already had
      // a network stack there. Wrong in the one way that matters: a WebView
      // fetch to another origin is a CORS request, and almost no site sends
      // `Access-Control-Allow-Origin` — so this failed before Rust was ever
      // asked to splice, and "Update from source" did nothing. The image
      // inliner already fetched natively for exactly this reason.
      const pageHtml = await invoke<string>("fetch_page_html", { url: sourceUrl });
      const spliced = await invoke<string | null>("splice_article_header", {
        saved,
        pageHtml,
        sourceUrl,
      });
      if (!spliced) {
        // Not an error. The page may be blocked, paywalled, gone, or the
        // article may already have its masthead — in every one of those cases
        // leaving the file untouched is the right outcome.
        toast.info(t("reader.updateNothingToAdd"));
        return;
      }
      await iosWriteFile(relPath, spliced);

      // Inline the hero we just spliced in, then drop the cached thumbnail.
      //
      // The splice writes a REMOTE `<img class="hero" src="https://…">`, but
      // `article_lead_image` only reads INLINED `data:` images — that is what
      // makes a gallery card work offline. So a repaired article kept its old
      // card, showing whichever inline screenshot had been inlined first, while
      // a freshly shared one showed the hero. Same document, two different
      // cards, which is exactly what Peter saw side by side.
      //
      // Best-effort: the article itself is already repaired and correct on
      // screen. A failed sweep costs a stale card, not the fix.
      try {
        await iosInlineArticleImages(relPath);
        evictThumbnail(relPath);
      } catch {
        // Offline, or every image oversized. The next background sweep retries.
      }
      toast.success(t("reader.updateDone"));
      await loadRef.current?.();
    } catch (err) {
      toast.error(t("reader.updateFailed", { error: String(err) }));
    } finally {
      setUpdating(false);
    }
  }, [relPath, sourceUrl, updating]);

  // "Move to folder" (#832).
  //
  // The backend primitive has existed and been unused since #754:
  // `ios_move_file` sanitises both paths, refuses the library root, dedupes on
  // collision and returns the path it actually produced. All that was missing
  // was somewhere to invoke it from — filing a capture is the whole point of
  // an inbox.
  const moveToFolder = useCallback(async () => {
    if (!relPath) return;
    try {
      // Folders only, and never the one the file is already in — offering it
      // would dedupe the file against itself into `name-1`.
      const here = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
      const folders = await collectFolders();
      const items = folders
        .filter((f) => f.path !== here)
        .map((f) => ({ id: f.path, title: f.label, icon: "folder" }));
      if (items.length === 0) {
        toast.info(t("reader.moveNowhere"));
        return;
      }
      const dest = await iosContextMenu({ title: t("reader.moveTitle"), items });
      if (dest === null) return; // Cancelled.

      const landed = await iosMoveFile(relPath, dest);
      // The open document must follow the file, or every later action —
      // save, share, update-from-source — targets a path that no longer
      // exists. `landed` is authoritative: the name may have been deduped.
      useMobileStore.getState().openDocument({
        relPath: landed,
        name: landed.slice(landed.lastIndexOf("/") + 1),
      });
      toast.success(t("reader.moveDone", { folder: dest === "" ? "/" : dest }));
    } catch (err) {
      toast.error(t("reader.moveFailed", { error: String(err) }));
    }
  }, [relPath]);

  const nativeChrome = useNativeChrome(
    {
      topLeft: { id: "back", icon: "chevron.backward" },
      // Editable notes: tap = edit (pencil), long-press = Share menu. While
      // editing the slot becomes the ✓ save. Non-editable docs keep Share.
      topRight: editing
        ? { id: "save", icon: "checkmark" }
        : editable
          ? {
              id: "edit",
              icon: "square.and.pencil",
              menu: [
                { id: "share", title: "Share", icon: "square.and.arrow.up" },
                { id: "move", title: t("reader.move"), icon: "folder" },
                // Also here, not only in the read-only branch below: an
                // editable note's overflow is a LONG-PRESS on the pencil, so
                // omitting it made Listen unreachable for every markdown note
                // while looking present in the code (#832's failure shape).
                { id: "listen", title: t("reader.listen"), icon: "headphones" },
                // Gated on the LANGUAGE being known, not on playback having
                // started: `active` flips synchronously, `language` arrives
                // after the native round trip, and in that window the entry
                // would tell a user who is already listening to start
                // listening (review finding).
                ...(speech.state.language
                  ? [{ id: "voice", title: t("reader.voice"), icon: "person.wave.2" }]
                  : []),
              ],
            }
          : {
              // TAP opens the menu (#832/#829 follow-up). `menu` alone is a
              // LONG-PRESS affordance with tap still firing `id` — so Move and
              // Update from source shipped invisible, reachable only by holding
              // a button that looks like plain Share. A reader with no pencil
              // has no primary action worth protecting, so the whole slot
              // becomes the overflow menu.
              id: "share",
              icon: "ellipsis",
              menuOnTap: true,
              // Only for a capture that still knows where it came from (#829).
              // An article saved before captures kept a masthead can have one
              // spliced in from the source page.
              menu: [
                { id: "share", title: t("reader.share"), icon: "square.and.arrow.up" },
                { id: "move", title: t("reader.move"), icon: "folder" },
                // Only where there is prose to read. A PDF or an image has
                // none, and an entry that always errors is worse than absent.
                ...(kind === "html" || kind === "markdown" || kind === "text"
                  ? [{ id: "listen", title: t("reader.listen"), icon: "headphones" }]
                  : []),
                // Only once the native side has decided the article's language
                // (which arrives after `active`) — the list depends on it.
                ...(speech.state.language
                  ? [{ id: "voice", title: t("reader.voice"), icon: "person.wave.2" }]
                  : []),
                ...(sourceUrl
                  ? [
                      {
                        id: "updateSource",
                        title: t("reader.updateFromSource"),
                        icon: "arrow.clockwise",
                      },
                    ]
                  : []),
              ],
            },
      // A natively-presented report searches through WebKit's own find bar,
      // which is a system UI the island cannot host — so the slot becomes a
      // plain button that opens it (#606). Reports are the ONLY document kind
      // that gets the system bar; markdown/text keep the island's dom-search
      // and PDFs keep the viewer's text-layer search.
      // Suppressed while listening for the same reason as the search island
      // below: the player is a centred capsule on the bottom safe area and
      // this button sits at its right edge, so the two overlap. Find is one
      // tap away again the moment playback stops.
      bottomRight: hasNativeReport && !speech.state.active
        ? { id: "findReport", icon: "magnifyingglass" }
        : undefined,
      // Read-aloud transport (#833), rendered natively so it is visible over a
      // natively-presented report — which is exactly the document kind people
      // want to listen to.
      bottomCenter: speech.state.active
        ? {
            playing: speech.state.playing,
            position:
              speech.state.total > 0
                ? `${Math.min(speech.state.index + 1, speech.state.total)} / ${speech.state.total}`
                : "…",
            rate: `${speech.state.rate}×`,
          }
        : undefined,
      // The player and the search island are BOTH bottom-centre capsules on
      // the safe area, so offering them together stacks one on top of the
      // other (review finding, Critical). Listening wins while it is running:
      // it is the active task, and find-in-document is one tap away again the
      // moment playback stops.
      search: editing || speech.state.active
        ? undefined
        : isPdf
        ? {
            kind: "find" as const,
            placeholder: t("reader.find"),
            status: pdfFind.pages > 0 ? `${pdfFind.page} / ${pdfFind.pages}` : undefined,
            current: pdfFind.total > 0 ? pdfFind.current + 1 : undefined,
            total: pdfFind.total > 0 ? pdfFind.total : undefined,
          }
        : searchable
          ? {
              kind: "find" as const,
              placeholder: t("reader.find"),
              current: findTotal > 0 ? findIndex + 1 : undefined,
              total: findTotal > 0 ? findTotal : undefined,
            }
          : undefined,
    },
    {
      back: backAction,
      edit: () => startEdit(),
      save: () => void saveEdit(),
      share: () => {
        void iosShareFile(relPath).catch((err) => toast.error(t("action.shareFailed", { error: String(err) })));
      },
      "search-query": (value?: string) =>
        isPdf ? pdfFindRef.current?.setQuery(value ?? "") : setFindQuery(value ?? ""),
      "search-close": () => (isPdf ? pdfFindRef.current?.setQuery("") : setFindQuery("")),
      "search-next": () => (isPdf ? pdfFindRef.current?.next() : goToMatch(true)),
      "search-prev": () => (isPdf ? pdfFindRef.current?.prev() : goToMatch(false)),
      move: () => void moveToFolder(),
      listen: () => startListening(),
      voice: () => void pickVoice(),
      "player-toggle": () => (speech.state.playing ? speech.pause() : speech.resume()),
      "player-back": () => speech.skip(-1),
      "player-forward": () => speech.skip(1),
      "player-rate": () => speech.cycleRate(),
      "player-stop": () => speech.stop(),
      updateSource: () => void updateFromSource(),
      findReport: () => {
        // `false` means the native layer said no report is on screen. Nothing
        // to fall back TO here — the island cannot search a document living in
        // another web view — so say so rather than leaving a dead button.
        void iosFindInReport().then((opened) => {
          if (!opened) toast.error(t("reader.findUnavailable"));
        });
      },
    },
  );

  const load = useCallback(async () => {
    if (!relPath) return;
    if (isNew) {
      // Nothing on disk yet — an empty rendered doc; the auto-edit effect
      // opens the editor immediately. Created only on save/back with content.
      // renderedThemeRef must be the CURRENT theme, not null: a null makes
      // the theme-re-render effect below think the theme changed and fire a
      // pointless renderMarkdownFragment("") — which in tests lands as an
      // unhandled post-teardown rejection (the CI-only #630 failure).
      rawMarkdownRef.current = "";
      renderedThemeRef.current = document.documentElement.classList.contains("dark")
        ? "dark"
        : "light";
      setState({ status: "markdown", html: "" });
      return;
    }
    const loadId = ++loadIdRef.current;
    const isCurrent = () => loadIdRef.current === loadId;
    setState({ status: "loading" });
    try {
      if (kind === "image") {
        const bytes = await iosReadBinary(relPath);
        if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        setBinaryData(relPath, bytes);
        setState({ status: "pdf", filePath: relPath });
        return;
      }
      if (kind === "markdown" || kind === "text" || kind === "html") {
        // Size guard (issue #616): stat before reading. A cheap metadata
        // probe with none of the cost `ios_read_file` has for an oversized
        // file — see MAX_INLINE_TEXT_BYTES above. A stat failure (older
        // native build, off-iOS test harness, transient IPC error) fails
        // OPEN: falls through to the normal read path exactly as before
        // this guard existed, rather than blocking an ordinary read.
        try {
          const stat = await iosStatFile(relPath);
          if (!isCurrent()) return;
          if (stat.sizeBytes > MAX_INLINE_TEXT_BYTES) {
            setState({ status: "too-large", sizeBytes: stat.sizeBytes });
            return;
          }
        } catch {
          /* size unknown — fall through to the normal read path */
        }
      }
      if (kind === "html") {
        const raw = await repairDoctypeOnOpen(relPath, await iosReadFile(relPath));
        if (!isCurrent()) return;

        // NATIVE FIRST (#606, ADR 0010): its own WKWebView, its own content
        // process, no bridge. A separate web view has no inherited CSP, so
        // `loadHTMLString` just works — which is why none of the custom-scheme
        // plumbing in the fallback below is needed on device.
        try {
          const insets = measureReaderInsets();
          await iosPresentReport(raw, { top: insets.top, bottom: insets.bottom });
          if (!isCurrent()) {
            // Superseded while presenting — take it back down, or the previous
            // document stays on screen over whatever the reader shows next.
            void iosDismissReport().catch(() => {});
            return;
          }
          setState({ status: "html-native" });
          return;
        } catch {
          // No native layer: desktop dev, the vitest suite, or a build without
          // the plugin. ADR 0010 commits to this fallback being a REAL path
          // rather than a claim, so the original mechanism stays intact rather
          // than being trimmed to something that has never run.
          //
          // `ios_present_report` REJECTS off-iOS by design; if it is ever
          // changed to resolve, this catch stops running and the reader shows
          // an empty pane on desktop.
        }

        // The `htmlpreview://` custom scheme — the same mechanism as the
        // desktop HtmlViewer, for the same reason: srcDoc, blob: AND data:
        // documents all INHERIT the host window's CSP, and in the embedded
        // build Tauri's nonce injection neutralises 'unsafe-inline', so a
        // report's own <style>/<script> blocks are refused and it renders bare
        // (dev builds hide this — Vite serves the app with no CSP). A
        // custom-scheme response carries its own empty policy; the
        // `sandbox="allow-scripts"` attribute is what isolates the document.
        const id = crypto.randomUUID();
        // The find agent rides along inside the document — the only place
        // search can run in a sandboxed cross-origin frame.
        //
        // It is deliberately still here. #606 retires it for the native path,
        // but deleting it now would take find-in-report away from the fallback
        // BEFORE the native replacement has been verified on device — which is
        // the sequencing the issue's own acceptance criteria ask for. The
        // deletion is the last step, not the first.
        //
        // Padding is injected INTO the document: the parent cannot reach into
        // a sandboxed iframe's scroll area, and `env(safe-area-inset-*)` does
        // not resolve inside one (#722). Measured here, where it does. The
        // native path needs none of this — it sets a scroll content inset on a
        // web view it legitimately owns, instead of rewriting the report.
        await invoke("html_preview_register", {
          id,
          content: withReaderInsets(withLinkAgent(withFindAgent(raw)), measureReaderInsets()),
        });
        if (!isCurrent()) {
          // Superseded after registering — release the doc immediately or it
          // is orphaned forever (the preview store has no eviction).
          void invoke("html_preview_unregister", { id }).catch(() => {});
          return;
        }
        setState({ status: "html", url: `htmlpreview://localhost/${id}`, previewId: id });
        return;
      }
      if (kind === "markdown" || kind === "text") {
        const raw = await iosReadFile(relPath);
        if (!isCurrent()) return;
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
          if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        if (dl === "downloading") {
          setState({ status: "downloading" });
          return;
        }
      } catch {
        /* fall through to the original read error */
      }
      if (!isCurrent()) return;
      setState({ status: "error", message: String(err) });
    }
  }, [relPath, kind, isNew]);


  loadRef.current = load;

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
        void openUrl(href).catch(() => toast.error(t("reader.openLinkFailed")));
        return;
      }
      if (href.startsWith("#")) return; // in-page anchors: no-op in v1
      const target = resolveRelativeLink(relPath, href);
      if (!target) {
        toast.error("This link points outside your library");
        return;
      }
      // A link followed from a note is a step on a trail, same as one followed
      // from a report — Back should retrace it rather than drop to the folder.
      openLinkedDocument({ relPath: target, name: target.split("/").pop() ?? target });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [state, relPath, openLinkedDocument]);

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

  // Take the NATIVE report down when it stops being what the reader is
  // showing (#606). The native web view is a sibling of this one, not a child
  // — React unmounting the reader does not remove it, so a report left up
  // would float over the folder list with no way to dismiss it.
  //
  // Keyed on the boolean rather than on `state`: the reader re-commits state
  // for unrelated reasons (theme flips, StrictMode double-invokes), and a
  // cleanup keyed on object identity would dismiss the report out from under
  // itself on the second commit.
  useEffect(() => {
    if (!hasNativeReport) return;
    return () => {
      void iosDismissReport().catch(() => {});
    };
  }, [hasNativeReport]);

  // The report's own web view speaks back through exactly two events, both
  // native-mediated (`ReportWebView.swift`): a link tap WebKit was about to
  // perform, and its content process dying. Nothing the report's JS can reach
  // produces either.
  useEffect(() => {
    if (!hasNativeReport) return;
    const onReport = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: string; href?: string }>).detail;
      if (detail?.type === "crashed") {
        // Its own content process, so a report can die alone. Say so — a blank
        // rectangle is indistinguishable from an empty document.
        setState({ status: "error", message: t("reader.reportCrashed") });
        return;
      }
      if (detail?.type !== "link" || !detail.href) return;
      if (/^(https?:|mailto:)/i.test(detail.href)) {
        void openUrl(detail.href).catch(() => toast.error(t("reader.openLinkFailed")));
      }
    };
    window.addEventListener("notesage:report", onReport);
    return () => window.removeEventListener("notesage:report", onReport);
  }, [hasNativeReport, t]);

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
    <div className="view-enter relative h-full w-full bg-background">
      {/* Fallback transport for builds with no native chrome (desktop dev,
          the vitest harness). On device the player is drawn by the chrome
          overlay instead — a React island portals to document.body and would
          sit BEHIND a natively-presented report, which is the document kind
          people most want to listen to. */}
      {!nativeChrome && (
      <SpeechPlayerBar
        state={speech.state}
        onPlayPause={() => (speech.state.playing ? speech.pause() : speech.resume())}
        onSkip={speech.skip}
        onCycleRate={speech.cycleRate}
        onStop={speech.stop}
      />
      )}
      {/* Button islands (iOS 26 / Notes layout, #581). Back is ALWAYS the
          top-left island — placement must not depend on the document type.
          Top-right holds Share (issue #582) — the native share sheet over a
          temp copy of the file. */}
      {!nativeChrome && searchable && !editing && !speech.state.active && (
        <SearchIsland
          query={findQuery}
          onQueryChange={setFindQuery}
          placeholder={t("reader.find")}
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
      {!nativeChrome && (
        <>
          <Island corner="top-left">
            <ChromeButton label={t("reader.back")} onClick={backAction}>
              <ChevronLeft strokeWidth={1.5} className="h-5 w-5" />
            </ChromeButton>
          </Island>
          <Island corner="top-right">
            {editing ? (
              <ChromeButton label={t("reader.save")} onClick={() => void saveEdit()}>
                <Check strokeWidth={1.5} className="h-4 w-4" />
              </ChromeButton>
            ) : (
              <>
                {editable && (
                  <ChromeButton label={t("reader.edit")} onClick={startEdit}>
                    <Pencil strokeWidth={1.5} className="h-4 w-4" />
                  </ChromeButton>
                )}
                <ChromeButton
                  label={t("action.share")}
                  onClick={() => {
                    void iosShareFile(relPath).catch((err) => toast.error(t("action.shareFailed", { error: String(err) })));
                  }}
                >
                  <Share strokeWidth={1.5} className="h-4 w-4" />
                </ChromeButton>
              </>
            )}
          </Island>
        </>
      )}
      {state.status !== "pdf" && (
        <h1 className="pointer-events-none absolute left-1/2 top-[max(1.25rem,env(safe-area-inset-top))] z-40 max-w-[55vw] -translate-x-1/2 truncate text-sm font-medium text-muted-foreground">
          {name}
        </h1>
      )}

      {editing ? (
        // Raw-source editor. 16px font is REQUIRED — iOS auto-zooms the
        // viewport into any focused input with a smaller font, and never
        // zooms back out.
        <div className="absolute inset-0" style={CONTENT_INSETS}>
          <textarea
            autoFocus
            aria-label={t("reader.editor")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            className="h-full w-full resize-none border-0 bg-background px-5 py-6 text-[16px] leading-relaxed text-foreground outline-none"
            style={kind === "text" ? { fontFamily: "ui-monospace, monospace" } : undefined}
          />
        </div>
      ) : state.status === "pdf" ? (
        // The PdfViewer owns the full screen in island chrome mode: no
        // desktop pill, search + page indicator in its bottom-center
        // SearchIsland, back in our top-left island.
        <div className="absolute inset-0">
          <Suspense fallback={<ReaderMessage spinner>{t("reader.loading")}</ReaderMessage>}>
            <PdfViewer
              filePath={state.filePath}
              fileName={name}
              mobileChrome
              nativeFind={nativeChrome}
              mobileFindRef={pdfFindRef}
              onMobileFindState={setPdfFind}
            />
          </Suspense>
        </div>
      ) : state.status === "html" ? (
        // Scripts run; nothing else does. `allow-scripts` WITHOUT
        // `allow-same-origin` leaves the document on an opaque origin, so a
        // report can execute its own charts but cannot reach this app's DOM,
        // storage, or the Tauri IPC bridge. The document scrolls itself,
        // starting below the top islands.
        // Backed by the APP's background, and the frame itself stays
        // invisible until it has loaded. WebKit gives a sandboxed iframe an
        // opaque WHITE backing that no styling inside the document can
        // change, so a dark report flashed white on open — the same failure
        // as the launch flash, one layer down (Peter, 2026-08-14).
        <div className="absolute inset-0 bg-background">
          <iframe
            ref={htmlFrameRef}
            key={state.url}
            src={state.url}
            title={name}
            sandbox="allow-scripts"
            onLoad={() => setHtmlShownUrl(state.url)}
            className="h-full w-full border-0 transition-opacity duration-150"
            style={{ opacity: htmlShownUrl === state.url ? 1 : 0 }}
          />
        </div>
      ) : (
      <div ref={scrollerRef} className="absolute inset-0 overflow-y-auto" style={CONTENT_INSETS}>
        {state.status === "loading" && <ReaderMessage spinner>{t("reader.loading")}</ReaderMessage>}

        {state.status === "downloading" && (
          <ReaderMessage icon={CloudDownload} title={t("reader.downloading")}>
            {t("reader.downloadingHint")}
            <Button variant="outline" size="sm" className="ios-press-row mt-4" onClick={() => void load()}>
              {t("reader.retry")}
            </Button>
          </ReaderMessage>
        )}

        {state.status === "error" && (
          <ReaderMessage icon={AlertCircle} title={t("reader.openFailed")}>
            <span className="break-words">{state.message}</span>
            <Button variant="outline" size="sm" className="ios-press-row mt-4" onClick={() => void load()}>
              {t("library.tryAgain")}
            </Button>
          </ReaderMessage>
        )}

        {state.status === "unsupported" && (
          <ReaderMessage icon={FileQuestion} title={t("reader.unsupported")}>
            {name.split(".").pop()?.toUpperCase()} files aren't viewable in the
            mobile app yet — open it on your Mac.
          </ReaderMessage>
        )}

        {state.status === "too-large" && (
          <ReaderMessage icon={FileWarning} title={t("reader.tooLarge")}>
            This file is {formatBytes(state.sizeBytes)} — too large to preview
            safely in Notesage.
            <Button
              variant="outline"
              size="sm"
              className="ios-press-row mt-4"
              onClick={() => {
                void iosShareFile(relPath).catch((err) => toast.error(t("action.shareFailed", { error: String(err) })));
              }}
            >
              Share instead
            </Button>
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
            dangerouslySetInnerHTML={articleInnerHtml ?? { __html: "" }}
          />
        )}
      </div>
      )}

    </div>
  );
}

/**
 * The note's title for filename purposes (#586 — "title in doc becomes file
 * name"): first non-empty line after frontmatter, `#` markers stripped,
 * path-hostile characters replaced, capped at 60 chars. Null when the note
 * has no usable title (filename is left alone).
 */
/** Base64 for a small binary (a thumbnail) — chunked so a large array cannot
 *  blow the call stack through `String.fromCharCode(...bytes)`. */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function deriveNoteTitle(md: string): string | null {
  let src = md;
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(src);
  if (fm) src = src.slice(fm[0].length);
  for (const line of src.split("\n")) {
    const text = line.replace(/^#+\s*/, "").trim();
    if (!text) continue;
    const clean = text
      .replace(/[/\\:]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 60)
      .trim();
    return clean || null;
  }
  return null;
}

/** Human-readable file size for the too-large decline card. */
function formatBytes(bytes: number): string {
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
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
