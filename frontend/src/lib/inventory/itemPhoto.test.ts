import { describe, expect, it } from 'vitest';
import type { PhotoDraft } from '../photo/photo';
import { saveItemWithPhoto } from './itemPhoto';

interface Item {
  id: string;
  photo_url?: string | null;
}

/** What the fake server was asked, in order. */
function server(opts: { item?: Item; saveFails?: boolean; putFails?: boolean; removeFails?: boolean } = {}) {
  const calls: string[] = [];
  const item = opts.item ?? { id: 'p1', photo_url: null };
  return {
    calls,
    save: async () => {
      calls.push('save');
      if (opts.saveFails) throw new Error('product refused');
      return item;
    },
    put: async (id: string, blob: string) => {
      calls.push(`put ${id} ${blob}`);
      if (opts.putFails) throw new Error('photo refused');
    },
    remove: async (id: string) => {
      calls.push(`delete ${id}`);
      if (opts.removeFails) throw new Error('photo not removed');
    },
  };
}

const NEW: PhotoDraft<string> = { kind: 'new', blob: 'jpeg', preview: 'data:image/jpeg;base64,AA' };
const KEEP: PhotoDraft<string> = { kind: 'keep' };
const NONE: PhotoDraft<string> = { kind: 'none' };

describe('saveItemWithPhoto', () => {
  it('creates the product first and then puts its photo on it', async () => {
    const s = server({ item: { id: 'new-1', photo_url: null } });
    const outcome = await saveItemWithPhoto({ save: s.save, photo: NEW, put: s.put, remove: s.remove });
    expect(s.calls).toEqual(['save', 'put new-1 jpeg']);
    expect(outcome).toEqual({ kind: 'saved', item: { id: 'new-1', photo_url: null } });
  });

  it('keeps the product saved and says the photo failed when only the photo fails', async () => {
    const s = server({ item: { id: 'new-1', photo_url: null }, putFails: true });
    const outcome = await saveItemWithPhoto({ save: s.save, photo: NEW, put: s.put, remove: s.remove });
    expect(s.calls).toEqual(['save', 'put new-1 jpeg']);
    expect(outcome.kind).toBe('photoFailed');
    if (outcome.kind !== 'photoFailed') return;
    // The product the server created, so the next Save updates it rather
    // than creating a second one.
    expect(outcome.item).toEqual({ id: 'new-1', photo_url: null });
    expect((outcome.error as Error).message).toBe('photo refused');
  });

  it('sends nothing about the photo when the product itself is refused', async () => {
    const s = server({ saveFails: true });
    const outcome = await saveItemWithPhoto({ save: s.save, photo: NEW, put: s.put, remove: s.remove });
    expect(s.calls).toEqual(['save']);
    expect(outcome.kind).toBe('itemFailed');
  });

  it('saves only the product when the photo was left alone', async () => {
    const s = server({ item: { id: 'p1', photo_url: '/api/v1/inventory/photos/a' } });
    const outcome = await saveItemWithPhoto({ save: s.save, photo: KEEP, put: s.put, remove: s.remove });
    expect(s.calls).toEqual(['save']);
    expect(outcome.kind).toBe('saved');
  });

  it('takes the photo off a product that has one', async () => {
    const s = server({ item: { id: 'p1', photo_url: '/api/v1/inventory/photos/a' } });
    const outcome = await saveItemWithPhoto({ save: s.save, photo: NONE, put: s.put, remove: s.remove });
    expect(s.calls).toEqual(['save', 'delete p1']);
    expect(outcome.kind).toBe('saved');
  });

  it('sends no removal for a product the server says has no photo (or does not say)', async () => {
    const without = server({ item: { id: 'p1', photo_url: null } });
    await saveItemWithPhoto({ save: without.save, photo: NONE, put: without.put, remove: without.remove });
    expect(without.calls).toEqual(['save']);

    // A server older than the field: no `photo_url` at all.
    const older = server({ item: { id: 'p2' } });
    await saveItemWithPhoto({ save: older.save, photo: NONE, put: older.put, remove: older.remove });
    expect(older.calls).toEqual(['save']);
  });

  it('reports a failed removal as the photo failing, with the product saved', async () => {
    const s = server({ item: { id: 'p1', photo_url: '/api/v1/inventory/photos/a' }, removeFails: true });
    const outcome = await saveItemWithPhoto({ save: s.save, photo: NONE, put: s.put, remove: s.remove });
    expect(s.calls).toEqual(['save', 'delete p1']);
    expect(outcome.kind).toBe('photoFailed');
  });

  it('replaces the photo of a product that already has one', async () => {
    const s = server({ item: { id: 'p1', photo_url: '/api/v1/inventory/photos/old' } });
    const outcome = await saveItemWithPhoto({ save: s.save, photo: NEW, put: s.put, remove: s.remove });
    expect(s.calls).toEqual(['save', 'put p1 jpeg']);
    expect(outcome.kind).toBe('saved');
  });
});
