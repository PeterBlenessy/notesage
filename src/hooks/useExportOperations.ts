import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { tauriApi } from "@/lib/tauri";
import { getMarkdownFromEditor } from "@/lib/markdown";
import { serializeFrontmatter } from "@/lib/frontmatter";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ExportOptions } from "@/components/ExportDialog";

export function useExportOperations(editor: Editor | null) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(
    async (options: ExportOptions) => {
      if (!editor) return;

      const { tabs, activeTabId } = useEditorStore.getState();
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (!activeTab) return;

      // Derive title from filename (strip .md extension)
      const title = activeTab.fileName.replace(/\.md$/i, "");

      // Get full markdown including frontmatter
      const bodyMarkdown = getMarkdownFromEditor(editor);
      const markdown = serializeFrontmatter(
        activeTab.frontmatter,
        bodyMarkdown
      );

      setIsExporting(true);

      try {
        if (options.format === "pptx") {
          // Generate PPTX via Tauri backend
          const pptxBytes = await tauriApi.exportPptx({
            markdown,
            title,
            template: options.pptxTemplate,
          });

          // Derive default save path from source file
          const defaultPath = activeTab.filePath.replace(/\.md$/i, ".pptx");

          // Show native save dialog
          const savePath = await save({
            title: "Export PowerPoint",
            defaultPath,
            filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
          });

          if (!savePath) {
            setIsExporting(false);
            return;
          }

          // Write PPTX to disk
          await tauriApi.saveBinaryFile(savePath, pptxBytes);

          // Persist last-used export settings
          const settings = useSettingsStore.getState();
          settings.setLastExportFormat("pptx");
          settings.setLastPptxTemplate(options.pptxTemplate);

          toast.success("PowerPoint exported", {
            action: {
              label: "Reveal in Finder",
              onClick: () => tauriApi.revealInFinder(savePath),
            },
          });
        } else {
          // Generate PDF via Tauri backend
          const pdfBytes = await tauriApi.exportPdf({
            markdown,
            title,
            template: options.template,
            includeToc: options.includeToc,
            includePageNumbers: options.includePageNumbers,
            pageSize: options.pageSize,
          });

          // Derive default save path from source file
          const defaultPath = activeTab.filePath.replace(/\.md$/i, ".pdf");

          // Show native save dialog
          const savePath = await save({
            title: "Export PDF",
            defaultPath,
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });

          if (!savePath) {
            setIsExporting(false);
            return;
          }

          // Write PDF to disk
          await tauriApi.saveBinaryFile(savePath, pdfBytes);

          // Persist last-used export settings
          const settings = useSettingsStore.getState();
          settings.setLastExportFormat("pdf");
          settings.setLastExportTemplate(options.template);
          settings.setLastExportPageSize(options.pageSize);
          settings.setLastExportIncludeToC(options.includeToc);
          settings.setLastExportIncludePageNumbers(options.includePageNumbers);

          toast.success("PDF exported", {
            action: {
              label: "Reveal in Finder",
              onClick: () => tauriApi.revealInFinder(savePath),
            },
          });
        }
      } catch (error) {
        console.error("Export failed:", error);
        toast.error(`Export failed: ${error}`);
      } finally {
        setIsExporting(false);
      }
    },
    [editor]
  );

  return { exportPdf: handleExport, exportPptx: handleExport, isExporting };
}
