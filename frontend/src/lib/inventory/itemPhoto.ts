// Saving a product of the stock with its photo: two requests, in this order.
//
// The photo has its own address (PUT and DELETE on
// /inventory/items/{id}/photo), and a new product has none until it is
// created; so the product is saved first -- created, or its fields updated --
// and then, when it changed, its photo. As the menu's dishes are
// (StoreMenuPage's DishModal).
//
// The two can end apart: the product saved and its photo not (the network
// went, the file was refused). That is an outcome of its own, carrying the
// product as the server now has it, so the dialog can stay open with the
// photo still picked, say so, and -- holding the product it created -- send
// only an update and the photo on the next Save, never a second product.

import { photoWrite, type PhotoDraft } from '../photo/photo';

export type ItemSaveOutcome<I> =
  /** Both done: the dialog closes. */
  | { kind: 'saved'; item: I }
  /** The product itself was refused: nothing was sent about its photo. */
  | { kind: 'itemFailed'; error: unknown }
  /** The product is saved (created, for a new one); its photo is not. */
  | { kind: 'photoFailed'; item: I; error: unknown };

export async function saveItemWithPhoto<I extends { id: string; photo_url?: string | null }, B>({
  save,
  photo,
  put,
  remove,
}: {
  /** Creates the product, or updates it; answers with it as the server has it. */
  save: () => Promise<I>;
  photo: PhotoDraft<B>;
  put: (itemId: string, blob: B) => Promise<unknown>;
  remove: (itemId: string) => Promise<unknown>;
}): Promise<ItemSaveOutcome<I>> {
  let item: I;
  try {
    item = await save();
  } catch (error) {
    return { kind: 'itemFailed', error };
  }
  // Whether it has a photo by the server's answer, not by what the dialog
  // opened with: taking off a photo it no longer has sends nothing.
  const write = photoWrite(photo, Boolean(item.photo_url));
  try {
    if (write?.kind === 'put') await put(item.id, write.blob);
    else if (write?.kind === 'delete') await remove(item.id);
  } catch (error) {
    return { kind: 'photoFailed', item, error };
  }
  return { kind: 'saved', item };
}
