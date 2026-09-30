// A dish's photo, as far as it can be worked out without a browser. What a
// photo is -- where it is served from, what stands in for it, how big the
// uploaded copy gets, what saving sends -- is the same for a product of the
// stock, and lives in lib/photo/photo.ts; it is re-exported here for the
// menu's callers. What is the menu's alone stays here: how a till tile wears
// its photo (components/menu/TillTile.tsx).

export {
  fitWithin,
  nameInitials as dishInitials,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_SIDE,
  PHOTO_QUALITIES,
  photoSrc,
  photoWrite,
  type PhotoDraft,
} from '../photo/photo';

/**
 * What a till tile (components/menu/TillTile.tsx) prints over itself. A photo
 * on screen fills the tile, and the price goes over it; so does the name,
 * unless the photo has it printed already (`photo_labelled`: Casa Demo's,
 * cut from its till) -- printed again it would read twice, one over the
 * other. No photo, or one that did not load: the light tile, name and price
 * in dark ink, as the till shows its water. The name is always in the tile's
 * words for a screen reader, printed or not.
 */
export function tileFace(photoShown: boolean, photoLabelled: boolean): { light: boolean; printName: boolean } {
  return { light: !photoShown, printName: !photoShown || !photoLabelled };
}
