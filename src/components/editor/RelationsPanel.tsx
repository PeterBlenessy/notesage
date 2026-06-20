/**
 * RelationsPanel — the document-scoped "wiki navigation" surface for the OKF
 * link graph (tasks #8 + #9, ADR 0004/0006).
 *
 * Docking (ADR 0004): the panel anchors to the RIGHT EDGE OF THE DOCUMENT
 * COLUMN, not the window edge. It mounts `absolute inset-y-0 right-0` inside the
 * document column (see QuietLayout), so the collapsed handle + rolled-out panel
 * track the column's box as the sidebar / pinned command bar resize — no shift
 * math, and it coexists with the pinned cmd bar (full-height right panel) and
 * the AgentOrb (bottom-right) because all three live in different boxes.
 *
 * Surface: built on the Radix `Popover` primitive (no hand-rolled floating div).
 * The slim right-edge handle IS the `PopoverTrigger` — always visible while the
 * doc has relations — and the content rolls out leftward (`side="left"`), flush
 * against the column edge with rounded LEFT corners and a flat right side. Radix
 * supplies focus trapping, Esc-to-close, click-away, and focus restoration.
 *
 * Partial height (~40–60% of the column, ADR 0004): the content height is driven
 * by `--relations-panel-height` (a fraction persisted in settings-store) and is
 * draggable taller via a top-edge resize handle that writes the CSS var live (no
 * React re-render mid-drag) and persists on release — mirroring the cmd-bar /
 * sidebar resize pattern.
 *
 * Attention pulse: the collapsed handle pulses a soft accent ring when the doc
 * has any relations. CSS-only (`.relations-handle-pulsing` keyframe in
 * globals.css), gated on BOTH `prefers-reduced-motion` (the @media guard) AND
 * `useReducedMotion()` (the class is omitted) per the design system.
 *
 * Self-hide: renders `null` when the active document has no relations (or none
 * is open) — no empty handle clutters the column. Loading / error states are
 * shown inside the rolled-out panel.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Link2, CornerUpLeft, CornerDownRight } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useDocumentRelations } from "@/hooks/useDocumentRelations";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { tryOpenFile } from "@/lib/link-utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { BacklinkGroup, BacklinkOccurrence, LinkRow } from "@/lib/tauri";

/** Last path segment of an absolute path. */
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Display label for a relation row: prefer frontmatter title, else basename. */
function relationLabel(title: string | null, path: string): string {
  return title && title.trim().length > 0 ? title : basename(path);
}

/** Truncated context characters before the "show more context" expand kicks in. */
const CONTEXT_PREVIEW_CHARS = 140;

// ---------------------------------------------------------------------------
// Type badge — neutral by default (design system: no invented chromatic colors)
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: string | null }) {
  if (!type || type.trim().length === 0) return null;
  return (
    <Badge
      variant="secondary"
      className="px-1.5 py-0 text-[10px] font-medium tracking-wide uppercase"
    >
      {type}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Backlink occurrence — surrounding context with "show more" expand (ADR 0006)
// ---------------------------------------------------------------------------

function OccurrenceContext({ occurrence }: { occurrence: BacklinkOccurrence }) {
  const [expanded, setExpanded] = useState(false);
  const context = occurrence.context ?? "";
  const isLong = context.length > CONTEXT_PREVIEW_CHARS;
  const shown =
    !isLong || expanded ? context : context.slice(0, CONTEXT_PREVIEW_CHARS).trimEnd() + "…";

  if (context.trim().length === 0) return null;

  return (
    <div className="text-xs leading-[1.5] text-muted-foreground">
      <span className="font-serif">{shown}</span>
      {isLong ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="ml-1 inline text-[11px] font-medium text-[var(--color-accent-primary)] hover:underline focus-visible:outline-none focus-visible:underline"
        >
          {expanded ? "show less" : "show more context"}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backlink group — header (source title + type badge + description) + occurrences
// ---------------------------------------------------------------------------

function BacklinkGroupRow({
  group,
  onNavigate,
}: {
  group: BacklinkGroup;
  onNavigate: (path: string) => void;
}) {
  const label = relationLabel(group.source_title, group.source_path);
  return (
    <li className="rounded-md border border-border/60 bg-muted/20 p-2">
      <button
        type="button"
        onClick={() => onNavigate(group.source_path)}
        className={cn(
          "group flex w-full items-center gap-1.5 text-left",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
        )}
      >
        <span className="truncate text-sm font-medium text-foreground group-hover:text-[var(--color-accent-primary)] transition-colors">
          {label}
        </span>
        <TypeBadge type={group.source_type} />
      </button>
      {group.source_description ? (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/80">
          {group.source_description}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-col gap-1.5">
        {group.occurrences.map((occ, i) => (
          <OccurrenceContext key={i} occurrence={occ} />
        ))}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Forward link row — target title + type badge + target description (ADR 0006)
// ---------------------------------------------------------------------------

function ForwardLinkRow({
  row,
  onNavigate,
}: {
  row: LinkRow;
  onNavigate: (path: string) => void;
}) {
  // Unresolved internal targets (dangling / not-yet-created) get a distinct
  // muted + dashed treatment (ADR 0007); external links are not navigated.
  const unresolved = row.is_internal && !row.resolved;
  const label = relationLabel(row.target_title, row.target_path);

  return (
    <li>
      <button
        type="button"
        disabled={!row.is_internal}
        onClick={() => onNavigate(row.target_path)}
        className={cn(
          "group flex w-full items-start gap-1.5 rounded-md border p-2 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          unresolved
            ? "border-dashed border-border/60 bg-transparent opacity-70 hover:opacity-100 hover:bg-muted/20"
            : "border-border/60 bg-muted/20 hover:bg-muted/40",
          !row.is_internal && "cursor-default",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate text-sm font-medium",
                unresolved
                  ? "text-muted-foreground italic"
                  : "text-foreground group-hover:text-[var(--color-accent-primary)] transition-colors",
              )}
            >
              {label}
            </span>
            <TypeBadge type={row.target_type} />
            {unresolved ? (
              <span className="shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                not created
              </span>
            ) : null}
          </div>
          {row.target_description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/80">
              {row.target_description}
            </p>
          ) : null}
        </div>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {icon}
      <span>{label}</span>
      <span className="text-muted-foreground/60 tabular-nums">{count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RelationsPanel
// ---------------------------------------------------------------------------

export function RelationsPanel({
  focusModeActive = false,
}: {
  /**
   * When focus mode is on, the panel is chrome and must hide — like the
   * sidebar / toolbar / orb. QuietLayout owns the live focus-mode flag
   * (`useFocusMode`) and passes it down; this component `return null`s when
   * active, which also unmounts any open PopoverContent (portaled to body, so
   * CSS alone couldn't close it). Defaults to false so existing callers /
   * tests that mount it bare are unaffected.
   */
  focusModeActive?: boolean;
} = {}) {
  const { backlinks, outlinks, loading, error, isEmpty, count, path } =
    useDocumentRelations();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);

  const openTab = useEditorStore((s) => s.openTab);
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);

  const relationsPanelHeight = useSettingsStore((s) => s.relationsPanelHeight);
  const setRelationsPanelHeight = useSettingsStore(
    (s) => s.setRelationsPanelHeight,
  );
  const relationsPanelWidth = useSettingsStore((s) => s.relationsPanelWidth);
  const setRelationsPanelWidth = useSettingsStore(
    (s) => s.setRelationsPanelWidth,
  );
  // When the command bar is pinned it docks as a fixed full-height right-edge
  // panel. Per ADR 0004 the relations panel COEXISTS with it (that is the whole
  // reason it anchors to the document column, not the window edge): we offset
  // the handle inward by the pinned cmd-bar width so it sits at the document
  // column's true right edge — just left of the chat panel — rather than under
  // it. (The AgentOrb hides because it is physically covered at bottom-right;
  // this panel is not, so it stays available.)
  const cmdBarPinned = useSettingsStore((s) => s.cmdBarPinned);
  const handleRight = cmdBarPinned ? "var(--cmd-bar-pinned-width, 400px)" : 0;

  // The rolled-out content's height is driven by a CSS variable so a resize
  // drag mutates the DOM directly (no React re-render mid-drag), mirroring the
  // cmd-bar / sidebar handle pattern.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startFraction: number } | null>(
    null,
  );
  // Left-edge width drag — mirrors the cmd-bar's no-handle edge resize. The
  // width is driven by `--relations-panel-width` so a drag mutates the DOM live
  // (no React re-render mid-drag) and persists on pointerup.
  // The width drag mutates the PopoverContent's `--relations-panel-width` var
  // directly so the resize is jank-free; we stash the element on pointer-down
  // (resolved from the hit-zone's ancestor — PopoverContent is a non-forwardRef
  // wrapper, so a React ref wouldn't reach the DOM node).
  const widthDragRef = useRef<{
    startX: number;
    startWidth: number;
    panel: HTMLElement;
  } | null>(null);

  const navigate = useCallback(
    (targetPath: string) => {
      // Reuse the same file-open path the sidebar / link-click use. The link
      // graph stores absolute resolved paths, so `tryOpenFile` resolves them
      // directly; the workspace roots are a fallback for safety.
      void (async () => {
        if (await tryOpenFile(targetPath, openTab)) {
          setOpen(false);
          return;
        }
        const roots = [
          ...projects.map((p) => p.path),
          ...explorerFolders.map((f) => f.path),
        ];
        for (const root of roots) {
          if (targetPath.startsWith(root + "/")) {
            if (await tryOpenFile(targetPath, openTab)) {
              setOpen(false);
              return;
            }
          }
        }
        toast.error(`Could not open: ${basename(targetPath)}`);
      })();
    },
    [openTab, projects, explorerFolders],
  );

  // ---- Resize drag (top edge) — clamps to the [0.4, 0.6] band ----
  const onResizePointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragStateRef.current;
      const el = contentRef.current;
      if (!drag || !el) return;
      const columnHeight = el.parentElement?.clientHeight ?? window.innerHeight;
      // Dragging UP (negative deltaY) grows the panel.
      const deltaFraction = (drag.startY - e.clientY) / columnHeight;
      const next = Math.max(0.4, Math.min(0.6, drag.startFraction + deltaFraction));
      el.style.setProperty("--relations-panel-height", String(next));
    },
    [],
  );

  const onResizePointerUp = useCallback(() => {
    const el = contentRef.current;
    window.removeEventListener("pointermove", onResizePointerMove);
    window.removeEventListener("pointerup", onResizePointerUp);
    dragStateRef.current = null;
    if (el) {
      const current = parseFloat(
        el.style.getPropertyValue("--relations-panel-height") ||
          String(relationsPanelHeight),
      );
      if (!Number.isNaN(current)) setRelationsPanelHeight(current);
    }
  }, [onResizePointerMove, relationsPanelHeight, setRelationsPanelHeight]);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragStateRef.current = {
        startY: e.clientY,
        startFraction: relationsPanelHeight,
      };
      window.addEventListener("pointermove", onResizePointerMove);
      window.addEventListener("pointerup", onResizePointerUp);
    },
    [relationsPanelHeight, onResizePointerMove, onResizePointerUp],
  );

  // ---- Width drag (left edge) — clamps to [280, 600] px ----
  // No visible handle, mirroring the cmd-bar edge resize: a thin transparent
  // hit-zone at the left edge. Dragging LEFT grows the panel (the panel rolls
  // out leftward), so a negative deltaX increases width.
  const onWidthPointerMove = useCallback((e: PointerEvent) => {
    const drag = widthDragRef.current;
    if (!drag) return;
    const deltaX = drag.startX - e.clientX; // drag left → positive → wider
    const next = Math.max(280, Math.min(600, drag.startWidth + deltaX));
    drag.panel.style.setProperty("--relations-panel-width", `${next}px`);
  }, []);

  const onWidthPointerUp = useCallback(() => {
    const drag = widthDragRef.current;
    window.removeEventListener("pointermove", onWidthPointerMove);
    window.removeEventListener("pointerup", onWidthPointerUp);
    widthDragRef.current = null;
    if (drag) {
      const current = parseFloat(
        drag.panel.style.getPropertyValue("--relations-panel-width") ||
          String(relationsPanelWidth),
      );
      if (!Number.isNaN(current)) setRelationsPanelWidth(current);
    }
  }, [onWidthPointerMove, relationsPanelWidth, setRelationsPanelWidth]);

  const onWidthPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const panel = (e.currentTarget as HTMLElement).closest<HTMLElement>(
        '[data-testid="relations-panel"]',
      );
      if (!panel) return;
      e.preventDefault();
      widthDragRef.current = {
        startX: e.clientX,
        startWidth: relationsPanelWidth,
        panel,
      };
      window.addEventListener("pointermove", onWidthPointerMove);
      window.addEventListener("pointerup", onWidthPointerUp);
    },
    [relationsPanelWidth, onWidthPointerMove, onWidthPointerUp],
  );

  const backlinkCount = useMemo(
    () => backlinks.reduce((s, g) => s + g.occurrences.length, 0),
    [backlinks],
  );

  // Self-hide entirely when the document has no relations (or none is open).
  // While loading we keep the handle hidden too — the count is unknown, and a
  // flash of an empty handle on every doc switch would be noise. The handle
  // appears once a non-empty result settles.
  //
  // Focus mode also hides the panel (it's chrome). Returning null unmounts the
  // whole Popover — closing any open content (which is portaled to body, beyond
  // CSS reach) — so this is the authoritative close-on-focus-mode path.
  if (focusModeActive || !path || loading || error || isEmpty || count === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="relations-handle"
                aria-label={`Relations — ${count} ${count === 1 ? "link" : "links"}`}
                style={{ right: handleRight }}
                className={cn(
                  // Slim vertical handle docked to the document column's right
                  // edge, vertically centred. Rounded LEFT corners only. `right`
                  // is offset by the pinned cmd-bar width (see `handleRight`) so
                  // it tracks the document column edge, not the window edge.
                  "absolute top-1/2 -translate-y-1/2 z-30",
                  "flex flex-col items-center justify-center gap-1",
                  "h-28 w-7 rounded-l-lg border border-r-0 border-border",
                  "bg-popover text-popover-foreground shadow-md",
                  "transition-[color,background-color,opacity] duration-150 hover:bg-muted/60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  // While the panel is open, fade the handle out (and disable it)
                  // so it doesn't sit blinking next to the open panel — the panel
                  // visually replaces the handle. Reduced motion snaps instantly.
                  open && "opacity-0 pointer-events-none",
                  "motion-reduce:transition-none",
                  // CSS-only attention pulse — omitted under reduced motion AND
                  // while open (a faded element shouldn't keep pulsing).
                  !reducedMotion && !open && "relations-handle-pulsing",
                )}
              >
                <Link2
                  className="h-3.5 w-3.5 text-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span
                  data-testid="relations-handle-count"
                  className="font-mono text-[11px] font-medium tabular-nums"
                >
                  {count}
                </span>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={8}>
            Relations — {count} {count === 1 ? "link" : "links"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent
        side="left"
        align="center"
        sideOffset={0}
        data-testid="relations-panel"
        // Don't yank focus onto the first row when the panel opens — it's a
        // reading surface; keep the caret where the user was. Tab still reaches
        // the rows. Reduced motion handled via motion-reduce variants below.
        onOpenAutoFocus={(e) => e.preventDefault()}
        style={
          {
            "--relations-panel-width": `${relationsPanelWidth}px`,
            width: "var(--relations-panel-width)",
          } as React.CSSProperties
        }
        className={cn(
          // Flush against the column edge (sideOffset 0); rounded LEFT, flat
          // RIGHT so it reads as docked to the column, not floating. Width is
          // user-resizable via the left-edge hit-zone below (--relations-panel-width).
          "p-0 rounded-l-xl rounded-r-none",
          "border-r-0 shadow-xl overflow-hidden",
          // "Grow from the handle" feel — the handle sits at the right edge, so
          // the open/close zoom originates there (the popover content already
          // ships data-state zoom-in-95/zoom-out-95 from @/components/ui/popover).
          "origin-right",
          "motion-reduce:!animate-none motion-reduce:!duration-0",
        )}
      >
        {/* Left-edge width resize — invisible full-height hit-zone, no handle
            indicator, mirroring the command bar's edge resize. Drag left to
            grow. (Keyboard width adjust is intentionally omitted, matching the
            cmd-bar's handle-less edge drag.) */}
        <div
          aria-hidden="true"
          onPointerDown={onWidthPointerDown}
          className={cn(
            "absolute inset-y-0 left-0 z-10 w-1.5",
            "cursor-ew-resize",
          )}
        />
        <div
          ref={contentRef}
          style={
            {
              "--relations-panel-height": String(relationsPanelHeight),
              height: "calc(var(--relations-panel-height) * 100vh)",
              maxHeight: "60vh",
              minHeight: "40vh",
            } as React.CSSProperties
          }
          className="flex flex-col"
        >
          {/* Top-edge resize handle — drag to grow taller (clamped 40–60%). */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Resize relations panel"
            aria-valuemin={40}
            aria-valuemax={60}
            aria-valuenow={Math.round(relationsPanelHeight * 100)}
            onPointerDown={onResizePointerDown}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setRelationsPanelHeight(relationsPanelHeight + 0.05);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setRelationsPanelHeight(relationsPanelHeight - 0.05);
              }
            }}
            className={cn(
              "group h-2 w-full shrink-0 cursor-ns-resize",
              "flex items-center justify-center",
              "focus-visible:outline-none",
            )}
          >
            <div className="h-0.5 w-8 rounded-full bg-border group-hover:bg-muted-foreground focus-within:bg-muted-foreground transition-colors" />
          </div>

          {/* Header */}
          <div className="flex items-center gap-1.5 border-b border-border/60 px-3 pb-2 pt-1">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            <span className="text-sm font-semibold">Relations</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {count}
            </span>
          </div>

          {/* Scrollable body — two sections (Links to + Linked from). */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
            {outlinks.length > 0 ? (
              <section className="mb-3">
                <SectionHeader
                  icon={<CornerDownRight className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />}
                  label="Links to"
                  count={outlinks.length}
                />
                <ul className="flex flex-col gap-1.5">
                  {outlinks.map((row, i) => (
                    <ForwardLinkRow
                      key={`${row.target_path}-${i}`}
                      row={row}
                      onNavigate={navigate}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {backlinks.length > 0 ? (
              <section>
                <SectionHeader
                  icon={<CornerUpLeft className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />}
                  label="Linked from"
                  count={backlinkCount}
                />
                <ul className="flex flex-col gap-1.5">
                  {backlinks.map((group) => (
                    <BacklinkGroupRow
                      key={group.source_path}
                      group={group}
                      onNavigate={navigate}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default RelationsPanel;
