// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderSparkline, renderSparklineHTML } from '../sparkline';

describe('renderSparkline', () => {
  it('returns empty SVG for empty data', () => {
    const svg = renderSparkline([], 60, 20);
    expect(svg.tagName).toBe('svg');
    expect(svg.querySelector('polyline')).toBeNull();
    expect(svg.querySelector('circle')).toBeNull();
  });

  it('renders a dot for single data point', () => {
    const svg = renderSparkline([42], 60, 20);
    const circle = svg.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute('cx')).toBe('30');
    expect(circle?.getAttribute('cy')).toBe('10');
  });

  it('renders a polyline for multiple data points', () => {
    const svg = renderSparkline([1, 3, 2, 5, 4], 60, 20);
    const polyline = svg.querySelector('polyline');
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute('points')).toBeTruthy();
  });

  it('handles all same values (flat line at center)', () => {
    const svg = renderSparkline([5, 5, 5, 5], 60, 20);
    const polyline = svg.querySelector('polyline');
    expect(polyline).not.toBeNull();
    // All y-coordinates should be the same (center of padded area)
    const points = polyline!.getAttribute('points')!;
    const yValues = points.split(' ').map((p) => parseFloat(p.split(',')[1]));
    const uniqueYs = new Set(yValues);
    expect(uniqueYs.size).toBe(1);
    expect(yValues[0]).toBe(10); // PADDING(2) + innerHeight(16)/2 = 10
  });

  it('handles negative values', () => {
    const svg = renderSparkline([-3, -1, -5, 0, 2], 60, 20);
    const polyline = svg.querySelector('polyline');
    expect(polyline).not.toBeNull();
    // Verify points string is parseable and has 5 points
    const points = polyline!.getAttribute('points')!;
    expect(points.split(' ').length).toBe(5);
  });

  it('renders with default dimensions', () => {
    const svg = renderSparkline([1, 2, 3]);
    expect(svg.getAttribute('width')).toBe('60');
    expect(svg.getAttribute('height')).toBe('20');
  });

  it('renders with custom dimensions', () => {
    const svg = renderSparkline([1, 2, 3], 100, 30);
    expect(svg.getAttribute('width')).toBe('100');
    expect(svg.getAttribute('height')).toBe('30');
  });

  it('includes fill gradient polygon', () => {
    const svg = renderSparkline([1, 3, 2, 5, 4], 60, 20);
    expect(svg.querySelector('polygon')).not.toBeNull();
    expect(svg.querySelector('defs linearGradient')).not.toBeNull();
  });

  it('sets correct viewBox', () => {
    const svg = renderSparkline([1, 2], 80, 24);
    expect(svg.getAttribute('viewBox')).toBe('0 0 80 24');
  });

  it('has accessibility attributes', () => {
    const svg = renderSparkline([1, 2, 3]);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('sparkline');
  });

  it('maps min value to bottom and max to top', () => {
    const svg = renderSparkline([0, 10], 60, 20);
    const polyline = svg.querySelector('polyline')!;
    const points = polyline.getAttribute('points')!;
    const coords = points.split(' ').map((p) => {
      const [x, y] = p.split(',').map(Number);
      return { x, y };
    });
    // First point (value=0) should be at bottom (y = PADDING + innerHeight = 18)
    expect(coords[0].y).toBe(18);
    // Second point (value=10) should be at top (y = PADDING = 2)
    expect(coords[1].y).toBe(2);
  });

  it('distributes x-coordinates evenly', () => {
    const svg = renderSparkline([1, 2, 3, 4, 5], 60, 20);
    const polyline = svg.querySelector('polyline')!;
    const points = polyline.getAttribute('points')!;
    const xs = points.split(' ').map((p) => parseFloat(p.split(',')[0]));
    // 5 points: x values should be at PADDING + i/(n-1) * innerWidth
    // PADDING=2, innerWidth=56, so: 2, 16, 30, 44, 58
    expect(xs[0]).toBe(2);
    expect(xs[4]).toBe(58);
    // Even spacing
    const spacing = xs[1] - xs[0];
    for (let i = 2; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeCloseTo(spacing, 5);
    }
  });

  it('polygon closes at the bottom of the chart', () => {
    const svg = renderSparkline([1, 3, 2], 60, 20);
    const polygon = svg.querySelector('polygon')!;
    const points = polygon.getAttribute('points')!;
    // Should end with lastX,bottomY firstX,bottomY
    expect(points).toContain('18'); // bottomY = PADDING + innerHeight = 2 + 16 = 18
  });

  it('polyline has correct stroke attributes', () => {
    const svg = renderSparkline([1, 2, 3], 60, 20);
    const polyline = svg.querySelector('polyline')!;
    expect(polyline.getAttribute('stroke')).toBe(
      'var(--color-muted-foreground)',
    );
    expect(polyline.getAttribute('stroke-opacity')).toBe('0.5');
    expect(polyline.getAttribute('stroke-width')).toBe('1.5');
    expect(polyline.getAttribute('stroke-linejoin')).toBe('round');
    expect(polyline.getAttribute('stroke-linecap')).toBe('round');
    expect(polyline.getAttribute('fill')).toBe('none');
  });
});

describe('renderSparklineHTML', () => {
  it('returns a string containing SVG markup', () => {
    const html = renderSparklineHTML([1, 2, 3]);
    expect(typeof html).toBe('string');
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });

  it('returns empty SVG string for empty data', () => {
    const html = renderSparklineHTML([]);
    expect(html).toContain('<svg');
    expect(html).not.toContain('polyline');
    expect(html).not.toContain('circle');
  });

  it('contains polyline for multi-point data', () => {
    const html = renderSparklineHTML([4, 2, 7, 1]);
    expect(html).toContain('polyline');
    expect(html).toContain('polygon');
  });
});
