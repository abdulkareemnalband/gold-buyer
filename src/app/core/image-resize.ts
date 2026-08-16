/**
 * Photo downscale.
 *
 * A phone camera returns 3 to 12 MB per photo. IndexedDB shares one quota with the rest
 * of the origin, so the app never stores the original. It resizes the long edge to
 * 1600 pixels and encodes WebP at quality 0.8, which lands near 150 to 300 kB.
 *
 * jsdom provides neither `createImageBitmap` nor `OffscreenCanvas`, so this file carries
 * no unit test. The manual photo checks cover it.
 */

const MAX_EDGE = 1600;
const QUALITY = 0.8;

export interface ResizedImage {
  blob: Blob;
  width: number;
  height: number;
}

export async function resizeImage(file: Blob): Promise<ResizedImage> {
  const source = await createImageBitmap(file);
  const { width, height } = fitInside(source.width, source.height);

  try {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;

    if (!context) {
      throw new Error('The browser gave no 2D canvas context.');
    }

    context.drawImage(source, 0, 0, width, height);
    const blob = await toBlob(canvas);
    return { blob, width, height };
  } finally {
    source.close();
  }
}

/** Scale the long edge down to the limit. A small photo stays at its own size. */
function fitInside(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);

  if (longEdge <= MAX_EDGE) {
    return { width, height };
  }

  const scale = MAX_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** WebP first. A browser without a WebP encoder falls back to JPEG. */
async function toBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  for (const type of ['image/webp', 'image/jpeg']) {
    const blob = await encode(canvas, type);

    if (blob && blob.type === type) {
      return blob;
    }
  }

  throw new Error('The browser encoded neither WebP nor JPEG.');
}

function encode(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
): Promise<Blob | null> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
  }

  return canvas.convertToBlob({ type, quality: QUALITY }).catch(() => null);
}
