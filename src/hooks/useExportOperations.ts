import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { tauriApi } from "@/lib/tauri";
import { getMarkdownFromEditor } from "@/lib/markdown";
import { serializeFrontmatter } from "@/lib/frontmatter";
import { presetsForBackend } from "@/lib/typography-presets";
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
          // Print the document via macOS print dialog (Save as PDF).
          // Strategy: clone the editor's rendered DOM (includes charts,
          // drawings, mermaid as live SVG), collect page stylesheets,
          // build a standalone HTML doc, open in a hidden Tauri window,
          // call print() on it.

          const prosemirror = document.querySelector(".ProseMirror");
          if (!prosemirror) {
            toast.error("No document content to print");
            setIsExporting(false);
            return;
          }

          // Canvas-based oklch→hex converter (needed before cloning)
          const cvs = document.createElement("canvas");
          cvs.width = 1;
          cvs.height = 1;
          const cvsCtx = cvs.getContext("2d")!;
          const oklchToHex = (oklch: string): string => {
            cvsCtx.clearRect(0, 0, 1, 1);
            cvsCtx.fillStyle = "#000000";
            cvsCtx.fillStyle = oklch;
            cvsCtx.fillRect(0, 0, 1, 1);
            const [r, g, b] = cvsCtx.getImageData(0, 0, 1, 1).data;
            return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
          };

          // Resolve inline oklch() colors on the LIVE DOM before cloning.
          // Legend swatches use background-color: oklch(...). WebKit's
          // getComputedStyle returns oklch (not rgb), so use canvas to convert.
          const oklchOriginals: Array<{ el: HTMLElement; prop: string; val: string }> = [];
          prosemirror.querySelectorAll("[style]").forEach((rawEl) => {
            const el = rawEl as HTMLElement;
            for (const cssProp of ["background-color", "color", "border-color"]) {
              const val = el.style.getPropertyValue(cssProp);
              if (val && val.includes("oklch")) {
                oklchOriginals.push({ el, prop: cssProp, val });
                el.style.setProperty(cssProp, oklchToHex(val));
              }
            }
          });

          // Deep clone captures resolved oklch values
          const clone = prosemirror.cloneNode(true) as HTMLElement;
          clone.removeAttribute("contenteditable");

          // Restore original oklch values on the live DOM
          for (const { el, prop, val } of oklchOriginals) {
            el.style.setProperty(prop, val);
          }

          // Remove editor-only UI elements from the clone:
          // - Print Layout decorations (page headers, footers, page gaps)
          // - Interactive placeholders ("Click to add header")
          // - Resize handles, edit overlays, sort indicators
          for (const sel of [
            ".page-gap", // decorative gap between pages
            ".page-hf-editor", // inline editing UI for headers/footers
            ".page-hf-empty", // "Click to add header/footer" placeholders
            ".drawing-edit-overlay",
            ".table-sort-indicator", ".table-filter-row",
            ".cursor-ns-resize", // chart/drawing resize handles
          ]) {
            clone.querySelectorAll(sel).forEach((el) => el.remove());
          }
          // Remove contenteditable from all remaining elements
          clone.querySelectorAll("[contenteditable]").forEach((el) => {
            el.removeAttribute("contenteditable");
          });

          // Fix Recharts responsive containers: they use width:0;height:0 with
          // overflow:visible, relying on JS measurement that won't run in the
          // print window. Set explicit dimensions from the actual rendered charts.
          const liveWrappers = prosemirror.querySelectorAll(".recharts-wrapper");
          const cloneWrappers = clone.querySelectorAll(".recharts-wrapper");
          cloneWrappers.forEach((wrapper, i) => {
            const live = liveWrappers[i] as HTMLElement | undefined;
            if (live) {
              (wrapper as HTMLElement).style.width = `${live.offsetWidth}px`;
              (wrapper as HTMLElement).style.height = `${live.offsetHeight}px`;
            }
            // Also fix the parent zero-size div
            const parent = wrapper.parentElement;
            if (parent && parent.style.width === "0px") {
              parent.style.width = "100%";
              parent.style.height = "auto";
            }
          });

          // Collect all stylesheets from the current page
          const styles: string[] = [];
          for (const sheet of document.styleSheets) {
            try {
              for (const rule of sheet.cssRules) {
                styles.push(rule.cssText);
              }
            } catch {
              // Cross-origin sheets — skip
            }
          }

          // printHtml is built AFTER var() resolution (below)

          // Resolve var() references in the cloned body HTML.
          // Two issues to handle:
          // 1. WebKit returns oklch() from getComputedStyle — need canvas to convert to hex
          // 2. Multi-series chart variables are scoped to specific [data-chart] containers

          // Canvas-based oklch→hex converter
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          const toHex = (cssColor: string): string => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = "#000000"; // reset
            ctx.fillStyle = cssColor;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
          };

          // Build a resolver that probes ALL chart containers
          const probe = document.createElement("div");
          probe.style.position = "absolute";
          probe.style.left = "-9999px";
          const chartContainers = prosemirror.querySelectorAll("[data-chart]");
          const globalCache = new Map<string, string>();

          const resolveVar = (varName: string): string | null => {
            const cached = globalCache.get(varName);
            if (cached !== undefined) return cached === "" ? null : cached;

            // Try each chart container (multi-series vars are scoped)
            for (const container of chartContainers) {
              container.appendChild(probe);
              probe.style.backgroundColor = `var(--${varName})`;
              const raw = window.getComputedStyle(probe).backgroundColor;
              if (raw && raw !== "rgba(0, 0, 0, 0)" && raw !== "transparent") {
                const hex = toHex(raw);
                globalCache.set(varName, hex);
                probe.remove();
                return hex;
              }
            }
            // Try document root for global theme vars
            document.documentElement.appendChild(probe);
            probe.style.backgroundColor = `var(--${varName})`;
            const rootRaw = window.getComputedStyle(probe).backgroundColor;
            probe.remove();
            if (rootRaw && rootRaw !== "rgba(0, 0, 0, 0)" && rootRaw !== "transparent") {
              const hex = toHex(rootRaw);
              globalCache.set(varName, hex);
              return hex;
            }
            globalCache.set(varName, "");
            return null;
          };

          const bodyContent = clone.outerHTML;
          // Resolve CSS var() references
          const resolvedBody = bodyContent.replace(
            /var\(--([^)]+)\)/g,
            (match, varName: string) => resolveVar(varName) ?? match,
          );

          console.log(`[print] Resolved ${globalCache.size} CSS variables, ${[...globalCache.values()].filter(v => v).length} successful`);

          // Build the final HTML with resolved body content
          const finalHtml = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>${styles.join("\n")}</style>
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: white;
    color: black;
    overflow: auto;
    height: auto;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body > * {
    max-width: 720px;
    margin: 0 auto;
    padding: 24px 48px;
  }
  .chart-block, .drawing-node-view, .mermaid-block,
  .recharts-wrapper, .recharts-surface {
    max-width: 100% !important;
    width: 100% !important;
    height: auto !important;
  }
  .recharts-wrapper svg {
    max-width: 100% !important;
    height: auto !important;
  }
  img, svg {
    max-width: 100% !important;
    height: auto !important;
  }
  @page { size: ${options.pageSize === "letter" ? "letter" : options.pageSize === "a5" ? "A5" : "A4"}; margin: 1in; }
  pre, table, .chart-block, .drawing-node-view, .mermaid-block, blockquote {
    break-inside: avoid;
  }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
  p { orphans: 3; widows: 3; }
</style>
</head><body>${resolvedBody}</body></html>`;

          // Send to Rust to open in window and print
          await tauriApi.exportPdfWebkit({
            html: finalHtml,
            title,
            pageWidth: 0,
            pageHeight: 0,
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
