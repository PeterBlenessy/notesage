import type { ImageAttachment } from './ai/types';

const MAX_DIMENSION = 1568;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const INITIAL_QUALITY = 0.8;
const RETRY_QUALITY = 0.6;

/** Generate a short unique ID for attachment tracking */
function generateId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Load an image source (File, Blob, or base64 string) into an HTMLImageElement */
async function loadImage(
  source: File | Blob | string
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));

    if (typeof source === 'string') {
      // base64 string — ensure it has the data URI prefix
      img.src = source.startsWith('data:')
        ? source
        : `data:image/png;base64,${source}`;
    } else {
      img.src = URL.createObjectURL(source);
    }
  });
}

/** Check if an image has any transparent pixels */
export function hasTransparency(img: HTMLImageElement): boolean {
  const size = 64; // Sample at a small size for performance
  const canvas = document.createElement('canvas');
  const aspect = img.naturalWidth / img.naturalHeight;
  canvas.width = Math.min(size, img.naturalWidth);
  canvas.height = Math.min(
    Math.round(canvas.width / aspect),
    img.naturalHeight
  );

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  // Check alpha channel (every 4th byte)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/** Convert a canvas to a base64 string and return the data + size */
function canvasToBase64(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): { data: string; size: number } {
  const dataUrl = canvas.toDataURL(mimeType, quality);
  // Strip the data URI prefix to get raw base64
  const base64 = dataUrl.split(',')[1];
  const size = Math.ceil(base64.length * 0.75); // Approximate byte size from base64 length
  return { data: base64, size };
}

/** Extract a display name from the source if available */
function getName(source: File | Blob | string): string | undefined {
  if (source instanceof File) return source.name;
  return undefined;
}

/**
 * Compress and resize an image for AI chat attachments.
 *
 * - Resizes to max 1568px longest edge (Anthropic's optimal threshold)
 * - Converts opaque PNGs to JPEG for smaller size
 * - Validates result is under 5 MB, retries at lower quality if needed
 */
export async function compressImage(
  source: File | Blob | string,
  options?: {
    maxDimension?: number;
    quality?: number;
    maxBytes?: number;
    name?: string;
  }
): Promise<ImageAttachment> {
  const maxDim = options?.maxDimension ?? MAX_DIMENSION;
  const maxBytes = options?.maxBytes ?? MAX_BYTES;
  const initialQuality = options?.quality ?? INITIAL_QUALITY;

  const img = await loadImage(source);

  // Calculate target dimensions
  let { naturalWidth: w, naturalHeight: h } = img;
  if (Math.max(w, h) > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  // Draw to canvas at target size
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create canvas context');
  ctx.drawImage(img, 0, 0, w, h);

  // Revoke object URL if we created one
  if (typeof source !== 'string' && img.src.startsWith('blob:')) {
    URL.revokeObjectURL(img.src);
  }

  // Determine output format: keep PNG only if image has transparency
  const isTransparent = hasTransparency(img);
  const mimeType = isTransparent ? 'image/png' : 'image/jpeg';

  // First attempt
  let result = canvasToBase64(
    canvas,
    mimeType,
    mimeType === 'image/jpeg' ? initialQuality : undefined
  );

  // If too large and JPEG, retry at lower quality
  if (result.size > maxBytes && mimeType === 'image/jpeg') {
    result = canvasToBase64(canvas, mimeType, RETRY_QUALITY);
  }

  // If still too large for PNG, convert to JPEG as last resort
  if (result.size > maxBytes && mimeType === 'image/png') {
    result = canvasToBase64(canvas, 'image/jpeg', RETRY_QUALITY);
    return {
      id: generateId(),
      data: result.data,
      mimeType: 'image/jpeg',
      width: w,
      height: h,
      name: options?.name ?? getName(source),
      size: result.size,
    };
  }

  return {
    id: generateId(),
    data: result.data,
    mimeType,
    width: w,
    height: h,
    name: options?.name ?? getName(source),
    size: result.size,
  };
}
