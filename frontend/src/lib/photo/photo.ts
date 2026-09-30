// A photo of a thing the business has -- a dish of the menu, a product of the
// stock -- as far as it can be worked out without a browser: where the image
// is served from, what stands in for it when there is none, how big the copy
// that is uploaded gets, and what saving the thing has to send. The canvas
// work that uses these is in shrinkPhoto.ts; the square that shows one is
// components/photo/SquarePhoto.tsx, and the field that picks one
// components/photo/PhotoField.tsx.
//
// Written for the menu first (lib/menu/photo.ts still re-exports it, with the
// till's own rule, tileFace); the stock's products take their photos the same
// way, through the same server wall (app/photo_http.py).

/** The server's ceiling for one photo (menu_photo_too_large above it). */
export const PHOTO_MAX_BYTES = 512 * 1024;

/**
 * The longest side of the copy that is uploaded. A tile is shown at 200 px
 * at most; 800 is that on a 3x phone with room to spare, and a phone's 4000
 * px original would not fit under the ceiling anyway.
 */
export const PHOTO_MAX_SIDE = 800;

/**
 * The JPEG qualities tried in turn until the copy fits PHOTO_MAX_BYTES. The
 * first is nearly always enough (an 800 px dish is ~150 KB at 0.85); the
 * rest are for the rare photo that is all grain.
 */
export const PHOTO_QUALITIES: readonly number[] = [0.85, 0.75, 0.65, 0.5];

/**
 * The size of the reduced copy: the longest side at most `maxSide`, the
 * proportions kept, never enlarged -- a small photo is sent at its own size.
 * Null for an image with no size (a file that did not decode).
 */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number = PHOTO_MAX_SIDE,
): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The address an <img> loads a photo from. The server sends a path
 * ("/api/v1/menu/photos/<id>", "/api/v1/inventory/photos/<id>"), and it is
 * put on the same origin the app's requests go to (lib/api.ts): empty in
 * production, where the page and the API share one, `http://localhost:8000`
 * on a developer's machine. An address that is already whole -- or a `data:`
 * preview of a photo not yet sent -- is taken as it is. Null when there is no
 * photo.
 */
export function photoSrc(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  if (/^(https?:|data:)/i.test(url)) return url;
  const base = origin.replace(/\/+$/, '');
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

/**
 * Small words a name is full of and nobody recognises it by: "Tarta de
 * queso" is TQ, not TD; "Bolsa de hielo", BH.
 */
const MINOR_WORDS = new Set([
  'a', 'al', 'con', 'de', 'del', 'e', 'el', 'en', 'la', 'las', 'lo', 'los', 'o', 'para', 'por', 'sin', 'u', 'un', 'una', 'y',
  'an', 'and', 'of', 'on', 'or', 'the', 'with',
]);

/**
 * What stands in for a missing photo: the name's initials, one or two
 * letters -- "Crispy Grande" is CG, "Tarta de queso" TQ, "Coca-Cola" CC,
 * "Agua" A. Words are what spaces and hyphens separate; a word that starts
 * with a symbol or an emoji is read from its first letter or digit. A name
 * made only of small words is read from them; a name with no letter at all
 * gives its first character.
 */
export function nameInitials(name: string): string {
  const text = name.normalize('NFC').trim();
  const words = text
    .split(/[\s\-‐-―/_.,;:·+&()[\]"'«»“”‘’]+/u)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean);
  const main = words.filter((w) => !MINOR_WORDS.has(w.toLocaleLowerCase('es')));
  const picked = (main.length > 0 ? main : words).slice(0, 2);
  const letters = picked.map((w) => Array.from(w)[0]).join('');
  if (letters) return letters.toLocaleUpperCase('es');
  return (Array.from(text)[0] ?? '').toLocaleUpperCase('es');
}

/**
 * The photo as a dialog holds it until Save: as it was (`keep`), a new one
 * already reduced (`new`, with the `data:` preview the page shows -- the CSP
 * admits `data:` images and not `blob:` ones), or taken off (`none`).
 */
export type PhotoDraft<B = Blob> =
  | { kind: 'keep' }
  | { kind: 'new'; blob: B; preview: string }
  | { kind: 'none' };

/**
 * What saving has to send about the photo, once the thing itself is saved:
 * the new one, the removal of the one it has, or nothing. Taking off a photo
 * it does not have sends nothing.
 */
export function photoWrite<B>(draft: PhotoDraft<B>, hasPhoto: boolean): { kind: 'put'; blob: B } | { kind: 'delete' } | null {
  if (draft.kind === 'new') return { kind: 'put', blob: draft.blob };
  if (draft.kind === 'none' && hasPhoto) return { kind: 'delete' };
  return null;
}

/**
 * What the photo field shows while the dialog is open: the new photo's
 * preview, the saved one while it is kept, nothing once it is taken off.
 * `current` is the saved `photo_url`, null for none (or a thing not saved
 * yet).
 */
export function shownPhoto<B>(draft: PhotoDraft<B>, current: string | null): string | null {
  if (draft.kind === 'new') return draft.preview;
  if (draft.kind === 'keep') return current;
  return null;
}

/** Why a picked file could not be made into a photo (shrinkPhoto.ts). */
export type PhotoProblem = 'unreadable' | 'tooLarge';

/**
 * The photo field's words (components/photo/PhotoField.tsx) come under one of
 * these prefixes: a dish's photo is saved "with the dish", a product's "with
 * the product".
 */
export type PhotoFieldMessages = 'menu.photo' | 'inventory.photo';
export const PHOTO_FIELD_MESSAGES: readonly PhotoFieldMessages[] = ['menu.photo', 'inventory.photo'];

/** Every key the field reads under its prefix: a missing one would show as the key itself. */
export const PHOTO_FIELD_KEYS = [
  'label',
  'add',
  'change',
  'remove',
  'preparing',
  'alt',
  'help',
  'none',
  'pendingNew',
  'pendingRemove',
  'unreadable',
  'tooLarge',
] as const;

/**
 * The sentence under the photo field, as the last part of its key: why the
 * file just picked could not be used, first; then what Save will do (put the
 * new one on, take the saved one off); then, at rest, a word of help with a
 * photo on and what having none means without.
 */
export function photoNote<B>(
  problem: PhotoProblem | null,
  draft: PhotoDraft<B>,
  current: string | null,
): PhotoProblem | 'pendingNew' | 'pendingRemove' | 'help' | 'none' {
  if (problem) return problem;
  if (draft.kind === 'new') return 'pendingNew';
  if (draft.kind === 'none' && current !== null) return 'pendingRemove';
  return shownPhoto(draft, current) !== null ? 'help' : 'none';
}
