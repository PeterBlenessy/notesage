// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { svgToPng, collectEmbeddedImages } from '../svg-to-png';
import type { EmbeddedImage } from '../svg-to-png';

describe('svgToPng', () => {
  it('is exported as a function', () => {
    expect(typeof svgToPng).toBe('function');
  });

  it('accepts three parameters (svgString, width, height)', () => {
    // Function.length reports the number of declared parameters
    expect(svgToPng.length).toBe(3);
  });

  it('returns a Promise', () => {
    // In jsdom, Canvas/Image aren't fully functional, so the call will
    // reject — but it should still return a Promise.
    const result = svgToPng('<svg></svg>', 100, 100);
    expect(result).toBeInstanceOf(Promise);
    // Suppress the expected rejection
    result.catch(() => {});
  });
});

describe('collectEmbeddedImages', () => {
  it('is exported as a function', () => {
    expect(typeof collectEmbeddedImages).toBe('function');
  });

  it('accepts zero parameters', () => {
    expect(collectEmbeddedImages.length).toBe(0);
  });

  it('returns a Promise', () => {
    const result = collectEmbeddedImages();
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });

  it('returns an empty array when no ProseMirror editor is in the DOM', async () => {
    // No .ProseMirror element exists in jsdom, so it should return []
    const images = await collectEmbeddedImages();
    expect(images).toEqual([]);
  });
});

describe('EmbeddedImage type', () => {
  it('has the expected shape (data, width, height)', () => {
    // Type-level test — if this compiles, the interface is correct
    const img: EmbeddedImage = { data: [0, 1, 2], width: 100, height: 50 };
    expect(img.data).toEqual([0, 1, 2]);
    expect(img.width).toBe(100);
    expect(img.height).toBe(50);
  });
});
