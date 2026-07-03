/**
 * Standalone entry for headless chart rendering (the "screenshot exception").
 * Charts are Recharts React node-views that the deterministic DOMSerializer
 * pipeline can't render — so we mount the REAL app `ChartRenderer` in headless
 * Chromium and screenshot its SVG. Bundled by `render-charts.mjs` (esbuild),
 * driven by Playwright. Not part of the app build.
 */
import { createRoot } from "react-dom/client";
import { ChartRenderer } from "@/components/editor/charts/ChartRenderer";
import type { ChartData } from "@/lib/chart-types";

declare global {
  interface Window {
    renderChart: (el: HTMLElement, data: ChartData, height: number) => void;
  }
}

window.renderChart = (el, data, height) => {
  createRoot(el).render(<ChartRenderer chartData={data} height={height} />);
};
