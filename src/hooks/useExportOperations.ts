import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { tauriApi } from "@/lib/tauri";
import { getMarkdownFromEditor } from "@/lib/markdown";
import { serializeFrontmatter } from "@/lib/frontmatter";
import { presetsForBackend } from "@/lib/typography-presets";
import { generatePrintCSS } from "@/lib/print-css";
import { collectEmbeddedImages } from "@/lib/svg-to-png";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorStylesStore } from "@/stores/editor-styles-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
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

      // Resolve project root for image/drawing path resolution
      const projectRoot = useWorkspaceStore
        .getState()
        .projects.find((p) => activeTab.filePath.startsWith(p.path + "/"))?.path;

      // Read typography presets for export styling (PDF, DOCX, HTML)
      const typography = presetsForBackend(useEditorStylesStore.getState().presets);

      try {
        // Collect chart/drawing/mermaid SVGs from the DOM and rasterize to PNG
        // for DOCX/PPTX formats (which cannot embed SVG directly).
        const embeddedImages =
          options.format === "docx" || options.format === "pptx"
            ? await collectEmbeddedImages()
            : undefined;

        if (options.format === "docx") {
          // Generate DOCX via Tauri backend
          const docxBytes = await tauriApi.exportDocx({
            markdown,
            title,
            template: options.template,
            includeToc: options.includeToc,
            includePageNumbers: options.includePageNumbers,
            pageSize: options.pageSize,
            projectRoot: projectRoot ?? undefined,
            typography,
            embeddedImages:
              embeddedImages && embeddedImages.length > 0
                ? embeddedImages
                : undefined,
          });

          // Derive default save path from source file
          const defaultPath = activeTab.filePath.replace(/\.md$/i, ".docx");

          // Show native save dialog
          const savePath = await save({
            title: "Export Word Document",
            defaultPath,
            filters: [{ name: "Word Document", extensions: ["docx"] }],
          });

          if (!savePath) {
            setIsExporting(false);
            return;
          }

          // Write DOCX to disk
          await tauriApi.saveBinaryFile(savePath, docxBytes);

          // Persist last-used export settings
          const settings = useSettingsStore.getState();
          settings.setLastExportFormat("docx");
          settings.setLastExportTemplate(options.template);
          settings.setLastExportPageSize(options.pageSize);
          settings.setLastExportIncludeToC(options.includeToc);
          settings.setLastExportIncludePageNumbers(options.includePageNumbers);

          toast.success("Word document exported", {
            action: {
              label: "Reveal in Finder",
              onClick: () => tauriApi.revealInFinder(savePath),
            },
          });
        } else if (options.format === "pptx") {
          // Generate PPTX via Tauri backend
          const pptxBytes = await tauriApi.exportPptx({
            markdown,
            title,
            template: options.pptxTemplate,
            embeddedImages:
              embeddedImages && embeddedImages.length > 0
                ? embeddedImages
                : undefined,
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
          // Generate PDF via WebKit: render HTML then print to PDF
          const pageSizePoints: Record<string, { width: number; height: number }> = {
            a4: { width: 595.28, height: 841.89 },
            letter: { width: 612, height: 792 },
            a5: { width: 419.53, height: 595.28 },
          };
          const dims = pageSizePoints[options.pageSize] ?? pageSizePoints.a4;

          const rawHtml = await tauriApi.renderHtml({
            markdown,
            title,
            theme: "light",
            includeStyles: true,
            projectRoot: projectRoot ?? undefined,
            typography,
          });

          // Inject print-specific CSS for page layout, break control, and orphan/widow handling
          const printCss = generatePrintCSS({
            pageSize: options.pageSize,
            includePageNumbers: options.includePageNumbers,
          });
          const html = rawHtml.replace("</head>", `<style>${printCss}</style></head>`);

          const pdfBytes = await tauriApi.exportPdfWebkit({
            html,
            pageWidth: dims.width,
            pageHeight: dims.height,
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
