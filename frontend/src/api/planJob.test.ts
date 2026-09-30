// Watching a job, without a network and without a clock.
//
// This loop is the one piece of the queue the browser owns. Everything else
// about generation moved to the server, so if this spins forever, polls once
// and gives up, or treats "still going" as "failed", the manager watches a
// panel that is lying to them. A polling loop nobody can test is a polling
// loop that does exactly that in production, which is why `awaitPlanJob` takes
// its reader, its sleeper and its clock as arguments.

import { describe, expect, it } from 'vitest';
import {
  awaitPlanJob,
  collectPlanJob,
  PlanJobFailed,
  planJobIsLive,
  type PlanJob,
  type PlanJobStatus,
} from './schedule';

function job(status: PlanJobStatus, over: Partial<PlanJob> = {}): PlanJob {
  return {
    jobId: 'job-1',
    status,
    months: ['2026-10', '2026-11'],
    done: [],
    failed: [],
    shifts: [],
    shiftsLoaded: true,
    errorCode: null,
    health: { stalled: false, resumed: false },
    source: 'claude',
    model: 'claude-opus-5',
    ...over,
  };
}

/** A reader that hands out a scripted sequence of states, then repeats the last. */
function reader(states: PlanJob[]) {
  const seen: string[] = [];
  /** Whether each read asked for the shifts. Polling must not. */
  const asked: (boolean | undefined)[] = [];
  let i = 0;
  return {
    seen,
    asked,
    read: async (jobId: string, opts?: { shifts?: boolean }) => {
      seen.push(jobId);
      asked.push(opts?.shifts);
      const next = states[Math.min(i, states.length - 1)];
      i += 1;
      // Faithful to the real reader: a light read does not carry the calendar,
      // and saying so is what makes the final full read happen.
      return { ...next, shiftsLoaded: opts?.shifts !== false };
    },
  };
}

/** A sleeper that does not sleep, and a clock that moves when it is asked to. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    wait: async (ms: number) => {
      t += ms;
    },
    get elapsed() {
      return t;
    },
  };
}

describe('awaitPlanJob', () => {
  it('polls until the job settles', async () => {
    const { read, seen } = reader([
      job('running', { done: ['2026-10'] }),
      job('running', { done: ['2026-10'] }),
      job('done', { done: ['2026-10', '2026-11'] }),
    ]);
    const c = clock();

    const out = await awaitPlanJob(job('queued'), { read, ...c, pollMs: 2000 });

    expect(out.status).toBe('done');
    // Three polls and then one full read: the polls ask for counts only, so the
    // calendar has to be fetched once at the end.
    expect(seen).toEqual(['job-1', 'job-1', 'job-1', 'job-1']);
  });

  it('does not ask at all about a job that is already finished', async () => {
    const { read, seen } = reader([job('done')]);
    const shifts = [
      { employeeId: 'e', date: '2026-10-01', start: '09:00', end: '17:00' },
    ];

    const out = await awaitPlanJob(job('done', { done: ['2026-10'], shifts }), {
      read,
      ...clock(),
    });

    expect(out.done).toEqual(['2026-10']);
    // Nothing asked at all: it is terminal AND the calendar is already in hand.
    expect(seen).toEqual([]);
  });

  it('reports progress as months arrive, including the first look', async () => {
    const { read } = reader([
      job('running', { done: ['2026-10'] }),
      job('done', { done: ['2026-10', '2026-11'] }),
    ]);
    const progress: [number, number][] = [];

    await awaitPlanJob(job('queued'), {
      read,
      ...clock(),
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it('counts a month the model refused as one that arrived', async () => {
    // Otherwise a year with one bad month shows a progress bar that never
    // fills, and the panel outlives the work.
    const { read } = reader([job('done', { done: ['2026-10'], failed: ['2026-11'] })]);
    const progress: [number, number][] = [];

    await awaitPlanJob(job('running'), {
      read,
      ...clock(),
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });

  it('keeps asking when a poll fails', async () => {
    // A dropped connection or a token refreshed in another tab is not a job
    // that failed: the work is on the server either way.
    let calls = 0;
    const read = async () => {
      calls += 1;
      if (calls < 3) throw new Error('network');
      return job('done', { done: ['2026-10', '2026-11'] });
    };

    const out = await awaitPlanJob(job('running'), { read, ...clock() });

    expect(out.status).toBe('done');
    // Two failures and the poll that succeeded. No fourth call: this reader
    // hands back a job that already carries its calendar, so there is nothing
    // left to fetch.
    expect(calls).toBe(3);
  });

  it('gives up after the patience runs out, keeping what it saw', async () => {
    // Running out of patience is not an error. The job carries on server-side;
    // this tab stops waiting and builds the rest itself.
    const { read } = reader([job('running', { done: ['2026-10'] })]);
    const c = clock();

    const out = await awaitPlanJob(job('running'), {
      read,
      ...c,
      pollMs: 1000,
      waitMs: 5000,
    });

    expect(out.status).toBe('running');
    expect(out.done).toEqual(['2026-10']);
    expect(c.elapsed).toBeLessThanOrEqual(6000);
  });
});

describe('what polling costs', () => {
  it('asks for counts while it polls and for the calendar once at the end', async () => {
    // A year is on the order of 1.500 shifts; sending them back on every poll
    // would move megabytes to answer "how is it going?".
    const shifts = [
      { employeeId: 'e', date: '2026-10-01', start: '09:00', end: '17:00' },
    ];
    const { read, asked } = reader([
      job('running', { done: ['2026-10'] }),
      job('done', { done: ['2026-10', '2026-11'] }),
      job('done', { done: ['2026-10', '2026-11'], shifts }),
    ]);

    const out = await awaitPlanJob(job('queued'), { read, ...clock() });

    expect(asked.slice(0, -1)).toEqual([false, false]);
    expect(asked[asked.length - 1]).toBe(true);
    expect(out.shifts).toEqual(shifts);
  });

  it('slows down once the first half minute has passed', async () => {
    // The first month lands in about a minute, so the early seconds are where a
    // quick answer is worth a request. After that nobody is watching seconds.
    const states = Array.from({ length: 40 }, () => job('running'));
    const { read, seen } = reader([...states, job('done', { done: ['2026-10'] })]);
    const c = clock();

    await awaitPlanJob(job('running'), { read, ...c, pollMs: 2000 });

    // 30s eager at 2s each is 15 polls; the rest are three times slower, so
    // reaching the 41st state takes far longer than 41 * 2s would.
    expect(seen.length).toBeGreaterThan(15);
    expect(c.elapsed).toBeGreaterThan(41 * 2000);
  });
});

describe('collectPlanJob', () => {
  it('keeps the months a dead job had already written', async () => {
    // The loss the queue exists to end, and it would have come back at the last
    // step: eight of twelve months written and BILLED, the container redeployed
    // twice, the job reaped as abandoned -- and the client throwing all eight
    // away to rebuild the year locally.
    const shifts = [
      { employeeId: 'e', date: '2026-10-01', start: '09:00', end: '17:00' },
    ];
    const out = await collectPlanJob(
      job('failed', {
        errorCode: 'generation_abandoned',
        months: ['2026-10', '2026-11'],
        done: ['2026-10'],
        shifts,
      }),
    );

    expect(out.shifts).toEqual(shifts);
    expect(out.failed).toEqual(['2026-11']);
  });

  it('still throws when a failed job has nothing to show', async () => {
    await expect(
      collectPlanJob(job('failed', { errorCode: 'ai_no_credit' })),
    ).rejects.toBeInstanceOf(PlanJobFailed);
  });

  it('treats every month as unplanned when the calendar could not be read', async () => {
    // Polling asks for counts only, so an unfetched calendar looks exactly like
    // an empty one. Reporting those months as planned would leave them blank on
    // screen with nothing to fill them -- the deterministic pass only covers
    // what it is told is missing.
    const out = await collectPlanJob(
      job('done', {
        months: ['2026-10', '2026-11'],
        done: ['2026-10', '2026-11'],
        shifts: [],
        shiftsLoaded: false,
      }),
    );

    expect(out.shifts).toEqual([]);
    expect(out.failed).toEqual(['2026-10', '2026-11']);
  });

  it('answers about the months that were asked for, not the job own', async () => {
    // Joining a job another tab started: it is planning a year, we asked about
    // one month of it.
    const out = await collectPlanJob(
      job('done', {
        months: ['2026-10', '2026-11', '2026-12'],
        done: ['2026-10', '2026-12'],
        shifts: [
          { employeeId: 'e', date: '2026-10-01', start: '09:00', end: '17:00' },
        ],
      }),
      { want: ['2026-10', '2026-11'] },
    );

    expect(out.failed).toEqual(['2026-11']);
  });

  it('throws with the code when no answer is coming', async () => {
    await expect(
      collectPlanJob(job('failed', { errorCode: 'ai_no_credit' })),
    ).rejects.toBeInstanceOf(PlanJobFailed);
  });

  it('carries the reason so the caller can say which failure it was', async () => {
    const error = await collectPlanJob(
      job('failed', { errorCode: 'generation_abandoned' }),
    ).catch((e: unknown) => e);

    expect((error as PlanJobFailed).code).toBe('generation_abandoned');
  });

  it('treats a month that never arrived as unplanned', async () => {
    const out = await collectPlanJob(
      job('done', { done: ['2026-10'], months: ['2026-10', '2026-11'] }),
    );

    expect(out.failed).toEqual(['2026-11']);
  });
});

describe('planJobIsLive', () => {
  it('is true only while something is still expected', () => {
    expect(planJobIsLive(job('queued'))).toBe(true);
    expect(planJobIsLive(job('running'))).toBe(true);
    expect(planJobIsLive(job('done'))).toBe(false);
    expect(planJobIsLive(job('failed'))).toBe(false);
  });
});

describe('the health of a job travels to the panel', () => {
  it('reports a silent worker, then the resume, while it waits', async () => {
    const seen: unknown[] = [];
    const reads = [
      job('running', { health: { stalled: true, resumed: false } }),
      job('running', { health: { stalled: false, resumed: true } }),
      job('done', { done: ['2026-10', '2026-11'], health: { stalled: false, resumed: true } }),
    ];
    await awaitPlanJob(job('running'), {
      read: async () => reads.shift()!,
      wait: async () => {},
      onProgress: (_done, _total, health) => seen.push(health),
    });
    expect(seen).toEqual([
      { stalled: false, resumed: false },
      { stalled: true, resumed: false },
      { stalled: false, resumed: true },
      { stalled: false, resumed: true },
    ]);
  });
});
