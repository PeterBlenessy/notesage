import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/core";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { tauriApi } from "@/lib/tauri";
import { getMarkdownFromEditor } from "@/lib/markdown";
import { serializeFrontmatter } from "@/lib/frontmatter";
import { presetsForBackend } from "@/lib/typography-presets";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorStylesStore } from "@/stores/editor-styles-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ExportOptions } from "@/components/ExportDialog";
import type { ChartData, ColorScheme } from "@/lib/chart-types";
import { COLOR_PALETTES } from "@/lib/chart-types";
import { track, type ExportTemplate } from "@/lib/telemetry";

/**
 * Collect SVG strings for all inline chart and drawing nodes in document order.
 * Charts: capture rendered SVG from the DOM, then replace CSS variable
 *         references with hex colors computed from the chart's data.
 * Drawings: call Excalidraw's exportToSvg() with the inline JSON.
 * Mermaid: capture rendered SVG from the DOM.
 * Returns an ordered array matching the positional order that comrak will walk.
 */
export async function collectEmbeddedSvgs(editor: Editor): Promise<string[]> {
  const svgs: string[] = [];
  const promises: { index: number; promise: Promise<string> }[] = [];
  let chartIndex = 0;
  let mermaidIndex = 0;

  editor.state.doc.descendants((node) => {
    if (node.type.name === "chart" && node.attrs.chartJson) {
      const idx = svgs.length;
      svgs.push(""); // placeholder

      // Capture SVG from the DOM
      const chartWrappers = document.querySelectorAll(
        ".chart-block .recharts-wrapper svg"
      );
      const svgEl = chartWrappers[chartIndex] as SVGSVGElement | undefined;
      chartIndex++;
      if (svgEl) {
        const rawSvg = new XMLSerializer().serializeToString(svgEl);
        const chartJson = node.attrs.chartJson as string;
        svgs[idx] = resolveChartColors(rawSvg, chartJson);
      }
    } else if (node.type.name === "drawing" && node.attrs.drawingJson) {
      const idx = svgs.length;
      svgs.push(""); // placeholder
      const json = node.attrs.drawingJson as string;

      promises.push({
        index: idx,
        promise: renderDrawingSvg(json),
      });
    } else if (node.type.name === "mermaidBlock" && node.attrs.source) {
      const idx = svgs.length;
      svgs.push(""); // placeholder

      // Capture rendered mermaid SVG from the DOM
      const mermaidContainers = document.querySelectorAll(
        ".mermaid-block .mermaid-svg-container svg"
      );
      const svgEl = mermaidContainers[mermaidIndex] as SVGSVGElement | undefined;
      mermaidIndex++;
      if (svgEl) {
        svgs[idx] = new XMLSerializer().serializeToString(svgEl);
      }
    }
    return false; // don't descend into atom nodes
  });

  // Resolve all async drawing SVG renders
  const results = await Promise.all(promises.map((p) => p.promise));
  for (let i = 0; i < promises.length; i++) {
    svgs[promises[i].index] = results[i];
  }

  return svgs;
}

// ── oklch → hex conversion (pure math, no DOM) ──────────────────────

/** Convert oklch(L% C H) string to #rrggbb hex. */
function oklchToHex(oklch: string): string {
  const m = oklch.match(/oklch\(([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\)/);
  if (!m) return "#000000";
  let L = parseFloat(m[1]);
  if (L > 1) L /= 100; // handle "45%" as 0.45
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]) * (Math.PI / 180);

  // oklch → oklab
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);

  // oklab → linear sRGB
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  let r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  let bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  // linear sRGB → sRGB gamma
  const gamma = (x: number) => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  r = Math.round(Math.max(0, Math.min(1, gamma(r))) * 255);
  g = Math.round(Math.max(0, Math.min(1, gamma(g))) * 255);
  bl = Math.round(Math.max(0, Math.min(1, gamma(bl))) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

// ── Chart color resolution (pure data, no DOM/CSS) ──────────────────

/** Theme CSS variables and their hex values for export (light mode). */
const THEME_COLORS: Record<string, string> = {
  "color-border": "#e5e5e5",
  "color-muted-foreground": "#737373",
  "color-background": "#ffffff",
  "color-muted": "#f5f5f5",
};

/**
 * Replace all var(--color-xxx) references in a chart SVG with hex colors.
 * Reads the chart JSON to determine the color scheme and series keys,
 * then looks up oklch palette values and converts to hex.
 * No DOM, no CSS, no WebKit — pure data transformation.
 */
export function resolveChartColors(svgString: string, chartJson: string): string {
  // Parse the chart data to get colorScheme and series keys
  let chartData: ChartData | null = null;
  try {
    chartData = JSON.parse(chartJson) as ChartData;
  } catch {
    return svgString;
  }

  const scheme = chartData.config?.colorScheme ?? "neutral";
  const palette = COLOR_PALETTES[scheme as ColorScheme] ?? COLOR_PALETTES.neutral;
  const lightColors = palette.light;

  // Build a map of CSS variable name → hex color
  const colorMap = new Map<string, string>();

  // Theme variables (fixed)
  for (const [name, hex] of Object.entries(THEME_COLORS)) {
    colorMap.set(name, hex);
  }

  // Series-specific variables
  const seriesKeys = chartData.series?.map((s) => s.key) ?? [];
  if (seriesKeys.length > 0) {
    seriesKeys.forEach((key, i) => {
      colorMap.set(`color-${key}`, oklchToHex(lightColors[i % lightColors.length]));
    });
  } else {
    // Single-series: "value" key + per-category keys (for pie/donut)
    colorMap.set("color-value", oklchToHex(lightColors[0]));
    chartData.data?.forEach((point, i) => {
      colorMap.set(
        `color-${point.category}`,
        oklchToHex(lightColors[i % lightColors.length]),
      );
    });
  }

  // Build dark→light oklch mapping for inline color replacement (pie/donut/radial)
  // These charts bake oklch values directly into fill attributes at render time.
  // In dark mode the values are from palette.dark — we remap to palette.light for PDF.
  const darkToLightHex = new Map<string, string>();
  const darkColors = palette.dark;
  for (let i = 0; i < darkColors.length; i++) {
    darkToLightHex.set(darkColors[i], oklchToHex(lightColors[i % lightColors.length]));
  }

  // Pass 1: Replace all var(--xxx) references
  let result = svgString.replace(/var\(--([^)]+)\)/g, (match, varName: string) => {
    return colorMap.get(varName) ?? match;
  });

  // Pass 2: Replace any remaining inline oklch() values with hex.
  // If the oklch value matches a dark-mode palette color, use the light-mode equivalent.
  // Otherwise convert directly (for non-palette oklch values like theme colors).
  result = result.replace(/oklch\([^)]+\)/g, (match) => {
    return darkToLightHex.get(match) ?? oklchToHex(match);
  });

  return result;
}

/** Render an Excalidraw drawing JSON to an SVG string (light mode for export). */
export async function renderDrawingSvg(drawingJson: string): Promise<string> {
  try {
    const scene = JSON.parse(drawingJson) as {
      elements?: unknown[];
      appState?: Record<string, unknown>;
      files?: Record<string, unknown>;
    };
    const elements = scene.elements ?? [];
    if (elements.length === 0) return "";

    const { exportToSvg } = await import("@excalidraw/excalidraw");
    const svgEl = await exportToSvg({
      elements: elements as Parameters<typeof exportToSvg>[0]["elements"],
      appState: {
        ...(scene.appState ?? {}),
        exportWithDarkMode: false, // always light mode for export
        exportBackground: true,
      },
      files: (scene.files ?? {}) as Parameters<typeof exportToSvg>[0]["files"],
    });
    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
    svgEl.style.width = "100%";
    svgEl.style.height = "auto";
    return svgEl.outerHTML;
  } catch {
    return "";
  }
}

export function useExportOperations(editor: Editor | null) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(
    async (options: ExportOptions) => {
      if (!editor) return;

      const { openDocuments, activeTabId } = useEditorStore.getState();
      const activeTab = openDocuments.find((t) => t.id === activeTabId);
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

      // Only emit built-in template names — user-uploaded templates carry
      // arbitrary, PII-bearing filenames, so collapse anything unknown to
      // "custom" (keeps the telemetry payload low-cardinality and PII-free).
      const rawTemplate =
        options.format === "pptx" ? options.pptxTemplate : options.template;
      const BUILTIN_TEMPLATES = new Set<ExportTemplate>([
        "clean",
        "academic",
        "report",
        "simple",
        "business",
      ]);
      track("export_performed", {
        format: options.format,
        template: BUILTIN_TEMPLATES.has(rawTemplate as ExportTemplate)
          ? (rawTemplate as ExportTemplate)
          : "custom",
      });

      // Resolve project root for image/drawing path resolution
      const projectRoot = useWorkspaceStore
        .getState()
        .projects.find((p) => activeTab.filePath.startsWith(p.path + "/"))?.path;

      // Read typography presets for export styling (PDF, DOCX, HTML)
      const typography = presetsForBackend(useEditorStylesStore.getState().presets);

      // Collect pre-rendered SVGs for inline charts and drawings
      const embeddedSvgs = await collectEmbeddedSvgs(editor);

      try {
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
            embeddedSvgs: embeddedSvgs.length > 0 ? embeddedSvgs : undefined,
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
            embeddedSvgs: embeddedSvgs.length > 0 ? embeddedSvgs : undefined,
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
            projectRoot: projectRoot ?? undefined,
            typography,
            embeddedSvgs: embeddedSvgs.length > 0 ? embeddedSvgs : undefined,
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
