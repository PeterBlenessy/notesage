import { useEffect, useRef } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { handleLinkNavigation } from "@/lib/link-utils";

/**
 * Read-only HTML preview rendered from the comrak-produced body fragment.
 * Used by Phase 1 of the large-file instant-load pipeline as the surface
 * the user sees while the Tiptap editor hydrates in the background.
 *
 * Visual identity is the hard gate (PRD § "Layer 1 — Rust comrak HTML
 * preview"): the wrapper carries the same `.ProseMirror` class hierarchy
 * the live editor uses, so every selector in `editor.css` and every
 * typography CSS variable on the parent applies unchanged. The parent
 * (`Editor.tsx`) places this component inside the same scroll wrapper
 * the editor mounts into, so the swap when the editor takes over is just
 * a child swap inside the same scroll container.
 *
 * Known visual divergences vs. the live editor (acceptable for the brief
 * preview window — see PRD § "Fidelity gaps to manage"):
 *
 *   - `#tag`, `@mention`, `//YYYY-MM-DD` render as plain text instead of
 *     the editor's styled badge pills.
 *   - `excalidraw` and `chart` fenced code blocks render as syntax-highlighted
 *     code instead of their node-view renders.
 *   - Inline decorations (search highlights, comment marks, AI suggestions,
 *     inline diff) only exist after hydration.
 *
 * Filed in `e2e/preview-fidelity.spec.ts`'s mask allowlist.
 */
interface MarkdownPreviewProps {
  /** comrak-rendered body fragment. Trusted: comrak is configured without `unsafe_`, so raw HTML in markdown is escaped. */
  html: string;
}

export function MarkdownPreview({ html }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Click handler — route internal markdown links through the same resolver
  // the live editor uses (`extensions/link-click.ts` → `handleLinkNavigation`).
  // External URLs open in the system browser, internal markdown files open
  // as tabs. Modifier-clicks fall through to default browser behaviour.
  //
  // Cmd+F is intentionally NOT handled here. The preview is a brief window
  // (typically <5s) before the editor hydrates and the live FindBar takes
  // over. Native browser find doesn't reach Tauri WebView; rather than
  // wire a parallel DOM search just for the preview window we accept the
  // gap. Cmd+C works natively because the wrapper is text-selectable.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const onClick = (event: MouseEvent) => {
      // Only handle plain left clicks. Modifier-clicks fall through.
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = (event.target as HTMLElement | null)?.closest("a");
      if (!target || !node.contains(target)) return;
      const href = target.getAttribute("href");
      if (!href) return;

      event.preventDefault();
      event.stopPropagation();

      const { openTab, openDocuments, activeTabId } = useEditorStore.getState();
      const { projects, explorerFolders } = useWorkspaceStore.getState();
      const roots = [
        ...projects.map((p) => p.path),
        ...explorerFolders.map((f) => f.path),
      ];

      // Active-file directory for resolving relative paths — same logic as
      // link-click.ts so internal links behave identically in preview and
      // editor.
      const activeTab = openDocuments.find((t) => t.id === activeTabId);
      let activeFileDir: string | undefined;
      if (activeTab?.filePath) {
        const parts = activeTab.filePath.split("/");
        parts.pop();
        activeFileDir = parts.join("/");
      }

      void handleLinkNavigation(href, openTab, roots, activeFileDir);
    };

    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, []);

  return (
    <div
      ref={containerRef}
      // Match the class set by `useEditor.ts` editorProps.attributes so the
      // preview opts into the exact same selectors as the live editor view.
      // The `data-preview` attribute is reserved for any preview-only style
      // tweaks (e.g. cursor:text rule) without bleeding into editor styles.
      className="ProseMirror prose prose-slate dark:prose-invert max-w-none focus:outline-none"
      data-preview="true"
      // Comrak HTML is trusted (configured without `unsafe_` — raw HTML in
      // markdown is escaped). See `markdown_to_html.rs` test
      // `test_details_block_does_not_break_output`.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
