/**
 * Chart sidecar file operations for reading, writing, and deleting
 * chart JSON and SVG preview files via Tauri IPC.
 *
 * Chart files are stored at:
 *   <projectRoot>/.notesage/charts/<chartId>.json
 *   <projectRoot>/.notesage/charts/<chartId>.svg
 */

import { tauriApi } from "@/lib/tauri";
import type { ChartData } from "@/lib/chart-types";

const CHARTS_DIR = ".notesage/charts";

function chartsPath(projectRoot: string): string {
  return `${projectRoot}/${CHARTS_DIR}`;
}

function chartJsonPath(chartId: string, projectRoot: string): string {
  return `${chartsPath(projectRoot)}/${chartId}.json`;
}

function chartSvgPath(chartId: string, projectRoot: string): string {
  return `${chartsPath(projectRoot)}/${chartId}.svg`;
}

/**
 * Ensures the .notesage/charts/ directory exists, creating
 * .notesage/ and .notesage/charts/ as needed.
 */
async function ensureChartsDir(projectRoot: string): Promise<void> {
  const notesageDir = `${projectRoot}/.notesage`;
  const dir = chartsPath(projectRoot);

  const dirExists = await tauriApi.pathExists(dir);
  if (!dirExists) {
    const notesageDirExists = await tauriApi.pathExists(notesageDir);
    if (!notesageDirExists) {
      await tauriApi.createDirectory(notesageDir);
    }
    await tauriApi.createDirectory(dir);
  }
}

/**
 * Load chart data from a sidecar JSON file.
 * Returns the parsed ChartData, or null if the file doesn't exist.
 */
export async function loadChart(
  chartId: string,
  projectRoot: string
): Promise<ChartData | null> {
  const filePath = chartJsonPath(chartId, projectRoot);
  try {
    const exists = await tauriApi.pathExists(filePath);
    if (!exists) return null;

    const raw = await tauriApi.readFile(filePath);
    return JSON.parse(raw) as ChartData;
  } catch {
    return null;
  }
}

/**
 * Save chart data to a sidecar JSON file.
 * Creates the charts directory if it doesn't exist.
 */
export async function saveChart(
  chartId: string,
  projectRoot: string,
  data: ChartData
): Promise<void> {
  await ensureChartsDir(projectRoot);
  const filePath = chartJsonPath(chartId, projectRoot);
  await tauriApi.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Save an SVG preview string to disk alongside the chart JSON.
 * Used for PDF export — the SVG is cached here on every chart save.
 */
export async function saveSvgPreview(
  chartId: string,
  projectRoot: string,
  svgString: string
): Promise<void> {
  await ensureChartsDir(projectRoot);
  const filePath = chartSvgPath(chartId, projectRoot);
  await tauriApi.writeFile(filePath, svgString);
}

/**
 * Load the cached SVG preview string from disk.
 * Returns the SVG string, or null if the file doesn't exist.
 */
export async function loadSvgPreview(
  chartId: string,
  projectRoot: string
): Promise<string | null> {
  const filePath = chartSvgPath(chartId, projectRoot);
  try {
    const exists = await tauriApi.pathExists(filePath);
    if (!exists) return null;

    return await tauriApi.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Delete both the .json and .svg files for a chart.
 * Silently ignores errors if the files don't exist.
 */
export async function deleteChart(
  chartId: string,
  projectRoot: string
): Promise<void> {
  const json = chartJsonPath(chartId, projectRoot);
  const svg = chartSvgPath(chartId, projectRoot);

  try {
    await tauriApi.deletePath(json);
  } catch {
    // File may not exist — ignore
  }

  try {
    await tauriApi.deletePath(svg);
  } catch {
    // File may not exist — ignore
  }
}

/**
 * Check whether a chart JSON file exists on disk.
 */
export async function chartExists(
  chartId: string,
  projectRoot: string
): Promise<boolean> {
  const filePath = chartJsonPath(chartId, projectRoot);
  return tauriApi.pathExists(filePath);
}
