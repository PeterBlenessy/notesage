/**
 * ProseMirror plugin that intercepts clicks on links and navigates to internal
 * document links (opens them as tabs) or opens external URLs in the browser.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { handleLinkNavigation } from '@/lib/link-utils';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

const linkClickPluginKey = new PluginKey('linkClick');

export const LinkClick = Extension.create({
  name: 'linkClick',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: linkClickPluginKey,
        props: {
          handleDOMEvents: {
            click(view, event) {
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
          },
        },
      }),
    ];
  },
});
