import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  isAnyContextMenuOpen,
  subscribeToOpenContextMenus,
} from "@/lib/sidebar-context-menu-state";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { tauriApi } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "@/components/MarkdownContent";

/**
 * FilePreview — hover popover that shows the first N lines of a file.
 *
 * Wraps any trigger element (typically a file row) and, after a hover delay
 * (default 500 ms), opens a Radix Popover with the file's first ~10 lines of
 * text. YAML frontmatter is stripped before line-counting so markdown previews
 * are actually useful. Non-text extensions render a muted "No preview
 * available" message instead of fetching.
 *
 * Caching: previews are memoized per-path for the component's lifetime via a
 * ref-held `Map`. In-flight fetches set a stale flag so that a second hover
 * before the first request resolves still benefits from the cached result.
 *
 * Accessibility: `role="tooltip"` on the popover content — hover previews are
 * semantically tooltips. Keyboard users don't see this at all; they use the
 * tree overlay or right-arrow expansion pattern. `aria-label` includes the
 * basename for screen readers that do surface hovered content.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extensions whose contents we'll attempt to read and display. */
const PREVIEWABLE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "log",
  "yaml",
  "yml",
  "json",
  "toml",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rs",
  "go",
  "html",
  "css",
]);

/** Default hover delay in milliseconds. */
const DEFAULT_DELAY_MS = 500;

/** Default number of lines to show in the preview body. */
const DEFAULT_LINE_COUNT = 10;

/** Grace period (ms) before closing after mouse leaves; prevents flicker. */
const CLOSE_GRACE_MS = 150;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilePreviewProps {
  /** Absolute path to the file whose preview should be shown on hover. */
  filePath: string;
  /** The trigger element (row). */
  children: ReactNode;
  /** Optional hover delay override; defaults to 500ms. */
  delayMs?: number;
  /** Optional preview line count override; defaults to 10. */
  lineCount?: number;
  /** Optional placement override; defaults to "right". */
  side?: "top" | "right" | "bottom" | "left";
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Return the final path segment (filename). */
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Extract lowercase extension without the leading dot, or null when none. */
function getExtension(path: string): string | null {
  const name = basename(path);
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return null;
  return name.slice(idx + 1).toLowerCase();
}

/** Whether the file extension is in the text-like allowlist. */
export function isPreviewable(path: string): boolean {
  const ext = getExtension(path);
  if (!ext) return false;
  return PREVIEWABLE_EXTENSIONS.has(ext);
}

/**
 * Short file-type label for the preview header. Live-test feedback
 * 2026-04-24: the previous "Markdown" label felt techy; the filename
 * already ends in `.md` so the label just needs to be a compact badge
 * ("md", "txt", etc.) that lets the user scan at a glance.
 */
function formatTypeLabel(path: string): string {
  const ext = getExtension(path);
  if (!ext) return "file";
  return ext;
}

/**
 * Whether the file should be rendered as markdown (vs. raw monospace)
 * in the preview body. Only `.md` / `.markdown` get the rendered view
 * — other text formats (json, yaml, code) stay in the monospace `<pre>`
 * because their structure is best conveyed by preserving whitespace.
 */
function shouldRenderMarkdown(path: string): boolean {
  const ext = getExtension(path);
  return ext === "md" || ext === "markdown";
}

/**
 * Strip leading YAML frontmatter (a `---`-delimited block at the very top of
 * the file). When no frontmatter is present or it is unterminated, the
 * original content is returned unchanged.
 */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return content;
  }
  // Skip the opening fence and find the closing fence on its own line.
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return content;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }
  return content;
}

/** Extract the first N lines of `content`, stripping any leading frontmatter. */
export function extractPreviewLines(content: string, lineCount: number): string {
  const body = stripFrontmatter(content);
  return body.split(/\r?\n/).slice(0, lineCount).join("\n");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; body: string }
  | { status: "error" }
  | { status: "unsupported" };

export function FilePreview({
  filePath,
  children,
  delayMs = DEFAULT_DELAY_MS,
  lineCount = DEFAULT_LINE_COUNT,
  side = "right",
}: FilePreviewProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });

  const reducedMotion = useReducedMotion();

  // Timer handles for open-delay and close-grace.
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  // Per-mount cache: previously fetched previews keyed by absolute path.
  const cacheRef = useRef<Map<string, string>>(new Map());

  // Tracks whether the last scheduled open is still valid — set to false when
  // the pointer leaves before the fetch resolves so we don't open a stale
  // popover. Keyed per path so a second hover on the same row still wins.
  const activePathRef = useRef<string | null>(null);

  // Track unmount so async fetches don't touch state after teardown.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
      }
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const loadPreview = useCallback(
    async (path: string) => {
      if (!isPreviewable(path)) {
        if (mountedRef.current && activePathRef.current === path) {
          setState({ status: "unsupported" });
        }
        return;
      }

      const cached = cacheRef.current.get(path);
      if (cached !== undefined) {
        if (mountedRef.current && activePathRef.current === path) {
          setState({ status: "ready", body: cached });
        }
        return;
      }

      setState({ status: "loading" });

      try {
        const content = await tauriApi.readFile(path);
        const body = extractPreviewLines(content, lineCount);
        cacheRef.current.set(path, body);
        if (mountedRef.current && activePathRef.current === path) {
          setState({ status: "ready", body });
        }
      } catch (error) {
        // Log for debugging but do NOT show a toast — hover previews are
        // too noisy for user-facing error notifications.
        // eslint-disable-next-line no-console
        console.debug("[FilePreview] read_file failed:", path, error);
        if (mountedRef.current && activePathRef.current === path) {
          setState({ status: "error" });
        }
      }
    },
    [lineCount],
  );

  // Track whether the cursor is currently inside the trigger row OR the
  // open popover content. Read by the open-context-menu subscriber so it
  // can re-evaluate close logic the moment a context menu dismisses —
  // without forcing the user to wiggle the mouse to retrigger mouseleave.
  const cursorInsideRef = useRef(false);

  const handleMouseEnter = useCallback(() => {
    cursorInsideRef.current = true;
    // Cancel any pending close.
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (open) return;

    // Live-test 2026-04-25 — don't open the preview while a sidebar
    // context menu is up. React's portal-traversing synthetic events
    // bubble `mouseenter` from the menu portal back through this
    // trigger's React ancestors, which would otherwise schedule a
    // spontaneous open that pops over the menu.
    if (isAnyContextMenuOpen()) return;

    // Schedule open after the hover delay.
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
    }
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      // Re-check at fire time — a menu may have opened during the delay.
      if (isAnyContextMenuOpen()) return;
      activePathRef.current = filePath;
      setOpen(true);
      void loadPreview(filePath);
    }, delayMs);
  }, [delayMs, filePath, loadPreview, open]);

  const handleMouseLeave = useCallback(() => {
    cursorInsideRef.current = false;
    // Cancel a pending open — the user didn't hover long enough.
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }

    if (!open) return;

    // Live-test 2026-04-25 — while a context menu is open inside (or
    // adjacent to) the preview, don't schedule the close. Otherwise
    // closing the preview would unmount the Radix Root that lives
    // inside the preview's portal, which would dismiss the menu too.
    if (isAnyContextMenuOpen()) return;

    // Grace period before closing to smooth out tiny gaps between the row
    // and the popover content.
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      activePathRef.current = null;
      setOpen(false);
      setState({ status: "idle" });
    }, CLOSE_GRACE_MS);
  }, [open]);

  // When all context menus close, re-evaluate: if the cursor has since
  // moved out of the trigger / popover, schedule the deferred close.
  // The cursorInsideRef tracks live hover state so this check matches
  // what mouseleave would have done if the menu hadn't blocked it.
  useEffect(() => {
    return subscribeToOpenContextMenus(() => {
      if (isAnyContextMenuOpen()) return;
      // Menu just closed.
      if (!open) return;
      if (cursorInsideRef.current) return;
      // Cursor is outside — replicate the mouseLeave close path.
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        activePathRef.current = null;
        setOpen(false);
        setState({ status: "idle" });
      }, CLOSE_GRACE_MS);
    });
  }, [open]);

  // Live-test 2026-04-25 (#128 — final). See FolderPeek.tsx for the
  // full design history. Short version: every attempt to React-state-
  // close this preview during a right-click event raced with Radix's
  // ContextMenu mount and either dismissed the menu or visibly
  // overlapped it. Final design: don't close the preview from
  // contextmenu at all — just cancel pending hover-open timers so a
  // delayed open doesn't fire while the menu is up. The preview
  // closes naturally via the existing mouseleave grace timer when
  // the user moves the cursor toward the menu items. Z-stacking is
  // handled by `[data-slot="context-menu-content"] { z-index: 60; }`
  // in globals.css so the menu always sits on top during the brief
  // overlap.
  const handleContextMenu = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const name = basename(filePath);
  const typeLabel = formatTypeLabel(filePath);

  return (
    <Popover open={open}>
      <PopoverTrigger asChild>
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
          // Reset the anchor — div isn't focusable; we don't interfere with
          // the child row's own focus semantics.
        >
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent
        role="tooltip"
        aria-label={`File preview — ${name}`}
        side={side}
        align="start"
        sideOffset={8}
        // Let a pointer that enters the preview count as "still hovering" so
        // users can inspect the content without it immediately closing.
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        // Radix by default moves focus into the popover on open — for a
        // hover tooltip this would steal focus from the list row. Prevent it.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Honor prefers-reduced-motion. Expose a data attribute so the
        // render-time JS hook can be observed in tests / inspector; the
        // actual animation suppression is handled by Tailwind's
        // `motion-reduce:` variants which map to the OS-level media query
        // (more robust than chasing inline-style shadowing through Radix).
        data-reduced-motion={reducedMotion ? "true" : undefined}
        className={cn(
          // 300px + 14px inner padding matches the mockup-L peek
          // dimensions exactly. Slightly tighter than our prior 360px
          // so the preview feels more like a tooltip than a panel.
          "w-[300px] p-0 overflow-hidden",
          "motion-reduce:!animate-none motion-reduce:!duration-0",
        )}
      >
        {/* Header — title + short type badge. Mockup-L (mockup-l-sidebar-
            interactions.html) puts the filename in bold with a subtle
            meta line underneath; we follow the same structure. Type
            label is lowercase and compact ("md", "txt") — the earlier
            uppercase "MARKDOWN" felt techy, per live-test feedback. */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
          <span className="text-sm font-medium truncate">{name}</span>
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground shrink-0 rounded-sm bg-muted/50 px-1.5 py-0.5">
            {typeLabel}
          </span>
        </div>
        <div className="px-3 py-2 max-h-72 overflow-y-auto overflow-x-hidden">
          {state.status === "loading" && (
            <div className="flex flex-col gap-1.5" aria-hidden="true">
              {[0.9, 0.75, 0.85, 0.6, 0.7].map((width, i) => (
                <div
                  key={i}
                  className="h-2 rounded-sm bg-muted animate-pulse"
                  style={{ width: `${width * 100}%` }}
                />
              ))}
            </div>
          )}
          {state.status === "unsupported" && (
            <p className="text-xs text-muted-foreground">
              No preview available
            </p>
          )}
          {state.status === "error" && (
            <p className="text-xs text-muted-foreground">
              Preview unavailable
            </p>
          )}
          {state.status === "ready" && (
            state.body ? (
              shouldRenderMarkdown(filePath) ? (
                // Rendered markdown — honors headings, bold, italic,
                // lists, links, etc. Live-test feedback 2026-04-24:
                // raw markdown in a `<pre>` felt like a dev tool;
                // moving to rendered output matches the writing-surface
                // aesthetic the rest of the Quiet Composer already has.
                //
                // `font-serif` + muted foreground matches mockup-L's
                // reading aesthetic (the mockup uses `var(--serif)` at
                // 12.5px/1.55 with muted colour). Code blocks flip
                // back to monospace via the `[&_code]` selector.
                <MarkdownContent
                  content={state.body}
                  className="font-serif text-xs leading-[1.55] text-muted-foreground [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mb-1 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-medium [&_h3]:text-foreground [&_p]:mb-2 [&_ul]:pl-4 [&_ol]:pl-4 [&_code]:font-mono [&_code]:text-[11px] [&_pre]:font-mono"
                />
              ) : (
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words m-0">
                  {state.body}
                </pre>
              )
            ) : (
              <p className="text-xs italic text-muted-foreground">Empty file</p>
            )
          )}
        </div>
        {/* No footer — mockup-L had a "Click to open · ⌘click for new
            tab" hint, but live-test feedback 2026-04-24 said it's
            noise. Click + ⌘-click are the expected verbs for any file
            row and don't need an inline legend. */}
      </PopoverContent>
    </Popover>
  );
}
