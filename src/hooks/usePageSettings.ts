import { useMemo, useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorStore } from "@/stores/editor-store";
import {
  parsePageSettings,
  serializePageSettings,
  type DocumentPageSettings,
} from "@/lib/page-settings";

interface UsePageSettingsReturn {
  /** Current page settings (defaults if none in frontmatter). */
  settings: DocumentPageSettings;
  /** Update page settings — writes to frontmatter and marks tab dirty. */
  updateSettings: (newSettings: DocumentPageSettings) => void;
}

/**
 * Hook that reads/writes page header/footer settings from the active
 * document's YAML frontmatter `page` key.
 *
 * - `settings` is derived from the active tab's frontmatter
 * - `updateSettings` serializes the settings back into frontmatter and
 *   marks the tab dirty. The existing save pipeline picks up
 *   `tab.frontmatter` via `serializeFrontmatter(frontmatter, content)`
 *   so no additional save-path changes are needed.
 */
export function usePageSettings(editor: Editor | null): UsePageSettingsReturn {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTab = useEditorStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const frontmatter = activeTab?.frontmatter ?? null;

  const settings = useMemo(
    () => parsePageSettings(frontmatter),
    [frontmatter],
  );

  const updateSettings = useCallback(
    (newSettings: DocumentPageSettings) => {
      if (!editor || !activeTabId || !activeTab) return;

      const serializedPage = serializePageSettings(newSettings);

      // Build the updated frontmatter object
      const updatedFrontmatter = { ...(activeTab.frontmatter ?? {}) };
      if (serializedPage === undefined) {
        delete updatedFrontmatter.page;
      } else {
        updatedFrontmatter.page = serializedPage;
      }

      // Update frontmatter on the tab and mark dirty.
      // The save pipeline (useFileOperations.saveFile) reads tab.frontmatter
      // and calls serializeFrontmatter(frontmatter, content) to reconstruct
      // the full markdown — so we only need to update the frontmatter here.
      // Tab.content stores body-only markdown and must NOT include frontmatter.
      useEditorStore.getState().setFrontmatter(activeTabId, updatedFrontmatter);
    },
    [editor, activeTabId, activeTab],
  );

  return { settings, updateSettings };
}
