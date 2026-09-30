// Writing the absence, and the second call that makes it real.
//
// The failure this guards against is the quietest one in the flow: an absence
// created and left at "requested" looks completely correct. The row is in Time
// off, the sentence reported success, the manager moves on — and `availability`
// treats a requested absence as a WARNING, not a block, so Juanito is still on
// the rota for the week he is ill. A manager saying "Juanito is ill that week"
// is not filing a request with themselves; they are telling us what happened.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { absenceOp, applyRosterOps, type RosterOp } from './ops';
import { absenceType, employee } from '../../test/factories';

vi.mock('../api', () => ({
  api: { post: vi.fn(), patch: vi.fn() },
}));

const SICK = absenceType({ id: 'sick-id', code: 'SICK', name: 'Sick' });
const ROSTER = [
  employee({ id: 'e1', full_name: 'Juanito Pérez' }),
  employee({ id: 'e2', full_name: 'Sarah Chen' }),
];

const post = vi.mocked(api.post);

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ data: { id: 'absence-1' } } as never);
});

const week = (): RosterOp =>
  absenceOp(
    { employee: 'Juanito', from: '2026-10-15', to: '2026-10-22', kind: 'sick' },
    SICK,
  );

describe('recording an absence from a sentence', () => {
  it('creates it and then approves it', async () => {
    const outcome = await applyRosterOps([week()], ROSTER, '2026-10-01');

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toBe('/absences');
    // The approval is what keeps him off the rota. Without it the sentence
    // appears to work and changes nothing the generator can see.
    expect(post.mock.calls[1][0]).toBe('/absences/absence-1/approve');
    expect(outcome.changed).toBe(true);
    expect(outcome.skipped).toEqual([]);
  });

  it('writes the person, the type and both ends of the range', async () => {
    await applyRosterOps([week()], ROSTER, '2026-10-01');

    const body = post.mock.calls[0][1] as Record<string, string>;
    expect(body.employee_id).toBe('e1');
    expect(body.absence_type_id).toBe('sick-id');
    expect(new Date(body.start_at).getDate()).toBe(15);
    expect(new Date(body.end_at).getDate()).toBe(22);
  });

  it('says so rather than writing when nobody matches the name', async () => {
    const outcome = await applyRosterOps(
      [
        absenceOp(
          { employee: 'Nobody At All', from: '2026-10-15', to: '2026-10-15', kind: 'sick' },
          SICK,
        ),
      ],
      ROSTER,
      '2026-10-01',
    );

    expect(post).not.toHaveBeenCalled();
    expect(outcome.changed).toBe(false);
    expect(outcome.skipped).toHaveLength(1);
  });

  it('does not abandon the rest of the sentence when one write fails', async () => {
    post.mockRejectedValueOnce(new Error('500'));
    const outcome = await applyRosterOps(
      [
        week(),
        absenceOp(
          { employee: 'Sarah', from: '2026-10-19', to: '2026-10-19', kind: 'sick' },
          SICK,
        ),
      ],
      ROSTER,
      '2026-10-01',
    );

    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.applied).toHaveLength(1);
    expect(outcome.changed).toBe(true);
  });
});
