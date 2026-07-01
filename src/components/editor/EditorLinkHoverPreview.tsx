/**
 * EditorLinkHoverPreview — in-editor hover preview for internal document links
 * (OKF wiki-navigation, task #10, ADR 0006/0007).
 *
 * Hovering an internal link inside the editor (`.ProseMirror a[href]` whose href
 * is a local path, not http/mailto/tel/#) shows a Peek card with the target's
 * title + `type` badge + description/snippet — so a neighbour can be read inline
 * without navigating away (critical in the single-document shell). An unresolved
 * target previews "Not yet created — click to create."
 *
 * Pattern: reuses the Peek timing + reduced-motion conventions of
 * `FolderPeek` / `FilePreview` — 220 ms open delay, 150 ms close grace, a portal
 * to `document.body`, and the `.typing`-independent fade classes stripped under
 * `useReducedMotion()`. It is a self-contained component: it attaches `mouseover`
 * / `mouseout` listeners scoped to `.ProseMirror` anchors via event delegation,
 * so the (large) Editor component needs no changes.
 *
 * Data: the same #7 link-graph data the RelationsPanel rows use. The hovered
 * link's metadata is matched out of `useDocumentRelations().outlinks` for the
 * active document by resolving the href to its absolute path (same resolution
 * `link-click.ts` does at runtime). The basename is used as a graceful fallback
 * label when the link isn't (yet) in the graph.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FilePlus2, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useDocumentRelations } from "@/hooks/useDocumentRelations";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { isExternalUrl, resolveCreateTarget } from "@/lib/link-utils";
import {
  extractPreviewParts,
  isPreviewable,
} from "@/components/sidebar/quiet/FilePreview";
import { tauriApi } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { LinkRow } from "@/lib/tauri";

const HOVER_DELAY_MS = 220;
const CLOSE_GRACE_MS = 150;
/** Lines of file content to show in the inline excerpt. */
const EXCERPT_LINE_COUNT = 6;

/** Last path segment of an absolute or relative path. */
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Normalize a path by resolving `.` and `..` segments. */
function normalizePath(path: string): string {
  const parts = path.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return (path.startsWith("/") ? "/" : "") + resolved.join("/");
}

/** Resolved hover-preview content for a single hovered link. */
interface PreviewState {
  /** The hovered link's raw href — identity key for race-guarding the fetch. */
  href: string;
  /** Display label (target title or basename). */
  label: string;
  type: string | null;
  description: string | null;
  /** A backlink/forward `context` snippet to show when no description exists. */
  snippet: string | null;
  /** False ⇒ internal but not-yet-created (ADR 0007). */
  resolved: boolean;
  /**
   * Absolute path to read for the content excerpt, in priority order. Empty for
   * unresolved links (nothing to fetch). The first that reads successfully wins.
   */
  fetchCandidates: string[];
  /**
   * Absolute path a click would CREATE the document at (active-file-dir-relative
   * resolution, matching `link-click.ts`). Null when not creatable.
   */
  createTarget: string | null;
  top: number;
  left: number;
}

/** Lazily-fetched content excerpt for the hovered file. */
type ExcerptState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; body: string }
  | { status: "empty" }
  | { status: "error" };

/**
 * Resolve an href to an absolute path the way `link-click.ts` does — relative
 * to the active file's directory, falling back to workspace roots. Returns the
 * candidate absolute paths in priority order.
 */
function resolveHrefCandidates(
  href: string,
  activeFileDir: string | undefined,
  roots: string[],
): string[] {
  if (href.startsWith("/") || href.startsWith("~")) return [href];
  const candidates: string[] = [];
  if (activeFileDir) candidates.push(normalizePath(`${activeFileDir}/${href}`));
  for (const root of roots) candidates.push(normalizePath(`${root}/${href}`));
  return candidates;
}

export function EditorLinkHoverPreview() {
  const reducedMotion = useReducedMotion();
  const { outlinks } = useDocumentRelations();

  const activeFileDir = useEditorStore((s) => {
    if (!s.activeTabId) return undefined;
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    if (!tab?.filePath) return undefined;
    const parts = tab.filePath.split("/");
    parts.pop();
    return parts.join("/");
  });
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [excerpt, setExcerpt] = useState<ExcerptState>({ status: "idle" });
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-mount content cache, keyed by absolute path. Avoids refetching when the
  // same link is hovered again. `null` = read failed (cached negative).
  const excerptCacheRef = useRef<Map<string, string | null>>(new Map());
  // Identity of the link the in-flight fetch belongs to, so a stale resolve
  // (link changed before the read returned) is ignored.
  const activeHrefRef = useRef<string | null>(null);

  // Index outlinks by absolute target path for O(1) hover lookup.
  const outlinksByPath = useMemo(() => {
    const map = new Map<string, LinkRow>();
    for (const row of outlinks) map.set(row.target_path, row);
    return map;
  }, [outlinks]);

  const roots = useMemo(
    () => [
      ...projects.map((p) => p.path),
      ...explorerFolders.map((f) => f.path),
    ],
    [projects, explorerFolders],
  );

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const resolveForHref = useCallback(
    (href: string, rect: DOMRect): PreviewState => {
      const candidates = resolveHrefCandidates(href, activeFileDir, roots);
      let match: LinkRow | undefined;
      for (const candidate of candidates) {
        match = outlinksByPath.get(candidate);
        if (match) break;
      }

      const fallbackLabel = basename(href.split("#")[0]);
      // Position the card to the right of the link, just below its top.
      const top = rect.bottom + 6;
      const left = rect.left;

      // The path a click would create the doc at — same resolution link-click.ts
      // hands to the create flow (active-file-dir-relative).
      const createTarget = resolveCreateTarget(href, activeFileDir);

      if (match) {
        const resolved = match.is_internal ? match.resolved : true;
        return {
          href,
          label:
            match.target_title && match.target_title.trim().length > 0
              ? match.target_title
              : basename(match.target_path),
          type: match.target_type,
          description: match.target_description,
          snippet:
            match.target_description == null && match.context.trim().length > 0
              ? match.context
              : null,
          resolved,
          // Only fetch content for resolved targets; the graph gives the
          // canonical absolute path.
          fetchCandidates: resolved ? [match.target_path] : [],
          createTarget,
          top,
          left,
        };
      }

      // Not in the graph (not yet reindexed, or a brand-new link). Treat as a
      // best-effort "resolved by path" preview — the file may exist on disk —
      // but with no enriched metadata. Try the resolution candidates for the
      // content excerpt; a read failure simply yields no excerpt.
      return {
        href,
        label: fallbackLabel,
        type: null,
        description: null,
        snippet: null,
        resolved: true,
        fetchCandidates: candidates,
        createTarget,
        top,
        left,
      };
    },
    [activeFileDir, roots, outlinksByPath],
  );

  // Dispatch the same create-on-click event link-click.ts fires for a dangling
  // link, then close the card. The React-layer hook (`useUnresolvedDocCreate`)
  // owns the toast + actual file creation — we never reimplement it here.
  const handleCreate = useCallback(() => {
    if (!preview?.createTarget) return;
    window.dispatchEvent(
      new CustomEvent("notesage:create-unresolved-doc", {
        detail: { absPath: preview.createTarget, href: preview.href },
      }),
    );
    clearTimers();
    setPreview(null);
  }, [preview, clearTimers]);

  // Event delegation on the document: only internal-link anchors inside a
  // `.ProseMirror` surface trigger the preview.
  useEffect(() => {
    const findInternalAnchor = (target: EventTarget | null): HTMLAnchorElement | null => {
      if (!(target instanceof HTMLElement)) return null;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return null;
      if (!anchor.closest(".ProseMirror")) return null;
      const href = anchor.getAttribute("href");
      if (!href || isExternalUrl(href)) return null;
      return anchor;
    };

    const handleOver = (event: MouseEvent) => {
      const anchor = findInternalAnchor(event.target);
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;

      clearTimers();
      openTimerRef.current = setTimeout(() => {
        const rect = anchor.getBoundingClientRect();
        setPreview(resolveForHref(href, rect));
      }, HOVER_DELAY_MS);
    };

    const handleOut = (event: MouseEvent) => {
      const anchor = findInternalAnchor(event.target);
      if (!anchor) return;
      // Don't close if moving into the preview card itself.
      const related = event.relatedTarget;
      if (related instanceof HTMLElement && related.closest("[data-link-hover-card]")) {
        return;
      }
      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      closeTimerRef.current = setTimeout(() => setPreview(null), CLOSE_GRACE_MS);
    };

    document.addEventListener("mouseover", handleOver);
    document.addEventListener("mouseout", handleOut);
    return () => {
      document.removeEventListener("mouseover", handleOver);
      document.removeEventListener("mouseout", handleOut);
      clearTimers();
    };
  }, [clearTimers, resolveForHref]);

  // Teardown on unmount.
  useEffect(() => () => clearTimers(), [clearTimers]);

  // Lazy content-excerpt fetch — runs when the card opens (preview set). Mirrors
  // the sidebar FilePreview: read the file, strip frontmatter, lift the title,
  // keep the first few lines. Cached per-path; race-guarded against the link
  // changing before the read returns.
  useEffect(() => {
    if (!preview) {
      activeHrefRef.current = null;
      setExcerpt({ status: "idle" });
      return;
    }

    activeHrefRef.current = preview.href;

    // Nothing to fetch (unresolved link, or no candidate path).
    if (!preview.resolved || preview.fetchCandidates.length === 0) {
      setExcerpt({ status: "idle" });
      return;
    }

    // Pick the first previewable candidate. (We don't know which exists yet, so
    // try each in order — the readFile attempt is the existence check.)
    const candidates = preview.fetchCandidates.filter(isPreviewable);
    if (candidates.length === 0) {
      setExcerpt({ status: "idle" });
      return;
    }

    // Serve from cache if every candidate is known.
    for (const path of candidates) {
      const cached = excerptCacheRef.current.get(path);
      if (cached === undefined) continue;
      if (cached === null) continue; // known-bad; keep trying others
      setExcerpt(cached ? { status: "ready", body: cached } : { status: "empty" });
      return;
    }

    let cancelled = false;
    const hrefAtStart = preview.href;
    setExcerpt({ status: "loading" });

    (async () => {
      for (const path of candidates) {
        // Skip cached negatives without refetching.
        if (excerptCacheRef.current.get(path) === null) continue;
        try {
          const content = await tauriApi.readFile(path);
          if (cancelled || activeHrefRef.current !== hrefAtStart) return;
          const { body } = extractPreviewParts(content, EXCERPT_LINE_COUNT);
          excerptCacheRef.current.set(path, body);
          setExcerpt(body ? { status: "ready", body } : { status: "empty" });
          return;
        } catch {
          excerptCacheRef.current.set(path, null);
          // Try the next candidate.
        }
      }
      if (cancelled || activeHrefRef.current !== hrefAtStart) return;
      // No candidate read successfully — no excerpt to show.
      setExcerpt({ status: "idle" });
    })();

    return () => {
      cancelled = true;
    };
  }, [preview]);

  if (!preview) return null;

  const animationClasses = reducedMotion
    ? ""
    : "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-120";

  return createPortal(
    <div
      data-link-hover-card
      data-testid="link-hover-preview"
      data-state="open"
      role="tooltip"
      onMouseEnter={() => {
        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
      }}
      onMouseLeave={() => {
        closeTimerRef.current = setTimeout(() => setPreview(null), CLOSE_GRACE_MS);
      }}
      style={{
        position: "fixed",
        top: preview.top,
        left: preview.left,
        maxWidth: 320,
      }}
      className={cn(
        "z-50 w-[300px] rounded-[10px] border bg-popover text-popover-foreground shadow-lg outline-hidden",
        "p-3",
        animationClasses,
      )}
    >
      <div className="flex items-center gap-1.5">
        <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
        <span
          className={cn(
            "truncate text-sm font-medium",
            !preview.resolved && "italic text-muted-foreground",
          )}
        >
          {preview.label}
        </span>
        {preview.type ? (
          <Badge
            variant="secondary"
            className="px-1.5 py-0 text-[10px] font-medium tracking-wide uppercase"
          >
            {preview.type}
          </Badge>
        ) : null}
      </div>

      {!preview.resolved ? (
        <div className="mt-1.5">
          <p className="text-xs text-muted-foreground">
            Not yet created — click to create.
          </p>
          {preview.createTarget ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCreate}
              className="mt-2 h-7 gap-1.5 border-[var(--color-accent-primary)] text-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary)]/10"
            >
              <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              Create document
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {preview.description ? (
            <p className="mt-1.5 line-clamp-3 text-xs leading-[1.5] text-muted-foreground font-serif">
              {preview.description}
            </p>
          ) : preview.snippet ? (
            <p className="mt-1.5 line-clamp-3 text-xs leading-[1.5] text-muted-foreground font-serif">
              {preview.snippet}
            </p>
          ) : excerpt.status === "ready" || excerpt.status === "loading" ? null : (
            <p className="mt-1.5 text-xs italic text-muted-foreground">
              No description.
            </p>
          )}

          {/* Content excerpt — the first few lines of the target file, like the
              sidebar FilePreview. Fetched lazily when the card opens. */}
          {excerpt.status === "loading" ? (
            <div className="mt-2 flex flex-col gap-1.5" aria-hidden="true">
              {[0.9, 0.7, 0.8].map((width, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-2 rounded-sm bg-muted",
                    !reducedMotion && "animate-pulse",
                  )}
                  style={{ width: `${width * 100}%` }}
                />
              ))}
            </div>
          ) : excerpt.status === "ready" ? (
            <pre className="mt-2 max-h-32 overflow-hidden whitespace-pre-wrap break-words border-t border-border/60 pt-2 text-[11px] leading-[1.5] text-muted-foreground font-serif m-0">
              {excerpt.body}
            </pre>
          ) : null}
        </>
      )}
    </div>,
    document.body,
  );
}

export default EditorLinkHoverPreview;
