/**
 * Convert an SVG string to PNG bytes using the browser Canvas API.
 *
 * Renders the SVG at 2x scale for high-DPI quality, returns raw PNG bytes
 * as a number[] suitable for passing to Tauri IPC.
 */
export async function svgToPng(
  svgString: string,
  width: number,
  height: number
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to get canvas 2d context"));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (b) => {
          if (!b) {
            reject(new Error("Failed to create PNG blob"));
            return;
          }
          b.arrayBuffer().then((buf) =>
            resolve(Array.from(new Uint8Array(buf)))
          );
        },
        "image/png"
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG into image element"));
    };

    img.src = url;
  });
}

/** PNG image data with original dimensions for export embedding. */
export interface EmbeddedImage {
  data: number[];
  width: number;
  height: number;
}

/**
 * Collect all chart, drawing, and mermaid SVGs from the editor DOM and
 * rasterize them to PNG. Returns images in document order, matching the
 * order comrak encounters the corresponding fenced code blocks.
 *
 * The CSS variable resolution happens implicitly because the SVGs are
 * captured from the live DOM where CSS variables are already resolved
 * by the browser.
 */
export async function collectEmbeddedImages(): Promise<EmbeddedImage[]> {
  // Find all chart, drawing, and mermaid node views in document order.
  // The ProseMirror DOM preserves document order, so the array index
  // matches the positional index of the corresponding fenced code block
  // in the comrak AST walk.
  const editorEl = document.querySelector(".ProseMirror");
  if (!editorEl) return [];

  // Find all node-view wrappers for chart, drawing, and mermaid in DOM order
  const nodeViews = editorEl.querySelectorAll(
    ".chart-block, .drawing-node-view, .mermaid-node-view"
  );

  const images: EmbeddedImage[] = [];

  for (const nodeView of nodeViews) {
    let svgElement: SVGSVGElement | null = null;

    if (nodeView.classList.contains("chart-block")) {
      svgElement = nodeView.querySelector(".recharts-wrapper svg");
    } else if (nodeView.classList.contains("drawing-node-view")) {
      svgElement = nodeView.querySelector(".drawing-svg-container svg");
    } else if (nodeView.classList.contains("mermaid-node-view")) {
      svgElement = nodeView.querySelector(".mermaid-svg-container svg");
    }

    if (!svgElement) {
      // Node view exists but SVG not rendered yet — skip
      continue;
    }

    const rect = svgElement.getBoundingClientRect();
    const width = Math.round(rect.width) || 600;
    const height = Math.round(rect.height) || 400;

    const svgString = new XMLSerializer().serializeToString(svgElement);

    try {
      const data = await svgToPng(svgString, width, height);
      images.push({ data, width, height });
    } catch (err) {
      console.warn("Failed to rasterize SVG for export:", err);
      // Skip this image — the backend will render the code block as text
    }
  }

  return images;
}
