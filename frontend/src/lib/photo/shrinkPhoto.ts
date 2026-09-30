// A photo picked on a dialog -- a dish's, a product's -- made small enough to
// send.
//
// The server has no image library (no Pillow): what it stores is what the
// browser sends, up to 512 KB. So the browser does the work, on a canvas --
// the longest side down to 800 px, re-encoded as JPEG -- and the dialog
// previews the result from a `data:` URL, because the CSP admits `data:`
// images and not `blob:` ones.
//
// Re-encoding also drops what a phone writes into its photos: the place it
// was taken among them. The photo is served to anybody holding its address,
// and a kitchen's GPS position has no business travelling with a croqueta --
// nor with a case of beer photographed in the storeroom.
//
// Browser only (canvas, createImageBitmap, FileReader); the arithmetic it
// relies on is in photo.ts, with tests.

import { fitWithin, PHOTO_MAX_BYTES, PHOTO_QUALITIES } from './photo';

export type ShrinkResult =
  | { ok: true; blob: Blob; preview: string; width: number; height: number }
  | { ok: false; problem: 'unreadable' | 'tooLarge' };

interface Decoded {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable')));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsDataURL(blob);
  });
}

/**
 * The picked file as something a canvas can draw, turned the way the phone
 * held it (both ways below honour the photo's orientation). createImageBitmap
 * first -- it decodes the file directly, off the main thread where it can --
 * and an <img> from a `data:` URL where it is missing or refuses the file.
 * Null for a file no browser path can read (a HEIC photo on a desktop browser
 * without HEIC, a PDF picked by mistake).
 */
async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // On to the <img>.
    }
  }
  try {
    const image = new Image();
    image.src = await readAsDataUrl(file);
    await image.decode();
    return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => undefined };
  } catch {
    return null;
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * The file reduced and re-encoded, with its preview; or why it could not be:
 * `unreadable` (not an image this browser can open) or `tooLarge` (still over
 * 512 KB at the lowest quality tried -- in practice, never, at 800 px).
 */
export async function shrinkPhoto(file: Blob): Promise<ShrinkResult> {
  const decoded = await decode(file);
  if (!decoded) return { ok: false, problem: 'unreadable' };
  try {
    const size = fitWithin(decoded.width, decoded.height);
    if (!size) return { ok: false, problem: 'unreadable' };
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return { ok: false, problem: 'unreadable' };
    // JPEG has no transparency: a PNG's clear parts would turn black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.image, 0, 0, size.width, size.height);
    for (const quality of PHOTO_QUALITIES) {
      const blob = await toJpeg(canvas, quality);
      if (!blob) return { ok: false, problem: 'unreadable' };
      if (blob.size <= PHOTO_MAX_BYTES) {
        return { ok: true, blob, preview: await readAsDataUrl(blob), width: size.width, height: size.height };
      }
    }
    return { ok: false, problem: 'tooLarge' };
  } catch {
    return { ok: false, problem: 'unreadable' };
  } finally {
    decoded.release();
  }
}
