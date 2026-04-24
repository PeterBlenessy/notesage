import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { FileIcon } from "@/components/sidebar/FileIcon";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useTreeOverlayStore } from "@/stores/tree-overlay-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import type { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { SidebarRowIndicators } from "./SidebarRowIndicators";

/**
 * TreeOverlay — slide-in workspace-tree panel for the Quiet Composer UI
 * refresh (PRD `2026-04-21-ui-refresh`, task #38).
 *
 * Triggered globally via `⌘⇧E` (the QuietLayout mounts the shortcut).
 * Renders a `role="tree"` hierarchical view of every open project, with
 * caret-triangle expand/collapse, a search/filter input, and full keyboard
 * navigation (arrows, Home/End, Enter/Space, Esc). Focus is trapped inside
 * the overlay while open and restored to the previously focused element on
 * close, so the user never loses their place in the editor or sidebar.
 *
 * Scope constraint: only `workspace-store.projects` are rendered.
 * Explorer folders and the Notes tree are intentionally excluded for
 * Phase 1 — the overlay's role is to give a deep-dive view of the set of
 * projects the user has explicitly opened, not every directory the app
 * can see. Expand/collapse state is component-local and resets on each
 * open, matching the "fresh browsing session" intent.
 */

/**
 * A flattened tree node used for keyboard navigation. `visible` nodes are
 * those whose ancestors are all expanded (plus the roots themselves); we
 * derive this list on every render from the projects + expansion state.
 */
interface VisibleNode {
  path: string;
  name: string;
  depth: number;
  isDirectory: boolean;
  /** True when this node has at least one child after filter is applied. */
  hasChildren: boolean;
  /** Absolute path of the parent node, or null for roots. */
  parentPath: string | null;
  /** Ordered list of children paths that are visible (used by ArrowRight). */
  childPaths: string[];
}

/**
 * Case-insensitive substring matcher — used to decide whether a node (or any
 * of its descendants) matches the filter query. An empty query matches
 * everything.
 */
function matchesQuery(name: string, query: string): boolean {
  if (!query) return true;
  return name.toLowerCase().includes(query.toLowerCase());
}

/**
 * Recursively walks `entries` and returns an array that preserves only the
 * branches containing at least one match for `query`. A matching descendant
 * keeps all its ancestors visible so the user can see where the match lives.
 */
function filterTree(entries: FileEntry[], query: string): FileEntry[] {
  if (!query) return entries;
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.is_directory) {
      const filteredChildren = filterTree(entry.children ?? [], query);
      if (filteredChildren.length > 0 || matchesQuery(entry.name, query)) {
        result.push({ ...entry, children: filteredChildren });
      }
    } else if (matchesQuery(entry.name, query)) {
      result.push(entry);
    }
  }
  return result;
}

/**
 * Builds the flattened list of visible nodes for keyboard nav. Walks the
 * forest depth-first, honouring the `expanded` set for directories. Files
 * and collapsed directories are emitted but their children are not. The
 * returned order matches top-to-bottom visual order.
 */
function flattenVisible(
  entries: FileEntry[],
  depth: number,
  parentPath: string | null,
  expanded: Set<string>,
  acc: VisibleNode[],
): VisibleNode[] {
  for (const entry of entries) {
    const children = entry.children ?? [];
    const hasChildren = entry.is_directory && children.length > 0;
    const childPaths: string[] = [];
    const node: VisibleNode = {
      path: entry.path,
      name: entry.name,
      depth,
      isDirectory: entry.is_directory,
      hasChildren,
      parentPath,
      childPaths,
    };
    acc.push(node);
    if (hasChildren && expanded.has(entry.path)) {
      const startIndex = acc.length;
      flattenVisible(children, depth + 1, entry.path, expanded, acc);
      // Collect immediate children only (depth === node.depth + 1).
      for (let i = startIndex; i < acc.length; i += 1) {
        const maybeChild = acc[i]!;
        if (maybeChild.depth === depth + 1 && maybeChild.parentPath === entry.path) {
          childPaths.push(maybeChild.path);
        }
      }
    }
  }
  return acc;
}

interface TreeNodeRowProps {
  node: VisibleNode;
  expanded: boolean;
  isFocused: boolean;
  isActive: boolean;
  onToggle: (path: string) => void;
  onOpen: (path: string, name: string) => void;
  onFocus: (path: string) => void;
}

function TreeNodeRow({
  node,
  expanded,
  isFocused,
  isActive,
  onToggle,
  onOpen,
  onFocus,
}: TreeNodeRowProps) {
  const handleClick = () => {
    onFocus(node.path);
    if (node.isDirectory) {
      onToggle(node.path);
    } else {
      onOpen(node.path, node.name);
    }
  };

  const ariaExpanded = node.isDirectory
    ? node.hasChildren
      ? expanded
      : false
    : undefined;

  return (
    <div
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={ariaExpanded}
      aria-selected={isActive || undefined}
      data-tree-node
      data-tree-path={node.path}
      data-focused={isFocused ? "true" : undefined}
      tabIndex={isFocused ? 0 : -1}
      onClick={handleClick}
      onMouseDown={(event) => {
        // Prevent the outer overlay click from stealing focus away from the
        // tree item before our onClick handler runs.
        event.preventDefault();
      }}
      onFocus={() => onFocus(node.path)}
      style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
      className={cn(
        "h-7 pr-2 flex items-center gap-1 rounded-sm cursor-pointer text-sm",
        "text-foreground/90 transition-colors duration-150",
        "hover:bg-muted/50",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/40",
        isActive && "bg-muted",
        isFocused && "bg-muted/70",
      )}
    >
      {node.isDirectory ? (
        node.hasChildren ? (
          expanded ? (
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          )
        ) : (
          <span className="inline-block w-3.5 shrink-0" aria-hidden="true" />
        )
      ) : (
        <span className="inline-block w-3.5 shrink-0" aria-hidden="true" />
      )}
      {node.isDirectory ? (
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 rounded-[2px] bg-muted-foreground/15"
          aria-hidden="true"
        />
      ) : (
        <FileIcon fileName={node.name} />
      )}
      <span className="truncate min-w-0 flex-1">{node.name}</span>
      {/* #129 — git status + external-change dot. The overlay renders
         *  project-owned subtrees, so `kind` flips based on node type
         *  (projects vs. files vs. folders). Projects only show up as
         *  top-level nodes here; child rows are file / folder. */}
      <SidebarRowIndicators
        path={node.path}
        kind={node.isDirectory ? "folder" : "file"}
      />
    </div>
  );
}

export function TreeOverlay() {
  const open = useTreeOverlayStore((s) => s.open);
  const focusedPath = useTreeOverlayStore((s) => s.focusedPath);
  const closeOverlay = useTreeOverlayStore((s) => s.closeOverlay);

  const projects = useWorkspaceStore((s) => s.projects);
  const activeTabPath = useEditorStore((s) => {
    const id = s.activeTabId;
    if (!id) return null;
    return s.openDocuments.find((t) => t.id === id)?.filePath ?? null;
  });

  const { openFile } = useFileOperations();

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusedNodePath, setFocusedNodePath] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset local state every time the overlay is (re-)opened so each open is a
  // fresh browsing session. Also stash the previously-focused element so we
  // can restore focus on close.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    setQuery("");
    // Expand all project roots so top-level structure is visible immediately.
    const initial = new Set<string>();
    for (const project of projects) {
      initial.add(project.path);
    }
    // If the caller requested a focused path, expand its ancestors.
    if (focusedPath) {
      for (const project of projects) {
        if (
          focusedPath === project.path ||
          focusedPath.startsWith(project.path + "/")
        ) {
          let remaining = focusedPath.slice(project.path.length);
          let cursor = project.path;
          initial.add(cursor);
          while (remaining.startsWith("/")) {
            remaining = remaining.slice(1);
            const slashIdx = remaining.indexOf("/");
            if (slashIdx === -1) break;
            cursor = cursor + "/" + remaining.slice(0, slashIdx);
            initial.add(cursor);
            remaining = remaining.slice(slashIdx);
          }
        }
      }
    }
    setExpanded(initial);
    setFocusedNodePath(focusedPath ?? null);
    // Focus the search input on open; schedule after the slide-in paint so
    // the element is in the DOM before `focus()` runs.
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [open, projects, focusedPath]);

  // Restore focus to the element that owned it before the overlay opened.
  useEffect(() => {
    if (open) return;
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    if (prev && typeof prev.focus === "function") {
      // Delay one tick so React has finished unmounting / re-rendering.
      const id = requestAnimationFrame(() => {
        prev.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // ------------------------------------------------------------------
  // Derived: filtered trees + flattened visible list + quick lookups
  // ------------------------------------------------------------------

  const filteredProjects = useMemo(() => {
    return projects.map((project) => ({
      ...project,
      fileTree: filterTree(project.fileTree, query.trim()),
    }));
  }, [projects, query]);

  const rootEntries = useMemo<FileEntry[]>(() => {
    // Each project renders as a synthetic root directory whose children are
    // the project's filtered top-level entries. This makes the tree a single
    // forest rather than a soup of disconnected files. When a filter is
    // active, we drop projects whose filtered tree is empty and whose name
    // doesn't itself match — a project with zero matches is just noise.
    const q = query.trim();
    return filteredProjects
      .filter((project) => {
        if (!q) return true;
        const name = project.path.split("/").pop() ?? project.path;
        return project.fileTree.length > 0 || matchesQuery(name, q);
      })
      .map((project) => ({
        name: project.path.split("/").pop() ?? project.path,
        path: project.path,
        is_directory: true,
        children: project.fileTree,
        hidden: false,
      }));
  }, [filteredProjects, query]);

  // When a filter is active, every surviving directory is implicitly
  // expanded so the match is visible without the user having to click a
  // caret. Collect an effective expansion set that adds every directory
  // path from the filtered forest on top of the user's explicit state.
  const effectiveExpanded = useMemo(() => {
    if (!query.trim()) return expanded;
    const next = new Set(expanded);
    const walk = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (entry.is_directory) {
          next.add(entry.path);
          walk(entry.children ?? []);
        }
      }
    };
    walk(rootEntries);
    return next;
  }, [expanded, query, rootEntries]);

  const visibleNodes = useMemo(
    () => flattenVisible(rootEntries, 0, null, effectiveExpanded, []),
    [rootEntries, effectiveExpanded],
  );

  const nodeByPath = useMemo(() => {
    const map = new Map<string, VisibleNode>();
    for (const node of visibleNodes) map.set(node.path, node);
    return map;
  }, [visibleNodes]);

  // Keep the focused node valid: if the current focus disappears (filter
  // hides it, or it gets collapsed away) fall back to the first visible.
  useEffect(() => {
    if (!open) return;
    if (focusedNodePath && nodeByPath.has(focusedNodePath)) return;
    setFocusedNodePath(visibleNodes[0]?.path ?? null);
  }, [open, focusedNodePath, nodeByPath, visibleNodes]);

  // ------------------------------------------------------------------
  // Imperative handlers (toggle / open / focus)
  // ------------------------------------------------------------------

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleOpenFile = useCallback(
    async (path: string, name: string) => {
      try {
        await openFile(path, name);
        closeOverlay();
      } catch (error) {
        toast.error(`Failed to open file: ${String(error)}`);
      }
    },
    [openFile, closeOverlay],
  );

  const focusNode = useCallback((path: string) => {
    setFocusedNodePath(path);
    // Move DOM focus to the focused row so screen readers announce it. Use
    // an attribute scan rather than a `CSS.escape` selector because
    // (a) the path can contain quotes / backslashes that are painful to
    // escape safely, and (b) `CSS.escape` is not universally available in
    // jsdom test environments.
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;
    const nodes = overlayEl.querySelectorAll<HTMLElement>("[data-tree-node]");
    for (const candidate of nodes) {
      if (candidate.getAttribute("data-tree-path") === path) {
        candidate.focus({ preventScroll: false });
        break;
      }
    }
  }, []);

  // ------------------------------------------------------------------
  // Keyboard navigation (at the overlay root; individual rows don't bind)
  // ------------------------------------------------------------------

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      closeOverlay();
      return;
    }

    // Focus trap: Tab / Shift+Tab cycle within the overlay only. Keeps
    // keyboard focus from escaping into the editor, sidebar, or chat
    // panel behind us while the overlay is open.
    if (event.key === "Tab") {
      const overlayEl = overlayRef.current;
      if (!overlayEl) return;
      // In DOM order: search input first, then the currently-focused tree
      // row (only one treeitem has tabIndex={0} at a time). Any stray
      // focusable element that gets added later (buttons, links, etc.)
      // is picked up automatically.
      const focusables = Array.from(
        overlayEl.querySelectorAll<HTMLElement>(
          'input, button, a[href], [role="treeitem"][tabindex="0"], [tabindex="0"]',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        // Shift+Tab on the first focusable wraps to the last.
        if (active === first || !overlayEl.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab on the last focusable wraps to the first.
        if (active === last || !overlayEl.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }

    // If the search input has focus and the user presses ArrowDown, move
    // focus to the first tree node so they can navigate without reaching
    // for the mouse.
    const target = event.target as HTMLElement | null;
    const isInSearchInput = target === searchInputRef.current;

    if (isInSearchInput && event.key === "ArrowDown") {
      event.preventDefault();
      const first = visibleNodes[0];
      if (first) focusNode(first.path);
      return;
    }

    // Tree-level keyboard shortcuts: only fire when a tree item is focused.
    if (!focusedNodePath) return;
    if (isInSearchInput) return;

    const node = nodeByPath.get(focusedNodePath);
    if (!node) return;

    const index = visibleNodes.findIndex((n) => n.path === focusedNodePath);

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const next = visibleNodes[index + 1];
        if (next) focusNode(next.path);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const prev = visibleNodes[index - 1];
        if (prev) focusNode(prev.path);
        // ArrowUp on the first node — bounce back to search input.
        if (!prev) {
          searchInputRef.current?.focus();
        }
        break;
      }
      case "ArrowRight": {
        event.preventDefault();
        if (node.isDirectory && node.hasChildren) {
          if (!effectiveExpanded.has(node.path)) {
            toggleExpanded(node.path);
          } else {
            // Already expanded — move to first child.
            const firstChildPath = node.childPaths[0];
            if (firstChildPath) focusNode(firstChildPath);
          }
        }
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();
        if (node.isDirectory && effectiveExpanded.has(node.path)) {
          toggleExpanded(node.path);
        } else if (node.parentPath) {
          focusNode(node.parentPath);
        }
        break;
      }
      case "Home": {
        event.preventDefault();
        const first = visibleNodes[0];
        if (first) focusNode(first.path);
        break;
      }
      case "End": {
        event.preventDefault();
        const last = visibleNodes[visibleNodes.length - 1];
        if (last) focusNode(last.path);
        break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        if (node.isDirectory) {
          toggleExpanded(node.path);
        } else {
          void handleOpenFile(node.path, node.name);
        }
        break;
      }
    }
  };

  if (!open) return null;

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      ref={overlayRef}
      data-tree-overlay
      role="dialog"
      aria-modal="true"
      aria-label="Workspace tree"
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute left-0 top-0 bottom-0 z-40",
        "w-[320px] max-w-full flex flex-col min-h-0",
        "bg-background border-r border-border shadow-lg",
        "translate-x-0",
        !prefersReducedMotion && "transition-transform duration-200 ease-out",
      )}
    >
      <div className="shrink-0 px-2 py-2 border-b border-border">
        <Input
          ref={searchInputRef}
          type="text"
          role="searchbox"
          placeholder="Filter tree…"
          aria-label="Filter workspace tree"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {visibleNodes.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            {projects.length === 0 ? "No projects open" : "No matches"}
          </div>
        ) : (
          <div
            role="tree"
            aria-label="Workspace tree"
            className="flex flex-col"
          >
            {visibleNodes.map((node) => {
              const isActive =
                !!activeTabPath && activeTabPath === node.path;
              const isFocused = node.path === focusedNodePath;
              return (
                <TreeNodeRow
                  key={node.path}
                  node={node}
                  expanded={effectiveExpanded.has(node.path)}
                  isFocused={isFocused}
                  isActive={isActive}
                  onToggle={toggleExpanded}
                  onOpen={(path, name) => void handleOpenFile(path, name)}
                  onFocus={focusNode}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
