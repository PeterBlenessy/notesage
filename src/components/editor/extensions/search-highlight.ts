import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";

export const SearchPluginKey = new PluginKey("searchHighlight");

interface SearchState {
  query: string;
  matches: { from: number; to: number }[];
  currentIndex: number;
}

const EMPTY_STATE: SearchState = { query: "", matches: [], currentIndex: -1 };

function findMatches(doc: PMNode, query: string): { from: number; to: number }[] {
  if (!query) return [];

  const matches: { from: number; to: number }[] = [];
  const lowerQuery = query.toLowerCase();

  doc.descendants((node, pos) => {
    // Skip code blocks
    if (node.type.name === "codeBlock") return false;

    if (!node.isText || !node.text) return;

    const lowerText = node.text.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < lowerText.length) {
      const idx = lowerText.indexOf(lowerQuery, searchFrom);
      if (idx === -1) break;
      matches.push({ from: pos + idx, to: pos + idx + query.length });
      searchFrom = idx + 1;
    }
  });

  return matches;
}

function buildDecorations(
  doc: PMNode,
  state: SearchState
): DecorationSet {
  if (!state.query || state.matches.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  for (let i = 0; i < state.matches.length; i++) {
    const match = state.matches[i];
    const isActive = i === state.currentIndex;
    decorations.push(
      Decoration.inline(match.from, match.to, {
        class: isActive ? "find-match find-match-active" : "find-match",
      })
    );
  }

  return DecorationSet.create(doc, decorations);
}

function scrollToMatch(view: EditorView, match: { from: number; to: number }) {
  try {
    const domAtPos = view.domAtPos(match.from);
    const node =
      domAtPos.node instanceof HTMLElement
        ? domAtPos.node
        : domAtPos.node.parentElement;
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    // Position may be invalid
  }
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: SearchPluginKey,
        state: {
          init(): { search: SearchState; decorations: DecorationSet } {
            return { search: EMPTY_STATE, decorations: DecorationSet.empty };
          },
          apply(
            tr: Transaction,
            value: { search: SearchState; decorations: DecorationSet }
          ) {
            const meta = tr.getMeta(SearchPluginKey);

            if (meta?.clear) {
              return {
                search: EMPTY_STATE,
                decorations: DecorationSet.empty,
              };
            }

            if (meta?.setQuery !== undefined) {
              const query = meta.setQuery as string;
              const matches = findMatches(tr.doc, query);
              const currentIndex = matches.length > 0 ? 0 : -1;
              const search = { query, matches, currentIndex };
              return {
                search,
                decorations: buildDecorations(tr.doc, search),
              };
            }

            if (meta?.setIndex !== undefined) {
              const search = {
                ...value.search,
                currentIndex: meta.setIndex as number,
              };
              return {
                search,
                decorations: buildDecorations(tr.doc, search),
              };
            }

            // If document changed, re-run matches with the current query
            if (tr.docChanged && value.search.query) {
              const matches = findMatches(tr.doc, value.search.query);
              // Try to keep currentIndex valid
              let currentIndex = value.search.currentIndex;
              if (currentIndex >= matches.length) {
                currentIndex = matches.length > 0 ? 0 : -1;
              }
              const search = { ...value.search, matches, currentIndex };
              return {
                search,
                decorations: buildDecorations(tr.doc, search),
              };
            }

            return value;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export function setSearchQuery(editor: Editor, query: string): void {
  const { tr } = editor.state;
  tr.setMeta(SearchPluginKey, { setQuery: query });
  editor.view.dispatch(tr);

  // Scroll to first match
  const state = getSearchState(editor);
  if (state && state.matchCount > 0) {
    const pluginState = SearchPluginKey.getState(editor.state);
    if (pluginState) {
      scrollToMatch(editor.view, pluginState.search.matches[0]);
    }
  }
}

export function searchNext(editor: Editor): void {
  const pluginState = SearchPluginKey.getState(editor.state);
  if (!pluginState || pluginState.search.matches.length === 0) return;

  const { matches, currentIndex } = pluginState.search;
  const nextIndex = (currentIndex + 1) % matches.length;

  const { tr } = editor.state;
  tr.setMeta(SearchPluginKey, { setIndex: nextIndex });
  editor.view.dispatch(tr);

  scrollToMatch(editor.view, matches[nextIndex]);
}

export function searchPrevious(editor: Editor): void {
  const pluginState = SearchPluginKey.getState(editor.state);
  if (!pluginState || pluginState.search.matches.length === 0) return;

  const { matches, currentIndex } = pluginState.search;
  const prevIndex =
    currentIndex <= 0 ? matches.length - 1 : currentIndex - 1;

  const { tr } = editor.state;
  tr.setMeta(SearchPluginKey, { setIndex: prevIndex });
  editor.view.dispatch(tr);

  scrollToMatch(editor.view, matches[prevIndex]);
}

export function clearSearch(editor: Editor): void {
  const { tr } = editor.state;
  tr.setMeta(SearchPluginKey, { clear: true });
  editor.view.dispatch(tr);
}

export function replaceCurrentMatch(
  editor: Editor,
  replacement: string
): void {
  const pluginState = SearchPluginKey.getState(editor.state);
  if (!pluginState || pluginState.search.currentIndex < 0) return;

  const { matches, currentIndex } = pluginState.search;
  const match = matches[currentIndex];

  // Replace the text at the current match position
  editor.view.dispatch(
    editor.state.tr.replaceWith(
      match.from,
      match.to,
      editor.state.schema.text(replacement)
    )
  );

  // After replacing, the plugin auto-rebuilds matches from docChanged.
  // Scroll to the next match if available.
  requestAnimationFrame(() => {
    const newPluginState = SearchPluginKey.getState(editor.state);
    if (newPluginState && newPluginState.search.matches.length > 0) {
      const newIndex = newPluginState.search.currentIndex;
      if (newIndex >= 0) {
        scrollToMatch(
          editor.view,
          newPluginState.search.matches[newIndex]
        );
      }
    }
  });
}

export function replaceAllMatches(
  editor: Editor,
  replacement: string
): void {
  const pluginState = SearchPluginKey.getState(editor.state);
  if (!pluginState || pluginState.search.matches.length === 0) return;

  const { matches } = pluginState.search;

  // Replace in reverse order to preserve positions
  let tr = editor.state.tr;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    tr = tr.replaceWith(
      match.from,
      match.to,
      editor.state.schema.text(replacement)
    );
  }

  editor.view.dispatch(tr);
}

export function getSearchState(
  editor: Editor
): { matchCount: number; currentIndex: number } | null {
  const pluginState = SearchPluginKey.getState(editor.state);
  if (!pluginState) return null;
  return {
    matchCount: pluginState.search.matches.length,
    currentIndex: pluginState.search.currentIndex,
  };
}
