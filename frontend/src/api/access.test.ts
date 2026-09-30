import { describe, expect, it } from 'vitest';
import { orphanAccountPath, parseAccessOverview } from './access';

describe('parseAccessOverview', () => {
  it('keeps the lists and reads the table of roles as every list of permissions is read', () => {
    const overview = parseAccessOverview({
      managers: [{ id: 'm', full_name: 'Max', email: 'max@x.com', created_at: '2026-09-01T10:00:00Z' }],
      employees: [{ employee_id: 'e', name: 'Ana', email: null, account: null }],
      stores: [],
      orphans: [
        {
          id: 'o',
          full_name: 'Luis',
          email: 'luis@x.com',
          created_at: '2026-01-01T10:00:00Z',
          last_seen_at: null,
        },
      ],
      roles: {
        manager: ['access.manage', 'inventory.view'],
        employee: ['inventory.view', 'future.thing'],
        store: ['inventory.view'],
      },
    });
    expect(overview.managers).toHaveLength(1);
    expect(overview.employees[0].account).toBeNull();
    expect(overview.orphans).toEqual([
      { id: 'o', full_name: 'Luis', email: 'luis@x.com', created_at: '2026-01-01T10:00:00Z', last_seen_at: null },
    ]);
    expect(overview.roles).toEqual({
      manager: ['inventory.view', 'access.manage'],
      employee: ['inventory.view'],
      store: ['inventory.view'],
    });
  });

  it('reads a body missing parts as empty lists and roles that may do nothing', () => {
    expect(parseAccessOverview({})).toEqual({
      managers: [],
      employees: [],
      stores: [],
      orphans: [],
      roles: { manager: [], employee: [], store: [] },
    });
    expect(parseAccessOverview(null).stores).toEqual([]);
  });

  it('reads a server a release behind, which sends no old accounts, as none', () => {
    expect(parseAccessOverview({ managers: [], employees: [], stores: [], roles: {} }).orphans).toEqual([]);
    expect(parseAccessOverview({ orphans: 'nope' }).orphans).toEqual([]);
  });
});

describe('orphanAccountPath', () => {
  it('is the access window’s own, under the API’s base', () => {
    expect(orphanAccountPath('9b2f4c1e-0000-4000-8000-000000000001')).toBe(
      '/access/accounts/9b2f4c1e-0000-4000-8000-000000000001',
    );
  });

  it('cannot be walked out of by an id', () => {
    expect(orphanAccountPath('../stores/x')).toBe('/access/accounts/..%2Fstores%2Fx');
  });
});
