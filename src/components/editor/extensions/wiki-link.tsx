/**
 * WikiLink — `[[` authoring affordance (OKF wiki-navigation, tasks #11–#12).
 *
 * Modelled on `MentionSuggestion` / `TagSuggestion`. Typing `[[` opens a
 * workspace-global autocomplete backed by `resolve_wikilink` (filename + title
 * match). Picking a target — or confirming a name with no match — inserts a
 * STANDARD relative-path Link mark, never a new node type. There is no `[[ ]]`
 * in the document model, so markdown serialization is unchanged and the
 * round-trip stays clean (ADR 0001).
 *
 *  - Resolved pick   → `[Title](./relative/path.md)`  (ADR 0001/0002)
 *  - Dangling confirm → `[Name](./name-slug.md)` in the CURRENT dir (ADR 0007)
 *
 * A companion decoration plugin styles internal links whose target does not
 * resolve as "unresolved" (dashed/muted, see editor.css). Decorations do not
 * serialize, so this carries zero round-trip risk.
 */
import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import tippy, { type Instance } from "tippy.js";
import { listen } from "@tauri-apps/api/event";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { FileText, FilePlus2 } from "lucide-react";
import { tauriApi } from "@/lib/tauri";
import type { WikiTarget } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import {
  resolvedWikiLinkHref,
  danglingWikiLinkHref,
  isExternalUrl,
  OPENABLE_EXTENSIONS,
} from "@/lib/link-utils";

/** A suggestion-list row. `dangling` is the synthetic "create new" entry. */
interface WikiItem {
  /** Display title (filename without extension, or the user's typed name). */
  title: string;
  /** Absolute target path, or null for the dangling "create" entry. */
  path: string | null;
  doc_type: string | null;
  description: string | null;
  dangling: boolean;
}

interface WikiListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface WikiListProps {
  items: WikiItem[];
  command: (item: WikiItem) => void;
}

/** Directory of the active document (for relative-path resolution). */
function activeFileDir(): string | undefined {
  const { openDocuments, activeTabId } = useEditorStore.getState();
  const tab = openDocuments.find((t) => t.id === activeTabId);
  if (!tab?.filePath) return undefined;
  const parts = tab.filePath.split("/");
  parts.pop();
  return parts.join("/");
}

const WikiList = forwardRef<WikiListRef, WikiListProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const setItemRef = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      itemRefs.current[index] = el;
    },
    []
  );

  const selectIndex = useCallback((next: number) => {
    flushSync(() => setSelectedIndex(next));
    itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
  }, []);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        selectIndex((selectedIndex + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        selectIndex((selectedIndex + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[selectedIndex];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="z-50 min-w-[220px] rounded-lg border border-border bg-popover p-1 shadow-lg">
        <div className="px-3 py-3 text-center text-sm text-muted-foreground">
          Keep typing to name a new document
        </div>
      </div>
    );
  }

  return (
    <div className="z-50 min-w-[240px] max-w-[360px] max-h-[280px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg thin-scrollbar">
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const Icon = item.dangling ? FilePlus2 : FileText;
        return (
          <button
            ref={setItemRef(index)}
            key={`${item.dangling ? "new" : item.path}-${index}`}
            onClick={() => command(item)}
            className={cn(
              "flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left",
              isSelected && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
            )}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <Icon
              className={cn(
                "mt-0.5 h-3.5 w-3.5 shrink-0",
                isSelected ? "text-[oklch(100%_0_0)]" : "text-muted-foreground"
              )}
              strokeWidth={1.5}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm text-foreground">
                  {item.dangling ? `Create "${item.title}"` : item.title}
                </span>
                {item.doc_type && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 py-px text-[10px] uppercase tracking-wide",
                      isSelected
                        ? "bg-[oklch(100%_0_0/0.2)] text-[oklch(100%_0_0)]"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {item.doc_type}
                  </span>
                )}
              </span>
              {item.description && !item.dangling && (
                <span
                  className={cn(
                    "block truncate text-xs",
                    isSelected ? "text-[oklch(100%_0_0/0.8)]" : "text-muted-foreground"
                  )}
                >
                  {item.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
});

WikiList.displayName = "WikiList";

/** Basename without extension — the default display text for a target. */
function targetTitle(t: WikiTarget): string {
  if (t.title && t.title.trim()) return t.title.trim();
  const base = t.path.split("/").pop() || t.path;
  return base.replace(/\.[^.]+$/, "");
}

/**
 * Insert a standard relative-path Link mark for the chosen wikilink target.
 * This replaces the `[[query` range with `[displayText](href)` in the document
 * model — no `[[ ]]` survives, so serialization is the existing Link path.
 */
function insertWikiLink(editor: Editor, range: Range, item: WikiItem): void {
  const dir = activeFileDir();
  const href = item.dangling
    ? danglingWikiLinkHref(item.title)
    : resolvedWikiLinkHref(item.path ?? "", dir);
  const text = item.title;

  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([
      {
        type: "text",
        marks: [{ type: "link", attrs: { href } }],
        text,
      },
      { type: "text", text: " " },
    ])
    .run();
}

// ---------------------------------------------------------------------------
// Unresolved-link decoration (#12)
//
// Async path-existence resolution of every internal link in the document,
// cached and debounced. Internal links whose target file does not exist get an
// `unresolved` class so the editor can style them distinctly (editor.css).
// Decorations never serialize → zero round-trip impact.
// ---------------------------------------------------------------------------

export const WikiLinkDecorationKey = new PluginKey<DecorationSet>("wikiLinkUnresolved");

/** Returns true when the href is an internal, openable, relative/local file link. */
function isInternalFileHref(href: string): boolean {
  if (isExternalUrl(href)) return false;
  return OPENABLE_EXTENSIONS.test(href);
}

interface LinkOccurrence {
  href: string;
  from: number;
  to: number;
}

/** Walk the doc collecting every link-marked text range and its href. */
function collectLinkOccurrences(doc: PMNode): LinkOccurrence[] {
  const out: LinkOccurrence[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const linkMark = node.marks.find((m) => m.type.name === "link");
    const href = linkMark?.attrs?.href;
    if (typeof href === "string" && isInternalFileHref(href)) {
      out.push({ href, from: pos, to: pos + node.nodeSize });
    }
  });
  return out;
}

/**
 * Resolve an internal href against the active doc dir (cached). Mirrors the
 * runtime resolution in `link-utils.handleLinkNavigation`, but only needs a
 * yes/no existence answer for styling.
 */
function resolveExistsCandidates(href: string, dir: string | undefined): string[] {
  if (href.startsWith("/") || href.startsWith("~")) return [href];
  const candidates: string[] = [];
  if (dir) {
    candidates.push(normalizeJoin(dir, href));
  }
  return candidates;
}

function normalizeJoin(dir: string, rel: string): string {
  const parts = `${dir}/${rel}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return (dir.startsWith("/") ? "/" : "") + resolved.join("/");
}

export const WikiLink = Extension.create({
  name: "wikiLink",

  addOptions() {
    return {
      suggestion: {
        char: "[[",
        pluginKey: new PluginKey("wikiLinkSuggestion"),
        // Titles can contain spaces (`[[Quarterly Plan]]`); the suggestion runs
        // until the next whitespace-bracket or end of text.
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state, range }: { state: unknown; range: Range }) => {
          const editorState = state as EditorState;
          const $from = editorState.doc.resolve(range.from);
          if ($from.parent.type.name === "codeBlock") return false;
          return true;
        },
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: WikiItem }) => {
          insertWikiLink(editor, range, props);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    let lastTxChangedDoc = false;

    const docChangeTracker = new Plugin({
      key: new PluginKey("wikiLinkSuggestionDocTracker"),
      state: {
        init() {
          return false;
        },
        apply(tr) {
          lastTxChangedDoc = tr.docChanged;
          return tr.docChanged;
        },
      },
    });

    // --- Unresolved-link decoration plugin ---------------------------------
    // Existence cache shared across recomputations. `undefined` = not yet known.
    const existsCache = new Map<string, boolean>();
    const view = { current: null as null | { dispatch: (tr: Transaction) => void; state: EditorState } };
    let resolveTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleResolve(occurrences: LinkOccurrence[]) {
      if (resolveTimer) clearTimeout(resolveTimer);
      resolveTimer = setTimeout(async () => {
        const dir = activeFileDir();
        const pending = Array.from(new Set(occurrences.map((o) => o.href))).filter(
          (h) => !existsCache.has(h)
        );
        if (pending.length === 0) return;
        let changed = false;
        for (const href of pending) {
          const candidates = resolveExistsCandidates(href, dir);
          let exists = false;
          for (const c of candidates) {
            try {
              if (await tauriApi.pathExists(c)) {
                exists = true;
                break;
              }
            } catch {
              // ignore — treat as unresolved
            }
          }
          // With no candidates (e.g. no active dir for a relative path) we
          // cannot prove non-existence, so default to "resolved" to avoid
          // false-flagging every link on an unsaved buffer.
          existsCache.set(href, candidates.length === 0 ? true : exists);
          changed = true;
        }
        if (changed && view.current) {
          // Empty no-op meta transaction to force a decoration recompute.
          const v = view.current;
          v.dispatch(v.state.tr.setMeta(WikiLinkDecorationKey, true));
        }
      }, 200);
    }

    function buildDecorations(state: EditorState): DecorationSet {
      const occurrences = collectLinkOccurrences(state.doc);
      const decorations: Decoration[] = [];
      let hasUnknown = false;
      for (const occ of occurrences) {
        const known = existsCache.get(occ.href);
        if (known === undefined) {
          hasUnknown = true;
          continue;
        }
        if (!known) {
          decorations.push(
            Decoration.inline(occ.from, occ.to, { class: "wikilink-unresolved" })
          );
        }
      }
      if (hasUnknown) scheduleResolve(occurrences);
      return DecorationSet.create(state.doc, decorations);
    }

    // When a dangling target is created (create-on-click, #12) or the backend
    // finishes reindexing `links.db`, the cached existence answer for the
    // affected href(s) is stale — the file now exists, so the link must stop
    // rendering as unresolved. We can't know which absolute path maps to which
    // cached href cheaply, so on either signal we drop the whole existence
    // cache and force a recompute; `scheduleResolve` re-resolves only the
    // hrefs still present in the doc (debounced), so the cost is bounded.
    function invalidateExistsCacheAndRecompute() {
      existsCache.clear();
      if (view.current) {
        const v = view.current;
        v.dispatch(v.state.tr.setMeta(WikiLinkDecorationKey, true));
      }
    }

    const decorationPlugin = new Plugin<DecorationSet>({
      key: WikiLinkDecorationKey,
      view: (editorView) => {
        view.current = editorView;
        const onCreated = () => invalidateExistsCacheAndRecompute();
        const onReindexed = () => invalidateExistsCacheAndRecompute();
        window.addEventListener("notesage:wikilink-created", onCreated);
        // Destroy-race guard (mirrors `useSandboxViolations`): `listen()`
        // resolves asynchronously, so an editor destroyed before resolution
        // must unlisten the late registration immediately — otherwise it
        // leaks and keeps dispatching into a detached view.
        let active = true;
        let unlistenReindex: (() => void) | undefined;
        void listen("links-reindexed", onReindexed).then((fn) => {
          if (active) unlistenReindex = fn;
          else fn(); // View already destroyed — clean up immediately
        });
        return {
          update: (v) => {
            view.current = v;
          },
          destroy: () => {
            active = false;
            if (resolveTimer) clearTimeout(resolveTimer);
            window.removeEventListener("notesage:wikilink-created", onCreated);
            unlistenReindex?.();
            view.current = null;
          },
        };
      },
      state: {
        init: (_config, state) => buildDecorations(state),
        apply: (tr, old, _oldState, newState) => {
          if (tr.docChanged || tr.getMeta(WikiLinkDecorationKey)) {
            return buildDecorations(newState);
          }
          return old.map(tr.mapping, tr.doc);
        },
      },
      props: {
        decorations(state) {
          return this.getState(state);
        },
      },
    });

    return [
      docChangeTracker,
      decorationPlugin,
      Suggestion<WikiItem>({
        editor: this.editor,
        ...this.options.suggestion,
        allow: ({ state, range, isActive }: { state: unknown; range: Range; isActive?: boolean }) => {
          if (!isActive && !lastTxChangedDoc) return false;
          const editorState = state as EditorState;
          const $from = editorState.doc.resolve(range.from);
          if ($from.parent.type.name === "codeBlock") return false;
          return true;
        },
        items: async ({ query }: { query: string }): Promise<WikiItem[]> => {
          const trimmed = query.trim();
          let targets: WikiTarget[] = [];
          if (trimmed.length > 0) {
            try {
              targets = await tauriApi.resolveWikilink(trimmed, 10);
            } catch {
              targets = [];
            }
          }
          const items: WikiItem[] = targets.map((t) => ({
            title: targetTitle(t),
            path: t.path,
            doc_type: t.doc_type,
            description: t.description,
            dangling: false,
          }));
          // Offer create-on-confirm for a non-empty query that doesn't exactly
          // match an existing target's title (ADR 0007).
          if (trimmed.length > 0) {
            const exact = items.some(
              (i) => i.title.toLowerCase() === trimmed.toLowerCase()
            );
            if (!exact) {
              items.push({
                title: trimmed,
                path: null,
                doc_type: null,
                description: null,
                dangling: true,
              });
            }
          }
          return items;
        },
        render: () => {
          let component: ReactRenderer<WikiListRef>;
          let popup: Instance[];

          return {
            onStart: (props: SuggestionProps<WikiItem>) => {
              component = new ReactRenderer(WikiList, {
                props,
                editor: props.editor,
              });
              if (!props.clientRect) return;
              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },
            onUpdate(props: SuggestionProps<WikiItem>) {
              component.updateProps(props);
              if (!props.clientRect) return;
              popup?.[0]?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },
            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === "Escape") return false;
              return component.ref?.onKeyDown(props) ?? false;
            },
            onExit() {
              if (popup?.[0] && !popup[0].state.isDestroyed) popup[0].destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
