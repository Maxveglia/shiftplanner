import { describe, expect, it } from 'vitest';
import { emptyTicket, type Ticket } from './ticket';
import {
  clearTillDraft,
  draftExpired,
  readTillDraft,
  readTillMode,
  tillModeFor,
  tillModes,
  saveTillDraft,
  saveTillMode,
  tillDraftKey,
  TILL_DRAFT_MAX_AGE_MS,
  TILL_DRAFT_VERSION,
  TILL_MODE_KEY,
} from './tillDraft';

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

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

const scope = { orgId: 'org', userId: 'me' };

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    ...emptyTicket('ref-1'),
    lines: [{ dishId: 'd-grande', name: 'Crispy Grande', priceCents: 1000, quantity: 2 }],
    ...over,
  };
}

describe('the bill kept in the browser', () => {
  it('comes back as it was written, ref included', () => {
    const s = memory();
    expect(saveTillDraft(s, scope, ticket(), new Date('2026-09-27T10:00:00Z'))).toBe('saved');
    expect(readTillDraft(s, scope)).toEqual({ ticket: ticket(), savedAt: '2026-09-27T10:00:00.000Z' });
  });

  it('is one per workspace and person, and apart from the sale typed on Sales', () => {
    const s = memory();
    saveTillDraft(s, scope, ticket());
    expect(readTillDraft(s, { orgId: 'org', userId: 'someone-else' })).toBeNull();
    expect(readTillDraft(s, { orgId: 'other-org', userId: 'me' })).toBeNull();
    expect(tillDraftKey(scope)).not.toContain('saleDraft');
  });

  it('is removed, not stored empty, when the bill is emptied or charged', () => {
    const s = memory();
    saveTillDraft(s, scope, ticket());
    expect(saveTillDraft(s, scope, ticket({ lines: [], clientRef: 'ref-2' }))).toBe('cleared');
    expect(s.data.has(tillDraftKey(scope))).toBe(false);
    expect(readTillDraft(s, scope)).toBeNull();
  });

  it('ignores another version, broken JSON and a bill of the wrong shape', () => {
    const s = memory();
    const put = (value: unknown) => s.setItem(tillDraftKey(scope), JSON.stringify(value));
    put({ version: TILL_DRAFT_VERSION + 1, ticket: ticket() });
    expect(readTillDraft(s, scope)).toBeNull();
    s.setItem(tillDraftKey(scope), '{"version":1,"ticket":');
    expect(readTillDraft(s, scope)).toBeNull();
    put({ version: TILL_DRAFT_VERSION, ticket: { ...ticket(), clientRef: '' } });
    expect(readTillDraft(s, scope)).toBeNull();
    // A price in euros where cents go, half a unit, none at all, no dish.
    for (const line of [
      { dishId: 'd', name: 'x', priceCents: 10.5, quantity: 1 },
      { dishId: 'd', name: 'x', priceCents: 1000, quantity: 1.5 },
      { dishId: 'd', name: 'x', priceCents: 1000, quantity: 0 },
      { dishId: '', name: 'x', priceCents: 1000, quantity: 1 },
      { name: 'x', priceCents: 1000, quantity: 1 },
    ]) {
      put({ version: TILL_DRAFT_VERSION, ticket: { ...ticket(), lines: [line] } });
      expect(readTillDraft(s, scope)).toBeNull();
    }
  });

  it('keeps what the card reader approved, so a retry does not take the card again', () => {
    const s = memory();
    const approved = ticket({ cardApproval: { clientRef: 'ref-1', amountCents: 2000 } });
    saveTillDraft(s, scope, approved, new Date('2026-09-27T10:00:00Z'));
    expect(readTillDraft(s, scope)?.ticket).toEqual(approved);
  });

  it('drops an approval that does not read, not the bill with it', () => {
    const s = memory();
    const put = (value: unknown) => s.setItem(tillDraftKey(scope), JSON.stringify(value));
    for (const cardApproval of [{ clientRef: '', amountCents: 2000 }, { clientRef: 'ref-1', amountCents: 20.5 }, 'yes', null]) {
      put({ version: TILL_DRAFT_VERSION, savedAt: '2026-09-27T10:00:00.000Z', ticket: { ...ticket(), cardApproval } });
      expect(readTillDraft(s, scope)?.ticket).toEqual(ticket());
    }
  });

  it('comes back with what a bill is made of and nothing else', () => {
    const s = memory();
    s.setItem(
      tillDraftKey(scope),
      JSON.stringify({ version: TILL_DRAFT_VERSION, savedAt: 'x', ticket: { ...ticket(), extra: 1, lines: [{ ...ticket().lines[0], note: 'x' }] } }),
    );
    expect(readTillDraft(s, scope)?.ticket).toEqual(ticket());
  });

  it('carries on when the storage refuses, or there is none', () => {
    expect(saveTillDraft(broken, scope, ticket())).toBe('failed');
    expect(readTillDraft(broken, scope)).toBeNull();
    expect(() => clearTillDraft(broken, scope)).not.toThrow();
    expect(saveTillDraft(null, scope, ticket())).toBe('failed');
    expect(readTillDraft(null, scope)).toBeNull();
  });

  it('is forgotten after a charge only when it is the bill that was charged', () => {
    const s = memory();
    saveTillDraft(s, scope, ticket({ clientRef: 'ref-next' }));
    // The answer for ref-1 comes back after the next bill was started.
    clearTillDraft(s, scope, 'ref-1');
    expect(readTillDraft(s, scope)?.ticket.clientRef).toBe('ref-next');
    clearTillDraft(s, scope, 'ref-next');
    expect(readTillDraft(s, scope)).toBeNull();
  });
});

describe('a bill left too long', () => {
  const at = new Date('2026-09-27T10:00:00Z');

  it('is a service’s bill up to 12 hours after its last change, and last night’s after', () => {
    expect(TILL_DRAFT_MAX_AGE_MS).toBe(12 * 60 * 60 * 1000);
    expect(draftExpired('2026-09-27T10:00:00.000Z', at)).toBe(false);
    expect(draftExpired('2026-09-26T22:00:00.000Z', at)).toBe(false);
    expect(draftExpired('2026-09-26T21:59:00.000Z', at)).toBe(true);
    expect(draftExpired('2026-09-25T10:00:00.000Z', at)).toBe(true);
  });

  it('is too old when its time does not read, and not when it is ahead of the clock', () => {
    expect(draftExpired('', at)).toBe(true);
    expect(draftExpired('yesterday', at)).toBe(true);
    expect(draftExpired('2026-09-27T12:00:00.000Z', at)).toBe(false);
  });
});

describe('the mode of the tab', () => {
  it('is charging unless the tab was editing the menu', () => {
    const s = memory();
    expect(readTillMode(s)).toBe('charge');
    saveTillMode(s, 'edit');
    expect(s.data.get(TILL_MODE_KEY)).toBe('edit');
    expect(readTillMode(s)).toBe('edit');
    saveTillMode(s, 'charge');
    expect(readTillMode(s)).toBe('charge');
    s.setItem(TILL_MODE_KEY, 'something else');
    expect(readTillMode(s)).toBe('charge');
  });

  it('carries on without storage', () => {
    expect(readTillMode(null)).toBe('charge');
    expect(readTillMode(broken)).toBe('charge');
    expect(() => saveTillMode(broken, 'edit')).not.toThrow();
    expect(() => saveTillMode(null, 'edit')).not.toThrow();
  });
});

describe('the modes an account has', () => {
  it('is both for the manager, charging first, as the switch lists them', () => {
    expect(tillModes(true, true)).toEqual(['charge', 'edit']);
  });

  it('is only charging for an employee and a shop account: no switch at all', () => {
    expect(tillModes(true, false)).toEqual(['charge']);
  });

  it('is none for an account that may do neither: the menu to read', () => {
    expect(tillModes(false, false)).toEqual([]);
    expect(tillModeFor('charge', [])).toBeNull();
    expect(tillModeFor('edit', [])).toBeNull();
  });

  it("keeps the tab's mode when the account has it", () => {
    expect(tillModeFor('edit', ['charge', 'edit'])).toBe('edit');
    expect(tillModeFor('charge', ['charge', 'edit'])).toBe('charge');
  });

  it('never opens "Edit menu" for an account without it, whatever the tab kept', () => {
    // A manager signed in on this tablet before, and left it in "Edit menu".
    expect(tillModeFor('edit', ['charge'])).toBe('charge');
    expect(tillModeFor('charge', ['edit'])).toBe('edit');
  });
});
