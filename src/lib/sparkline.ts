const SVG_NS = 'http://www.w3.org/2000/svg';
const PADDING = 2;

/**
 * Render a sparkline as an inline SVG element.
 *
 * Pure function — produces a self-contained SVG that uses CSS variables
 * for theming (works in both light and dark mode).
 *
 * @param data   Array of numeric values
 * @param width  SVG width in pixels (default 60)
 * @param height SVG height in pixels (default 20)
 * @returns SVGSVGElement ready to insert into the DOM
 */
export function renderSparkline(
  data: number[],
  width = 60,
  height = 20,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'sparkline');

  if (data.length === 0) {
    return svg;
  }

  const innerWidth = width - PADDING * 2;
  const innerHeight = height - PADDING * 2;

  if (data.length === 1) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(width / 2));
    circle.setAttribute('cy', String(height / 2));
    circle.setAttribute('r', '1.5');
    circle.setAttribute('fill', 'var(--color-muted-foreground)');
    circle.setAttribute('fill-opacity', '0.5');
    svg.appendChild(circle);
    return svg;
  }

  // Compute points
  const points = normalizePoints(data, innerWidth, innerHeight);

  // Gradient definition for the fill area
  const gradientId = `sparkline-grad-${uniqueId()}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const gradient = document.createElementNS(SVG_NS, 'linearGradient');
  gradient.setAttribute('id', gradientId);
  gradient.setAttribute('x1', '0');
  gradient.setAttribute('y1', '0');
  gradient.setAttribute('x2', '0');
  gradient.setAttribute('y2', '1');

  const stop1 = document.createElementNS(SVG_NS, 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', 'var(--color-muted-foreground)');
  stop1.setAttribute('stop-opacity', '0.15');

  const stop2 = document.createElementNS(SVG_NS, 'stop');
  stop2.setAttribute('offset', '100%');
  stop2.setAttribute('stop-color', 'var(--color-muted-foreground)');
  stop2.setAttribute('stop-opacity', '0');

  gradient.appendChild(stop1);
  gradient.appendChild(stop2);
  defs.appendChild(gradient);
  svg.appendChild(defs);

  const pointsStr = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Fill polygon: data points plus bottom-right and bottom-left corners
  const polygon = document.createElementNS(SVG_NS, 'polygon');
  const firstX = points[0].x;
  const lastX = points[points.length - 1].x;
  const bottomY = PADDING + innerHeight;
  const fillPointsStr = `${pointsStr} ${lastX},${bottomY} ${firstX},${bottomY}`;
  polygon.setAttribute('points', fillPointsStr);
  polygon.setAttribute('fill', `url(#${gradientId})`);
  polygon.setAttribute('stroke', 'none');
  svg.appendChild(polygon);

  // Stroke polyline
  const polyline = document.createElementNS(SVG_NS, 'polyline');
  polyline.setAttribute('points', pointsStr);
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', 'var(--color-muted-foreground)');
  polyline.setAttribute('stroke-opacity', '0.5');
  polyline.setAttribute('stroke-width', '1.5');
  polyline.setAttribute('stroke-linejoin', 'round');
  polyline.setAttribute('stroke-linecap', 'round');
  svg.appendChild(polyline);

  return svg;
}

/**
 * Render a sparkline and return the outer HTML string.
 * Useful for ProseMirror widget decorations or innerHTML injection.
 */
export function renderSparklineHTML(
  data: number[],
  width = 60,
  height = 20,
): string {
  return renderSparkline(data, width, height).outerHTML;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

let counter = 0;

/** Simple incrementing ID to keep gradient IDs unique within a page. */
function uniqueId(): number {
  return counter++;
}

/**
 * Map raw data values to SVG coordinate points within the padded area.
 * Y-axis is inverted (SVG 0,0 is top-left).
 */
function normalizePoints(
  data: number[],
  innerWidth: number,
  innerHeight: number,
): Point[] {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;

  return data.map((value, index) => {
    const x =
      data.length === 1
        ? PADDING + innerWidth / 2
        : PADDING + (index / (data.length - 1)) * innerWidth;

    const y =
      range === 0
        ? PADDING + innerHeight / 2 // All values identical — center line
        : PADDING + (1 - (value - min) / range) * innerHeight;

    return { x, y };
  });
}
