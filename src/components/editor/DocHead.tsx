import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatSavedLabel, pickTimerInterval } from "@/lib/saved-ago";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * DocHead — breadcrumb header for the active document in the quiet-composer UI
 * (PRD `2026-04-21-ui-refresh`, task #48). Replaces the legacy `TabBar`.
 *
 * Renders `Notesage / project / folder / file.md` with a dirty dot, a
 * right-aligned "saved Xs ago" timer, and a 130 px right-zone reservation for
 * the future accent / theme affordance. Read-only — click handlers land in a
 * later task.
 */

const RESERVED_RIGHT_ZONE_WIDTH = 130;
const MIDDLE_SEGMENT_LIMIT = 4;
const COLLAPSE_MARKER = "\u2026";

type SegmentKind = "root" | "project" | "library" | "folder" | "collapsed" | "file";

export interface BreadcrumbSegment {
  kind: SegmentKind;
  label: string;
}

interface BreadcrumbContext {
  projects: Array<Pick<WorkspaceProject, "path">>;
  libraryRoot: string | null;
}

/**
 * Resolve a file path into a breadcrumb of segments: `[root, project?, …folders, file]`.
 * Export is intentional — DocHead unit tests exercise it directly without mounting
 * the component.
 */
export function buildBreadcrumb(
  filePath: string | null | undefined,
  ctx: BreadcrumbContext,
): BreadcrumbSegment[] {
  const rootSegment: BreadcrumbSegment = { kind: "root", label: "Notesage" };
  if (!filePath) return [rootSegment];

  const projects = [...ctx.projects].sort((a, b) => b.path.length - a.path.length);

  const owningProject = projects.find((p) => filePath === p.path || filePath.startsWith(p.path + "/"));

  let anchorPath: string;
  let anchorSegment: BreadcrumbSegment;

  if (owningProject) {
    anchorPath = owningProject.path;
    anchorSegment = { kind: "project", label: basename(owningProject.path) };
  } else if (ctx.libraryRoot && filePath.startsWith(ctx.libraryRoot + "/")) {
    anchorPath = ctx.libraryRoot;
    anchorSegment = { kind: "library", label: "Library" };
  } else {
    const parts = filePath.replace(/^\/+/, "").split("/");
    const topLevel = parts[0] ?? filePath;
    anchorPath = filePath.startsWith("/") ? "/" + topLevel : topLevel;
    anchorSegment = { kind: "folder", label: topLevel };
  }

  const tail = filePath.slice(anchorPath.length).replace(/^\/+/, "");
  const tailParts = tail ? tail.split("/") : [];
  const fileName = tailParts.pop() ?? basename(filePath);

  const middleSegments: BreadcrumbSegment[] = tailParts.map((label) => ({
    kind: "folder",
    label,
  }));

  const collapsed = collapseMiddleSegments(middleSegments);

  return [rootSegment, anchorSegment, ...collapsed, { kind: "file", label: fileName }];
}

function collapseMiddleSegments(segments: BreadcrumbSegment[]): BreadcrumbSegment[] {
  if (segments.length <= MIDDLE_SEGMENT_LIMIT) return segments;
  // Keep the first segment and the final (MIDDLE_SEGMENT_LIMIT - 2) segments,
  // inserting the collapse marker between them. This preserves context on both
  // ends of the path without growing the breadcrumb past the budget.
  const keepTail = MIDDLE_SEGMENT_LIMIT - 2;
  const head = segments.slice(0, 1);
  const tail = segments.slice(segments.length - keepTail);
  return [
    ...head,
    { kind: "collapsed", label: COLLAPSE_MARKER },
    ...tail,
  ];
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

interface SavedLabelProps {
  lastSavedAt: number | undefined;
  isDirty: boolean;
}

function SavedLabel({ lastSavedAt, isDirty }: SavedLabelProps) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (isDirty) return;
    if (lastSavedAt === undefined) return;
    const tick = () => setNow(Date.now());
    tick();
    const elapsed = Date.now() - lastSavedAt;
    const interval = pickTimerInterval(elapsed);
    const id = window.setInterval(tick, interval);
    return () => window.clearInterval(id);
  }, [lastSavedAt, isDirty]);

  if (isDirty) return null;

  if (lastSavedAt === undefined) {
    return (
      <span
        className="text-xs text-muted-foreground tabular-nums"
        aria-live="polite"
        aria-label="Not yet saved this session"
      >
        &mdash;
      </span>
    );
  }

  const label = formatSavedLabel(now - lastSavedAt);
  return (
    <span
      className="text-xs text-muted-foreground tabular-nums"
      aria-live="polite"
    >
      {label}
    </span>
  );
}

interface CrumbProps {
  segment: BreadcrumbSegment;
  isLast: boolean;
  dirty: boolean;
}

function Crumb({ segment, isLast, dirty }: CrumbProps) {
  const isMiddle = !isLast && segment.kind !== "root" && segment.kind !== "collapsed";
  const baseClass = isLast
    ? "text-sm font-medium text-foreground"
    : "text-xs text-muted-foreground";

  return (
    <li
      className="flex items-center min-w-0"
      {...(isLast ? { "aria-current": "page" as const } : {})}
    >
      {isLast && dirty ? (
        <span
          role="status"
          aria-label="Unsaved changes"
          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--accent, var(--primary))" }}
        />
      ) : null}
      <span
        className={cn(
          baseClass,
          isMiddle && "truncate max-w-[14ch]",
          segment.kind === "collapsed" && "text-muted-foreground/70",
        )}
        title={segment.label}
      >
        {segment.label}
      </span>
    </li>
  );
}

function Separator() {
  return (
    <li aria-hidden="true" className="text-muted-foreground/60 px-1.5 text-xs select-none">
      /
    </li>
  );
}

export function DocHead() {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tab = useEditorStore((s) =>
    activeTabId ? s.tabs.find((t) => t.id === activeTabId) ?? null : null,
  );
  const projects = useWorkspaceStore((s) => s.projects);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);

  const libraryRoot = useMemo(
    () => (notesRootPath && !notesRootPath.startsWith("~") ? notesRootPath : null),
    [notesRootPath],
  );

  const projectCtx = useMemo<BreadcrumbContext>(
    () => ({ projects: projects.map((p) => ({ path: p.path })), libraryRoot }),
    [projects, libraryRoot],
  );

  const segments = useMemo(
    () => buildBreadcrumb(tab?.filePath ?? null, projectCtx),
    [tab?.filePath, projectCtx],
  );

  return (
    <header
      data-doc-head
      aria-label="Document breadcrumb"
      className={cn(
        "flex h-10 items-center px-3",
        "transition-opacity duration-[340ms] ease-in-out",
        "motion-reduce:transition-none",
      )}
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center">
        <BreadcrumbList segments={segments} dirty={Boolean(tab?.isDirty)} />
      </nav>
      <div className="ml-auto flex items-center">
        {tab ? <SavedLabel lastSavedAt={tab.lastSavedAt} isDirty={Boolean(tab.isDirty)} /> : null}
      </div>
      <div
        aria-hidden="true"
        data-doc-head-reserved
        style={{ width: RESERVED_RIGHT_ZONE_WIDTH }}
        className="shrink-0"
      />
    </header>
  );
}

interface BreadcrumbListProps {
  segments: BreadcrumbSegment[];
  dirty: boolean;
}

function BreadcrumbList({ segments, dirty }: BreadcrumbListProps) {
  const items: ReactNode[] = [];
  segments.forEach((segment, idx) => {
    const isLast = idx === segments.length - 1;
    if (idx > 0) {
      items.push(<Separator key={`sep-${idx}`} />);
    }
    items.push(
      <Crumb
        key={`${segment.kind}-${idx}-${segment.label}`}
        segment={segment}
        isLast={isLast}
        dirty={dirty}
      />,
    );
  });
  return <ol className="flex min-w-0 items-center">{items}</ol>;
}

export default DocHead;
