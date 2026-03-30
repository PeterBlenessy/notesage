/**
 * ProseMirror plugin that intercepts clicks on links and navigates to internal
 * document links (opens them as tabs) or opens external URLs in the browser.
 * Also adds a right-click context menu with "Convert to preview card" option.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { handleLinkNavigation } from '@/lib/link-utils';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

const linkClickPluginKey = new PluginKey('linkClick');

/** Remove any existing link context menu from the DOM. */
function dismissLinkContextMenu() {
  document.querySelector('.link-context-menu')?.remove();
}

export const LinkClick = Extension.create({
  name: 'linkClick',

  addProseMirrorPlugins() {
    const extensionThis = this;

    return [
      new Plugin({
        key: linkClickPluginKey,
        props: {
          handleDOMEvents: {
            click(view, event) {
              dismissLinkContextMenu();

              // Only handle left clicks
              if (event.button !== 0) return false;

              // Walk up the DOM to find an <a> element
              const target = event.target as HTMLElement;
              const linkEl = target.closest('a');
              if (!linkEl) return false;

              // Must be inside the editor
              if (!view.dom.contains(linkEl)) return false;

              const href = linkEl.getAttribute('href');
              if (!href) return false;

              event.preventDefault();
              event.stopPropagation();

              // Get workspace context
              const { openTab, tabs, activeTabId } = useEditorStore.getState();
              const { projects, explorerFolders } = useWorkspaceStore.getState();

              const roots = [
                ...projects.map((p) => p.path),
                ...explorerFolders.map((f) => f.path),
              ];

              // Determine active file's directory for relative path resolution
              const activeTab = tabs.find((t) => t.id === activeTabId);
              let activeFileDir: string | undefined;
              if (activeTab?.filePath) {
                const parts = activeTab.filePath.split('/');
                parts.pop();
                activeFileDir = parts.join('/');
              }

              handleLinkNavigation(href, openTab, roots, activeFileDir);
              return true;
            },
            contextmenu(view, event) {
              const target = event.target as HTMLElement;
              const linkEl = target.closest('a');
              if (!linkEl) return false;
              if (!view.dom.contains(linkEl)) return false;

              const href = linkEl.getAttribute('href');
              if (!href) return false;

              // Only offer conversion for external URLs
              if (!href.startsWith('http://') && !href.startsWith('https://')) return false;

              event.preventDefault();

              dismissLinkContextMenu();

              // Create a minimal context menu
              const menu = document.createElement('div');
              menu.className = 'link-context-menu';
              menu.style.cssText = `
                position: fixed;
                left: ${event.clientX}px;
                top: ${event.clientY}px;
                z-index: 9999;
                background: var(--color-popover);
                color: var(--color-popover-foreground);
                border: 1px solid var(--color-border);
                border-radius: 8px;
                padding: 4px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.2);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                min-width: 200px;
              `;

              const item = document.createElement('div');
              item.textContent = 'Convert to preview card';
              item.style.cssText = `
                padding: 6px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                transition: background 150ms;
              `;
              item.addEventListener('mouseenter', () => {
                item.style.background = 'var(--color-accent)';
              });
              item.addEventListener('mouseleave', () => {
                item.style.background = 'transparent';
              });
              item.addEventListener('click', () => {
                dismissLinkContextMenu();

                // Find the link mark position in the document
                const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (!pos) return;

                const editor = extensionThis.editor;
                const { state } = editor;
                const $pos = state.doc.resolve(pos.pos);

                // Find the parent paragraph/block that contains this link
                const parentStart = $pos.start($pos.depth);
                const parentEnd = $pos.end($pos.depth);

                // Delete the parent block and insert link preview
                const { tr } = state;
                tr.replaceWith(parentStart - 1, parentEnd + 1, state.schema.nodes.linkPreview.create({ url: href }));
                view.dispatch(tr);
              });

              menu.appendChild(item);
              document.body.appendChild(menu);

              // Dismiss on click elsewhere or escape
              const dismiss = () => {
                dismissLinkContextMenu();
                document.removeEventListener('click', dismiss);
                document.removeEventListener('keydown', handleKey);
              };
              const handleKey = (e: KeyboardEvent) => {
                if (e.key === 'Escape') dismiss();
              };
              setTimeout(() => {
                document.addEventListener('click', dismiss);
                document.addEventListener('keydown', handleKey);
              }, 0);

              return true;
            },
          },
        },
      }),
    ];
  },
});
