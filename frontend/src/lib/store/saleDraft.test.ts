import { describe, expect, it } from 'vitest';
import { emptySale, type SaleDraft } from './sale';
import { clearSaleDraft, readSaleDraft, saleDraftKey, saveSaleDraft, SALE_DRAFT_VERSION } from './saleDraft';

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const scope = { orgId: 'org', userId: 'me' };

function draft(over: Partial<SaleDraft> = {}): SaleDraft {
  return {
    ...emptySale('2026-09-27', 'ref-1'),
    lines: [{ key: 'k1', dishId: 'd1', name: 'Croquetas', price: '6,50', quantity: '2' }],
    ...over,
  };
}

describe('the sale draft', () => {
  it('comes back as it was written, ref included', () => {
    const s = memory();
    expect(saveSaleDraft(s, scope, draft(), new Date('2026-09-27T10:00:00Z'))).toBe('saved');
    expect(readSaleDraft(s, scope)).toEqual({ draft: draft(), savedAt: '2026-09-27T10:00:00.000Z' });
  });

  it('is one per workspace and person', () => {
    const s = memory();
    saveSaleDraft(s, scope, draft());
    expect(readSaleDraft(s, { orgId: 'org', userId: 'someone-else' })).toBeNull();
    expect(readSaleDraft(s, { orgId: 'other-org', userId: 'me' })).toBeNull();
  });

  it('is removed, not stored empty, when the form is emptied', () => {
    const s = memory();
    saveSaleDraft(s, scope, draft());
    expect(saveSaleDraft(s, scope, draft({ lines: [] }))).toBe('cleared');
    expect(s.data.has(saleDraftKey(scope))).toBe(false);
  });

  it('ignores another version, broken JSON and a draft of the wrong shape', () => {
    const s = memory();
    s.setItem(saleDraftKey(scope), JSON.stringify({ version: SALE_DRAFT_VERSION + 1, draft: draft() }));
    expect(readSaleDraft(s, scope)).toBeNull();
    s.setItem(saleDraftKey(scope), '{"version":1,"draft":');
    expect(readSaleDraft(s, scope)).toBeNull();
    s.setItem(saleDraftKey(scope), JSON.stringify({ version: SALE_DRAFT_VERSION, draft: { ...draft(), lines: [{ key: 1 }] } }));
    expect(readSaleDraft(s, scope)).toBeNull();
    s.setItem(saleDraftKey(scope), JSON.stringify({ version: SALE_DRAFT_VERSION, draft: { ...draft(), clientRef: '' } }));
    expect(readSaleDraft(s, scope)).toBeNull();
  });

  it('carries on when the storage refuses', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(saveSaleDraft(broken, scope, draft())).toBe('failed');
    expect(readSaleDraft(broken, scope)).toBeNull();
    expect(() => clearSaleDraft(broken, scope)).not.toThrow();
    expect(saveSaleDraft(null, scope, draft())).toBe('failed');
    expect(readSaleDraft(null, scope)).toBeNull();
  });

  it('clears only the draft of the sale that was saved', () => {
    const s = memory();
    saveSaleDraft(s, scope, draft({ clientRef: 'next-sale' }));
    // The answer for the previous sale arrives late: the new draft stays.
    clearSaleDraft(s, scope, 'ref-1');
    expect(readSaleDraft(s, scope)?.draft.clientRef).toBe('next-sale');
    clearSaleDraft(s, scope, 'next-sale');
    expect(readSaleDraft(s, scope)).toBeNull();
  });
});
