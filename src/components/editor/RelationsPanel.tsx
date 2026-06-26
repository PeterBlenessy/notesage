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
 * Surface (morph): a SINGLE element docked flush to the column's right edge that
 * morphs between the slim handle (collapsed) and the rolled-out panel (open) —
 * size + corner radius ease via `.relations-morph`, while the handle / panel
 * faces crossfade. A true morph needs one element, so this does NOT use Radix
 * `Popover` (which portals content to `<body>` as a separate node); the a11y
 * Radix gave us is hand-rolled instead: Esc closes + returns focus to the handle,
 * a pointerdown outside closes, the collapsed panel face is `inert`, and the
 * faded-out handle drops from the tab order while open. Per ADR 0004 it keeps
 * coexisting with the pinned cmd bar (the `right` offset) and the AgentOrb.
 *
 * Partial height (~40–60% of the column, ADR 0004): the open height is driven by
 * `--relations-panel-height` (a fraction persisted in settings-store), draggable
 * via a top-edge handle that writes the CSS var live (no React re-render
 * mid-drag) and persists on release; width is the same pattern on the left edge.
 *
 * Attention cue (comet): while collapsed the handle traces a "comet" around its
 * border — a bright lead dot + a tapering tail of dimmer/smaller dots — for 3
 * laps, then settles ("announce, then quiet"; re-keyed on each doc-open). CSS in
 * globals.css (`.relations-comet-dot` + `offset-path`); the dots are omitted
 * under `useReducedMotion()`, with an @media guard parking a static head.
 *
 * Self-hide: renders `null` when the active document has no relations (or none
 * is open) — no empty handle clutters the column. Loading / error states are
 * shown inside the rolled-out panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, CornerUpLeft, CornerDownRight } from "lucide-react";
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
// Comet attention cue — a bright lead dot with a tapering tail of dimmer,
// smaller dots tracing the collapsed handle's border. The dots overlap near the
// head into one streak; size + opacity ease down to a thin faint tail. Per-dot
// size/opacity/delay are computed here and applied inline; the offset-path,
// keyframe, and 3-lap run live in `.relations-comet-dot` (globals.css). Keyed by
// document `path` at the call site so the 3 laps restart on each doc-open.
// ---------------------------------------------------------------------------

const COMET_DOT_COUNT = 18;
const COMET_DURATION_MS = 3400; // must match the `.relations-comet-dot` animation
const COMET_TAIL_FRACTION = 0.2; // tail spans ~20% of the border

function RelationsComet() {
  const dots = useMemo(() => {
    const delayMax = COMET_DURATION_MS * COMET_TAIL_FRACTION;
    const step = delayMax / (COMET_DOT_COUNT - 1);
    // Emit tail→head so the bright head paints last (on top of the tail).
    return Array.from({ length: COMET_DOT_COUNT }, (_, k) => COMET_DOT_COUNT - 1 - k).map(
      (i) => {
        const f = i / (COMET_DOT_COUNT - 1); // 0 = head, 1 = tail
        return {
          i,
          size: 7 - 6 * Math.pow(f, 0.65), // 7px head → ~1px tail
          opacity: Math.pow(1 - f, 1.25), // fades faster toward the tail
          delay: -delayMax + i * step, // head furthest along (most negative)
          head: i === 0,
        };
      },
    );
  }, []);

  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      {dots.map(({ i, size, opacity, delay, head }) => (
        <span
          key={i}
          className={cn("relations-comet-dot", head && "relations-comet-head")}
          style={{
            width: `${size.toFixed(2)}px`,
            height: `${size.toFixed(2)}px`,
            opacity,
            animationDelay: `${delay.toFixed(0)}ms`,
          }}
        />
      ))}
    </span>
  );
}

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
   * active, which unmounts the whole morph (handle + panel), so an open panel
   * is closed too. Defaults to false so existing callers / tests that mount it
   * bare are unaffected.
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

  // The morph container (handle ⇄ panel) is a single element. Refs let
  // click-away / Esc / focus-return and the resize drags reach it directly. A
  // resize drag mutates the container's `--relations-panel-width/height` vars
  // live (no React re-render mid-drag), mirroring the cmd-bar / sidebar pattern.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startFraction: number } | null>(
    null,
  );
  const widthDragRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

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

  // Hand-rolled a11y for the morph (no Radix Popover, so the handle and panel
  // can be one morphing element): Esc closes and returns focus to the handle; a
  // pointerdown outside the container closes. Active only while open. Esc is
  // captured + stopped so it closes the panel before any global Esc handler
  // (focus mode can't be active here — it hides the whole panel — so there's no
  // real contention, but capture keeps the ordering unambiguous).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        handleRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  // ---- Resize drag (top edge) — clamps to the [0.4, 0.6] band ----
  const onResizePointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragStateRef.current;
      const el = rootRef.current;
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
    const el = rootRef.current;
    window.removeEventListener("pointermove", onResizePointerMove);
    window.removeEventListener("pointerup", onResizePointerUp);
    dragStateRef.current = null;
    if (el) {
      el.style.transition = ""; // restore the morph transition (className-driven)
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
      // Suppress the morph size-transition during the live drag so it tracks
      // the pointer instead of easing behind it.
      if (rootRef.current) rootRef.current.style.transition = "none";
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
  // hit-zone at the left edge. Dragging LEFT grows the panel (it rolls out
  // leftward), so a negative deltaX increases width.
  const onWidthPointerMove = useCallback((e: PointerEvent) => {
    const drag = widthDragRef.current;
    const el = rootRef.current;
    if (!drag || !el) return;
    const deltaX = drag.startX - e.clientX; // drag left → positive → wider
    const next = Math.max(280, Math.min(600, drag.startWidth + deltaX));
    el.style.setProperty("--relations-panel-width", `${next}px`);
  }, []);

  const onWidthPointerUp = useCallback(() => {
    const el = rootRef.current;
    window.removeEventListener("pointermove", onWidthPointerMove);
    window.removeEventListener("pointerup", onWidthPointerUp);
    widthDragRef.current = null;
    if (el) {
      el.style.transition = "";
      const current = parseFloat(
        el.style.getPropertyValue("--relations-panel-width") ||
          String(relationsPanelWidth),
      );
      if (!Number.isNaN(current)) setRelationsPanelWidth(current);
    }
  }, [onWidthPointerMove, relationsPanelWidth, setRelationsPanelWidth]);

  const onWidthPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      if (rootRef.current) rootRef.current.style.transition = "none";
      widthDragRef.current = {
        startX: e.clientX,
        startWidth: relationsPanelWidth,
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
  // whole morph (handle + panel), so this is the authoritative
  // close-on-focus-mode path.
  if (focusModeActive || !path || loading || error || isEmpty || count === 0) {
    return null;
  }

  // Morph geometry: collapsed = the 28×112 handle (w-7 h-28, rounded-l-lg);
  // open = the user-resizable panel (width var, 40–60vh). The single container
  // eases between the two (`.relations-morph`) while the handle / panel faces
  // crossfade. `right` is offset by the pinned cmd-bar width so the whole thing
  // tracks the document column's right edge, not the window edge.
  const containerStyle: React.CSSProperties = open
    ? ({
        right: handleRight,
        "--relations-panel-width": `${relationsPanelWidth}px`,
        "--relations-panel-height": String(relationsPanelHeight),
        width: "var(--relations-panel-width)",
        height: "calc(var(--relations-panel-height) * 100vh)",
        maxHeight: "60vh",
        minHeight: "40vh",
        borderRadius: "0.75rem 0 0 0.75rem",
      } as React.CSSProperties)
    : ({
        right: handleRight,
        width: "1.75rem", // w-7
        height: "7rem", // h-28
        borderRadius: "0.5rem 0 0 0.5rem",
      } as React.CSSProperties);

  return (
    <div
      ref={rootRef}
      data-testid="relations-root"
      data-state={open ? "open" : "closed"}
      style={containerStyle}
      className={cn(
        "relations-morph absolute top-1/2 z-30 -translate-y-1/2 overflow-hidden",
        "border border-r-0 border-border bg-popover text-popover-foreground shadow-xl",
      )}
    >
      {/* ---- Handle face (collapsed): comet + icon + count. Click toggles. ---- */}
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={handleRef}
              type="button"
              data-testid="relations-handle"
              aria-label={`Relations — ${count} ${count === 1 ? "link" : "links"}`}
              aria-expanded={open}
              aria-hidden={open || undefined}
              tabIndex={open ? -1 : undefined}
              onClick={() => setOpen((o) => !o)}
              className={cn(
                "absolute inset-0 z-10 flex flex-col items-center justify-center gap-1",
                "transition-opacity duration-150 hover:bg-muted/60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                // Fade out + disable once open — the panel face replaces it.
                open && "opacity-0 pointer-events-none",
                "motion-reduce:transition-none",
              )}
            >
              {/* Comet attention cue — collapsed only, omitted under reduced
                  motion. Keyed by `path` so its 3 laps restart on each doc-open. */}
              {!reducedMotion && !open ? <RelationsComet key={path} /> : null}
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
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={8}>
            Relations — {count} {count === 1 ? "link" : "links"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* ---- Panel face (expanded): header + body. Always mounted so the morph
          can crossfade both ways; inert + faded while collapsed. The container
          (not this div) owns the size, so this just fills it. ---- */}
      <div
        data-testid="relations-panel"
        role="region"
        aria-label="Relations"
        inert={!open}
        className={cn(
          "absolute inset-0 flex flex-col",
          "transition-opacity duration-150",
          // Fade in only once the box has grown (delay); fade out immediately.
          open ? "opacity-100 delay-[120ms]" : "pointer-events-none opacity-0",
          "motion-reduce:!transition-none motion-reduce:!delay-0",
        )}
      >
        {/* Left-edge width resize — invisible full-height hit-zone (drag left to
            grow), mirroring the command bar's handle-less edge drag. */}
        <div
          aria-hidden="true"
          onPointerDown={onWidthPointerDown}
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize"
        />

        {/* Top-edge height resize handle — drag to grow taller (clamped 40–60%). */}
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
            "flex items-center justify-center focus-visible:outline-none",
          )}
        >
          <div className="h-0.5 w-8 rounded-full bg-border transition-colors group-hover:bg-muted-foreground focus-within:bg-muted-foreground" />
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
    </div>
  );
}

export default RelationsPanel;
