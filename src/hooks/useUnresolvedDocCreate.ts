/**
 * useUnresolvedDocCreate — create-on-click for dangling wikilinks (OKF #12, ADR 0007).
 *
 * The `link-click` ProseMirror plugin dispatches a `notesage:create-unresolved-doc`
 * window event when a click lands on an internal link whose target file does not
 * exist. This hook (mounted in the editor, where `useFileOperations` is available)
 * listens for it and offers to create the document — reusing the existing
 * file-create path (`useFileOperations.createFile` → `tauriApi.createFile`),
 * never reimplementing creation — then opens the new file as a tab.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useEditorStore } from "@/stores/editor-store";
import { tryOpenFile } from "@/lib/link-utils";

interface CreateUnresolvedDocDetail {
  absPath: string;
  href: string;
}

export function useUnresolvedDocCreate(): void {
  const { createFile } = useFileOperations();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CreateUnresolvedDocDetail>).detail;
      if (!detail?.absPath) return;

      const { absPath } = detail;
      const fileName = absPath.split("/").pop() || absPath;
      const parts = absPath.split("/");
      parts.pop();
      const parentDir = parts.join("/");
      if (!parentDir) {
        toast.error("Cannot determine where to create the document");
        return;
      }

      toast(`"${fileName}" doesn't exist yet`, {
        id: `create-unresolved:${absPath}`,
        description: "Create it now?",
        action: {
          label: "Create",
          onClick: async () => {
            try {
              // Reuse the existing create path (tauriApi.createFile under the
              // hood) — refreshes the tree + git status, returns the new path.
              const created = await createFile(parentDir, fileName);
              // The target now exists — tell the wiki-link decoration to drop
              // its stale "unresolved" existence answer and re-resolve, so the
              // dangling link in the open doc re-renders as a normal resolved
              // link instead of staying dashed (#12, ADR 0007).
              window.dispatchEvent(new CustomEvent("notesage:wikilink-created"));
              const openTab = useEditorStore.getState().openTab;
              await tryOpenFile(created, openTab);
              toast.success(`Created ${fileName}`);
            } catch {
              toast.error(`Failed to create ${fileName}`);
            }
          },
        },
      });
    };

    window.addEventListener("notesage:create-unresolved-doc", handler);
    return () => window.removeEventListener("notesage:create-unresolved-doc", handler);
  }, [createFile]);
}
