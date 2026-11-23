import { useEffect } from "react";
import { toast } from "sonner";

/** How long a document must sit dirty and unchanged before it is saved. */
export const AUTO_SAVE_DELAY_MS = 1000;

interface AutoSaveTab {
  id: string;
  filePath: string;
  content: string;
  isDirty: boolean;
}

interface EditorAutoSaveOptions {
  activeTab: AutoSaveTab | null | undefined;
  saveFile: (filePath: string, content: string, tabId: string) => Promise<unknown>;
}

/**
 * Debounced auto-save for the active document.
 *
 * Every change to the active document (its content, its dirty flag, or which
 * document is active) restarts a one-second timer; when it fires and the
 * document is still dirty, it is saved. A failed save reports a toast and
 * leaves the dirty flag alone — `saveFile` only marks the document clean when
 * the write succeeds, so the next edit retries.
 *
 * Extracted verbatim from `Editor.tsx` (audit 2026-11-22, test coverage) so
 * the timing and the failure branch can be tested without mounting the editor.
 */
export function useEditorAutoSave({ activeTab, saveFile }: EditorAutoSaveOptions): void {
  useEffect(() => {
    const save = async () => {
      if (activeTab && activeTab.isDirty) {
        try {
          await saveFile(activeTab.filePath, activeTab.content, activeTab.id);
        } catch (error) {
          toast.error(`Auto-save failed: ${error}`);
        }
      }
    };

    const timeoutId = setTimeout(() => {
      if (activeTab && activeTab.isDirty) {
        save();
      }
    }, AUTO_SAVE_DELAY_MS);

    return () => clearTimeout(timeoutId);
  }, [activeTab?.content, activeTab?.isDirty, activeTab, saveFile]);
}
