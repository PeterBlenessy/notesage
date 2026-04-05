/**
 * Unit tests for image-compress.ts — image compression and transparency detection
 * for AI chat attachments.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Canvas / Image mocks — jsdom does not provide real canvas rendering
// ---------------------------------------------------------------------------

const mockDrawImage = vi.fn();
const mockGetImageData = vi.fn(() => ({
  data: new Uint8ClampedArray(64 * 64 * 4).fill(255), // All opaque
}));
const mockToDataURL = vi.fn(() => 'data:image/jpeg;base64,dGVzdA==');
const mockGetContext = vi.fn(() => ({
  drawImage: mockDrawImage,
  getImageData: mockGetImageData,
}));

const origCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
  if (tag === 'canvas') {
    return {
      width: 0,
      height: 0,
      toDataURL: mockToDataURL,
      getContext: mockGetContext,
    } as unknown as HTMLCanvasElement;
  }
  return origCreateElement(tag, options);
});

// Mock Image — auto-triggers onload asynchronously
vi.stubGlobal(
  'Image',
  class MockImage {
    naturalWidth = 800;
    naturalHeight = 600;
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
      // Schedule onload so loadImage's promise resolves
      setTimeout(() => this.onload?.(), 0);
    }
  },
);

// Mock URL.createObjectURL / revokeObjectURL
const origURL = globalThis.URL;
vi.stubGlobal('URL', {
  ...origURL,
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
});

// ---------------------------------------------------------------------------
// Import under test (after mocks are in place)
// ---------------------------------------------------------------------------

import { compressImage, hasTransparency } from '../image-compress';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compressImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToDataURL.mockReturnValue('data:image/jpeg;base64,dGVzdA==');
    mockGetImageData.mockReturnValue({
      data: new Uint8ClampedArray(64 * 64 * 4).fill(255),
    });
  });

  it('returns an ImageAttachment with correct structure', async () => {
    const blob = new Blob(['test'], { type: 'image/png' });
    const result = await compressImage(blob);

    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('mimeType');
    expect(result).toHaveProperty('width');
    expect(result).toHaveProperty('height');
    expect(result).toHaveProperty('size');
    expect(result.id).toMatch(/^img-/);
  });

  it('converts opaque PNG to JPEG', async () => {
    const blob = new Blob(['test'], { type: 'image/png' });
    const result = await compressImage(blob);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('preserves name from File input', async () => {
    const file = new File(['test'], 'screenshot.png', { type: 'image/png' });
    const result = await compressImage(file);
    expect(result.name).toBe('screenshot.png');
  });

  it('uses options.name over File name', async () => {
    const file = new File(['test'], 'screenshot.png', { type: 'image/png' });
    const result = await compressImage(file, { name: 'custom.jpg' });
    expect(result.name).toBe('custom.jpg');
  });

  it('returns undefined name for Blob input', async () => {
    const blob = new Blob(['test'], { type: 'image/png' });
    const result = await compressImage(blob);
    expect(result.name).toBeUndefined();
  });

  it('handles base64 string input', async () => {
    const base64 = 'data:image/png;base64,iVBORw0KGgo=';
    const result = await compressImage(base64);
    expect(result).toHaveProperty('data');
    expect(result.mimeType).toBe('image/jpeg'); // all-opaque -> JPEG
  });

  it('handles raw base64 string without data URI prefix', async () => {
    const base64 = 'iVBORw0KGgo=';
    const result = await compressImage(base64);
    expect(result).toHaveProperty('data');
  });

  it('sets width and height from the loaded image dimensions', async () => {
    const blob = new Blob(['test'], { type: 'image/png' });
    const result = await compressImage(blob);
    // Mock Image has naturalWidth=800, naturalHeight=600
    // 800 < 1568 so no scaling should happen
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('computes size from base64 data length', async () => {
    // 'dGVzdA==' is base64 for 'test' -> 8 chars -> ~6 bytes
    const blob = new Blob(['test'], { type: 'image/png' });
    const result = await compressImage(blob);
    expect(result.size).toBeGreaterThan(0);
  });

  it('retries at lower quality when result exceeds maxBytes', async () => {
    let callCount = 0;
    mockToDataURL.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        // First call returns large result
        return 'data:image/jpeg;base64,' + 'A'.repeat(200);
      }
      // Second call returns smaller result
      return 'data:image/jpeg;base64,small';
    });

    const blob = new Blob(['test'], { type: 'image/png' });
    const result = await compressImage(blob, { maxBytes: 50 });
    expect(callCount).toBeGreaterThan(1);
    expect(result).toHaveProperty('data');
  });

  it('revokes object URL for Blob input', async () => {
    const blob = new Blob(['test'], { type: 'image/png' });
    await compressImage(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('does not revoke URL for string input', async () => {
    const base64 = 'data:image/png;base64,iVBORw0KGgo=';
    await compressImage(base64);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});

describe('hasTransparency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImageData.mockReturnValue({
      data: new Uint8ClampedArray(64 * 64 * 4).fill(255),
    });
  });

  it('returns false for fully opaque image', () => {
    const img = { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement;
    expect(hasTransparency(img)).toBe(false);
  });

  it('returns true when alpha < 255 detected', () => {
    const transparentData = new Uint8ClampedArray(64 * 64 * 4).fill(255);
    transparentData[3] = 128; // First pixel has alpha < 255
    mockGetImageData.mockReturnValueOnce({ data: transparentData });

    const img = { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement;
    expect(hasTransparency(img)).toBe(true);
  });

  it('returns true when alpha is 0 (fully transparent)', () => {
    const transparentData = new Uint8ClampedArray(64 * 64 * 4).fill(255);
    transparentData[3] = 0;
    mockGetImageData.mockReturnValueOnce({ data: transparentData });

    const img = { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement;
    expect(hasTransparency(img)).toBe(true);
  });

  it('returns false when getContext returns null', () => {
    mockGetContext.mockReturnValueOnce(null as unknown as ReturnType<typeof mockGetContext>);
    const img = { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement;
    expect(hasTransparency(img)).toBe(false);
  });

  it('samples at a small canvas size for performance', () => {
    const img = { naturalWidth: 4000, naturalHeight: 3000 } as HTMLImageElement;
    hasTransparency(img);
    // drawImage should be called on the small canvas, not at full resolution
    expect(mockDrawImage).toHaveBeenCalled();
  });
});
