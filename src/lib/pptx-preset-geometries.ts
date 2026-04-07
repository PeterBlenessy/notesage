/**
 * DrawingML preset geometry shapes -- SVG path data in normalized 0-1 coordinate space.
 * At render time, scale via viewBox="0 0 1 1" on the SVG element.
 *
 * Reference: ECMA-376 Part 1 Section 20.1.10.55,
 * LibreOffice oox/source/drawingml/customshapes/
 */

// Helper: generate regular polygon vertices centered at (0.5, 0.5) with radius 0.5
function regularPolygon(n: number, rotationDeg = -90): string {
  const points: string[] = [];
  const rotRad = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const angle = rotRad + (2 * Math.PI * i) / n;
    const x = 0.5 + 0.5 * Math.cos(angle);
    const y = 0.5 + 0.5 * Math.sin(angle);
    const xr = Math.round(x * 10000) / 10000;
    const yr = Math.round(y * 10000) / 10000;
    points.push(i === 0 ? `M ${xr} ${yr}` : `L ${xr} ${yr}`);
  }
  points.push('Z');
  return points.join(' ');
}

// Helper: generate star polygon with n outer points
function star(n: number, innerRatio: number, rotationDeg = -90): string {
  const points: string[] = [];
  const rotRad = (rotationDeg * Math.PI) / 180;
  const totalPoints = n * 2;
  for (let i = 0; i < totalPoints; i++) {
    const angle = rotRad + (2 * Math.PI * i) / totalPoints;
    const r = i % 2 === 0 ? 0.5 : 0.5 * innerRatio;
    const x = 0.5 + r * Math.cos(angle);
    const y = 0.5 + r * Math.sin(angle);
    const xr = Math.round(x * 10000) / 10000;
    const yr = Math.round(y * 10000) / 10000;
    points.push(i === 0 ? `M ${xr} ${yr}` : `L ${xr} ${yr}`);
  }
  points.push('Z');
  return points.join(' ');
}

export const PRESET_GEOMETRIES: Record<string, string> = {
  // ── Arrows ──────────────────────────────────────────────────────────────

  rightArrow:
    'M 0 0.25 L 0.6 0.25 L 0.6 0 L 1 0.5 L 0.6 1 L 0.6 0.75 L 0 0.75 Z',

  leftArrow:
    'M 1 0.25 L 0.4 0.25 L 0.4 0 L 0 0.5 L 0.4 1 L 0.4 0.75 L 1 0.75 Z',

  upArrow:
    'M 0.25 1 L 0.25 0.4 L 0 0.4 L 0.5 0 L 1 0.4 L 0.75 0.4 L 0.75 1 Z',

  downArrow:
    'M 0.25 0 L 0.25 0.6 L 0 0.6 L 0.5 1 L 1 0.6 L 0.75 0.6 L 0.75 0 Z',

  chevron:
    'M 0 0 L 0.75 0 L 1 0.5 L 0.75 1 L 0 1 L 0.25 0.5 Z',

  notchedRightArrow:
    'M 0 0.25 L 0.6 0.25 L 0.6 0 L 1 0.5 L 0.6 1 L 0.6 0.75 L 0 0.75 L 0.15 0.5 Z',

  leftRightArrow:
    'M 0 0.5 L 0.2 0.2 L 0.2 0.35 L 0.8 0.35 L 0.8 0.2 L 1 0.5 L 0.8 0.8 L 0.8 0.65 L 0.2 0.65 L 0.2 0.8 Z',

  // ── Stars ───────────────────────────────────────────────────────────────

  // 5-pointed star: inner radius ratio ~0.382 (golden ratio based)
  star5: star(5, 0.382),

  // 6-pointed star (Star of David): inner ratio ~0.577
  star6: star(6, 0.577),

  // 4-pointed star
  star4: star(4, 0.382),

  // ── Basic Shapes ────────────────────────────────────────────────────────

  // Isosceles triangle pointing up
  triangle: 'M 0.5 0 L 1 1 L 0 1 Z',

  // Right triangle
  rtTriangle: 'M 0 1 L 1 1 L 0 0 Z',

  // Diamond / rhombus
  diamond: 'M 0.5 0 L 1 0.5 L 0.5 1 L 0 0.5 Z',

  // Regular pentagon
  pentagon: regularPolygon(5),

  // Regular hexagon
  hexagon: regularPolygon(6),

  // Regular octagon
  octagon: regularPolygon(8, -22.5),

  // Trapezoid (wide bottom, narrow top)
  trapezoid: 'M 0.2 0 L 0.8 0 L 1 1 L 0 1 Z',

  // Parallelogram
  parallelogram: 'M 0.25 0 L 1 0 L 0.75 1 L 0 1 Z',

  // Rectangle (explicit for preset mapping)
  rect: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',

  // Rounded rectangle approximated with cubic beziers (r ~0.1)
  roundRect:
    'M 0.1 0 L 0.9 0 C 0.955 0 1 0.045 1 0.1 L 1 0.9 C 1 0.955 0.955 1 0.9 1 L 0.1 1 C 0.045 1 0 0.955 0 0.9 L 0 0.1 C 0 0.045 0.045 0 0.1 0 Z',

  // ── Callouts ────────────────────────────────────────────────────────────

  // Rectangle with triangular pointer at bottom-left
  wedgeRectCallout:
    'M 0 0 L 1 0 L 1 0.75 L 0.4 0.75 L 0.15 1 L 0.25 0.75 L 0 0.75 Z',

  // Cloud callout -- simplified cloud with pointer
  cloudCallout: [
    'M 0.25 0.75',
    'C 0.05 0.75 0 0.6 0.1 0.5',
    'C 0.0 0.4 0.05 0.25 0.2 0.25',
    'C 0.2 0.1 0.35 0.05 0.5 0.1',
    'C 0.6 0.0 0.8 0.05 0.85 0.2',
    'C 1.0 0.25 1.0 0.45 0.9 0.55',
    'C 1.0 0.7 0.9 0.75 0.75 0.75',
    'L 0.45 0.75 L 0.25 1 L 0.35 0.75 Z',
  ].join(' '),

  // ── Flowchart ───────────────────────────────────────────────────────────

  // Process -- simple rectangle
  flowChartProcess: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',

  // Decision -- diamond
  flowChartDecision: 'M 0.5 0 L 1 0.5 L 0.5 1 L 0 0.5 Z',

  // Document -- rectangle with wavy bottom
  flowChartDocument:
    'M 0 0 L 1 0 L 1 0.8 C 0.75 0.95 0.5 0.7 0.25 0.85 C 0.15 0.9 0.05 0.95 0 0.9 Z',

  // Terminator -- stadium / pill shape
  flowChartTerminator: [
    'M 0.25 0',
    'L 0.75 0',
    'C 0.89 0 1 0.22 1 0.5',
    'C 1 0.78 0.89 1 0.75 1',
    'L 0.25 1',
    'C 0.11 1 0 0.78 0 0.5',
    'C 0 0.22 0.11 0 0.25 0',
    'Z',
  ].join(' '),

  // Connector -- circle
  flowChartConnector:
    'M 0.5 0 C 0.776 0 1 0.224 1 0.5 C 1 0.776 0.776 1 0.5 1 C 0.224 1 0 0.776 0 0.5 C 0 0.224 0.224 0 0.5 0 Z',

  // Preparation -- elongated hexagon
  flowChartPreparation: 'M 0.2 0 L 0.8 0 L 1 0.5 L 0.8 1 L 0.2 1 L 0 0.5 Z',

  // Manual input -- slanted top
  flowChartManualInput: 'M 0 0.2 L 1 0 L 1 1 L 0 1 Z',

  // ── Misc ────────────────────────────────────────────────────────────────

  // Heart shape
  heart: [
    'M 0.5 0.35',
    'C 0.5 0.15 0.75 0 0.85 0.05',
    'C 1.05 0.15 1.05 0.45 0.5 1',
    'C -0.05 0.45 -0.05 0.15 0.15 0.05',
    'C 0.25 0 0.5 0.15 0.5 0.35',
    'Z',
  ].join(' '),

  // Cloud outline
  cloud: [
    'M 0.25 0.75',
    'C 0.05 0.75 0 0.6 0.1 0.5',
    'C 0.0 0.4 0.05 0.25 0.2 0.25',
    'C 0.2 0.1 0.35 0.05 0.5 0.1',
    'C 0.6 0.0 0.8 0.05 0.85 0.2',
    'C 1.0 0.25 1.0 0.45 0.9 0.55',
    'C 1.0 0.7 0.9 0.75 0.75 0.75',
    'Z',
  ].join(' '),

  // Lightning bolt
  lightningBolt:
    'M 0.55 0 L 0.2 0.45 L 0.45 0.45 L 0.3 1 L 0.85 0.5 L 0.6 0.5 L 0.75 0 Z',

  // Frame (rectangular frame with hole -- use fill-rule="evenodd")
  frame:
    'M 0 0 L 1 0 L 1 1 L 0 1 Z M 0.12 0.12 L 0.12 0.88 L 0.88 0.88 L 0.88 0.12 Z',

  // Cylinder (can) approximated with bezier curves
  can: [
    // Top ellipse
    'M 0 0.15',
    'C 0 0.067 0.224 0 0.5 0',
    'C 0.776 0 1 0.067 1 0.15',
    // Right side
    'L 1 0.85',
    // Bottom ellipse
    'C 1 0.933 0.776 1 0.5 1',
    'C 0.224 1 0 0.933 0 0.85',
    // Left side back up
    'L 0 0.15 Z',
    // Top ellipse cap (drawn separately so the lid is visible)
    'M 0 0.15',
    'C 0 0.233 0.224 0.3 0.5 0.3',
    'C 0.776 0.3 1 0.233 1 0.15',
  ].join(' '),

  // Ribbon / banner
  ribbon2: [
    'M 0 0.2 L 0.15 0.35 L 0.15 0.15 L 0.85 0.15 L 0.85 0.35 L 1 0.2',
    'L 1 0.8 L 0.85 0.65 L 0.85 0.85 L 0.15 0.85 L 0.15 0.65 L 0 0.8 Z',
  ].join(' '),

  // Home plate (pentagon arrow pointing right)
  homePlate: 'M 0 0 L 0.75 0 L 1 0.5 L 0.75 1 L 0 1 Z',

  // Plus / cross sign
  plus:
    'M 0.35 0 L 0.65 0 L 0.65 0.35 L 1 0.35 L 1 0.65 L 0.65 0.65 L 0.65 1 L 0.35 1 L 0.35 0.65 L 0 0.65 L 0 0.35 L 0.35 0.35 Z',

  // Moon (crescent)
  moon: [
    'M 0.85 0',
    'C 0.5 0.15 0.3 0.35 0.3 0.5',
    'C 0.3 0.65 0.5 0.85 0.85 1',
    'C 0.4 0.9 0 0.75 0 0.5',
    'C 0 0.25 0.4 0.1 0.85 0',
    'Z',
  ].join(' '),

  // Donut (ring -- use fill-rule="evenodd")
  donut:
    'M 0.5 0 C 0.776 0 1 0.224 1 0.5 C 1 0.776 0.776 1 0.5 1 C 0.224 1 0 0.776 0 0.5 C 0 0.224 0.224 0 0.5 0 Z M 0.5 0.25 C 0.362 0.25 0.25 0.362 0.25 0.5 C 0.25 0.638 0.362 0.75 0.5 0.75 C 0.638 0.75 0.75 0.638 0.75 0.5 C 0.75 0.362 0.638 0.25 0.5 0.25 Z',

  // Ellipse / oval
  ellipse:
    'M 0.5 0 C 0.776 0 1 0.224 1 0.5 C 1 0.776 0.776 1 0.5 1 C 0.224 1 0 0.776 0 0.5 C 0 0.224 0.224 0 0.5 0 Z',

  // Block arc (partial ring, top-open) -- quarter arc
  blockArc: [
    'M 0.5 0 C 0.776 0 1 0.224 1 0.5',
    'L 0.75 0.5 C 0.75 0.362 0.638 0.25 0.5 0.25 Z',
  ].join(' '),

  // Snip single corner rectangle (top-right snipped)
  snip1Rect: 'M 0 0 L 0.85 0 L 1 0.15 L 1 1 L 0 1 Z',

  // Round single corner rectangle (top-right rounded)
  round1Rect:
    'M 0 0 L 0.8 0 C 0.911 0 1 0.089 1 0.2 L 1 1 L 0 1 Z',

  // Circular arrow (simplified)
  circularArrow: [
    'M 0.5 0.15',
    'C 0.692 0.15 0.85 0.308 0.85 0.5',
    'C 0.85 0.692 0.692 0.85 0.5 0.85',
    'C 0.308 0.85 0.15 0.692 0.15 0.5',
    'L 0.05 0.5 L 0.25 0.35 L 0.25 0.5',
    'C 0.25 0.638 0.362 0.75 0.5 0.75',
    'C 0.638 0.75 0.75 0.638 0.75 0.5',
    'C 0.75 0.362 0.638 0.25 0.5 0.25',
    'Z',
  ].join(' '),
};
