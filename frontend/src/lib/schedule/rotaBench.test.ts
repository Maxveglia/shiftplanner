// The baseline, pinned -- and the ratchet that stops it slipping.
//
// WHAT THIS FILE IS FOR. We are about to make generation cheaper by asking the
// model for less effort and less output. Every one of those changes is a bet
// that the calendar stays good enough, and until now the only way to settle
// such a bet was to spend money generating real rotas and then argue about
// screenshots. This suite settles it offline: twelve shops, measured, against
// the numbers the same twelve produced before the change.
//
// IT IS A RATCHET, NOT AN EQUALITY. objective.identity next door pins the
// calendar assignment by assignment, which is right for a refactor that must
// change nothing. This one pins QUALITY, and only fails when quality drops:
// a change that covers more hours or honours more contracts passes, and says
// so. Pinning equality here would make every deliberate improvement a red
// test, and a suite that goes red for good news gets regenerated without being
// read.
//
// The bill is reported and never failed on, for the reason written up on
// ECONOMIC_AXES in rotaQuality: a cheaper way of generating is allowed to cost
// more to run, and it is the manager's call, not a test's.
//
// TO READ THE NUMBERS RATHER THAN ASSERT THEM:
//
//     ROTA_BENCH=1 npx vitest run src/lib/schedule/rotaBench.test.ts
//
// which prints the baseline table and one worked A/B. To adopt a new baseline
// -- deliberately, having read what moved -- add ROTA_BENCH_WRITE=1.

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BENCH_SCENARIOS,
  generatedProposals,
  measureGenerated,
  measureProposals,
} from '../../test/rotaBench';
import {
  compareSuites,
  formatComparison,
  formatMetricsTable,
  type RotaMetrics,
} from '../../test/rotaQuality';
import { OBJECTIVES } from './objective';
import type { Assignment } from './types';
import fixture from './rotaBench.fixture.json';

const pinned = fixture as unknown as RotaMetrics[];

// Measured once for the whole file. The generator is deterministic, so running
// it per test would only make the suite slower and invite somebody to wonder
// whether two of these rows came from different calendars.
const baseline = measureGenerated();

describe('the rota quality bench', () => {
  it('has a pinned row for every scenario, and no orphans', () => {
    // A scenario that quietly stopped being measured is the failure that makes
    // every other assertion here meaningless: the bench would go green because
    // it stopped looking, not because nothing broke.
    expect(baseline.map((m) => m.scenario)).toEqual([...BENCH_SCENARIOS]);
    expect(pinned.map((m) => m.scenario)).toEqual([...BENCH_SCENARIOS]);
  });

  it('builds a legal calendar for every brief but the one the brief itself breaks', () => {
    // The one assertion that is absolute rather than comparative. A hard
    // violation is not a quality score that drifted; it is a rota that may not
    // be shown to anybody, and the generator must never produce one.
    //
    // It comes with an exception, found by this bench on its first run and
    // written down here rather than waved through. The pinned scenario replays
    // seven shifts the manager placed, and objectiveScenarios' `pin` stamps
    // them `tpl-pinned` -- a template id no org in that brief owns. The
    // generator copies pins through untouched, so validate.ts sees seven
    // shifts pointing at a template that does not exist and calls them what
    // they are.
    //
    // It is an artefact of the brief and not of the product: a real pin comes
    // from `manualShift`, which stamps `band-${key}`, and validate.ts accepts
    // those precisely because most businesses define no templates at all. The
    // brief cannot simply be corrected, because that id is inside
    // objective.identity.fixture.json and objective.profiles.fixture.json, and
    // those two pin the refactor that moved the scoring weights -- regenerating
    // them to tidy a test id would throw away the only proof that the default
    // calendar never moved.
    //
    // So it is pinned EXACTLY: seven, of one kind, in one scenario. An eighth,
    // a second kind, or a second scenario fails this test, which is the whole
    // point of spelling it out instead of loosening the rule.
    expect(
      baseline.filter((m) => m.hard > 0).map((m) => [m.scenario, m.hardByKind]),
    ).toEqual([
      ['a half-worked week already pinned, with room to choose', { unknown_template: 7 }],
    ]);
  });

  it('has not got worse than the pinned baseline', () => {
    const cmp = compareSuites(pinned, baseline);
    // The whole comparison rides along as the failure message, because a red
    // build here has to be actionable from the CI log alone: which shop, which
    // axis, by how much. It is not asserted on -- the verdict line leads with
    // the known `unknown_template` pins above, and a test that read that line
    // for a word would be asserting on a sentence rather than on a number.
    expect(cmp.worse, formatComparison(cmp, 'pinned', 'now')).toBe(false);
    expect(cmp.missing).toEqual([]);
    expect(cmp.added).toEqual([]);
  });

  it('is not silently better than the baseline it is measured against', () => {
    // An improvement passes the ratchet above, and then the fixture is stale
    // and the next regression has a lower bar to clear. So it passes here too,
    // and says out loud that the baseline wants adopting.
    const improved = compareSuites(pinned, baseline).scenarios.filter((s) => s.better);
    if (improved.length) {
      console.log(
        `\nThe baseline improved on ${improved.length} scenario(s): ` +
          `${improved.map((s) => s.scenario).join('; ')}.\n` +
          'Re-pin it with ROTA_BENCH_WRITE=1 once you have read what moved.\n',
      );
    }
    expect(improved.every((s) => !s.worse)).toBe(true);
  });
});

describe('the bench compares two configurations', () => {
  // The A/B we can run today without spending anything: the default objective
  // against `cheapest`, which is a real, shipped configuration whose whole
  // point is to trade something for money. It stands in for the comparison we
  // are actually building this for -- today's prompt against a cheaper one --
  // and it exercises the same code path with a B that genuinely differs.
  const cheapest = measureGenerated(OBJECTIVES.cheapest);
  const cmp = compareSuites(baseline, cheapest);
  const proposals = generatedProposals();

  it('measures both sides of the same twelve briefs', () => {
    expect(cmp.missing).toEqual([]);
    expect(cmp.added).toEqual([]);
    expect(cmp.scenarios).toHaveLength(BENCH_SCENARIOS.length);
  });

  it('finds something to say: a profile that changed nothing measurable is worth knowing about', () => {
    expect(
      cmp.scenarios.some((s) => s.quality.length > 0 || s.economics.length > 0),
    ).toBe(true);
  });

  it('catches a calendar that quietly stopped trying', () => {
    // The property the whole bench stands or falls on, and the one thing none
    // of the assertions above actually prove: that a WORSE calendar comes back
    // worse. Everything else here says the numbers are stable, which a bench
    // that measured nothing at all would also manage.
    //
    // The degradation is the one a cheaper configuration really produces --
    // fewer shifts written, the shop left thinner -- applied to the baseline
    // itself so that nothing else about the calendar differs. Every fifth
    // shift is dropped, which is small enough to be a plausible regression and
    // large enough that a bench worth running must not miss it.
    const thinned: Record<string, Assignment[]> = {};
    for (const [name, shifts] of Object.entries(proposals)) {
      thinned[name] = shifts.filter((_, i) => i % 5 !== 0);
    }
    const cmp = compareSuites(baseline, measureProposals(thinned));
    expect(cmp.worse).toBe(true);
    // Not "at least one": a shop that lost a fifth of its shifts is worse in
    // most of the twelve, and a bench that only noticed in one of them would
    // be reporting a coincidence.
    expect(cmp.scenarios.filter((s) => s.worse).length).toBeGreaterThanOrEqual(8);
  });

  it('prints a table when a person is asking', () => {
    if (!process.env.ROTA_BENCH) return;
    console.log(`\n${formatMetricsTable(baseline, 'baseline — default objective')}\n`);
    console.log(`\n${formatMetricsTable(cheapest, 'objective: cheapest')}\n`);
    console.log(`\n${formatComparison(cmp, 'default', 'cheapest')}\n`);
  });

  it('re-pins the baseline when asked to, and never otherwise', () => {
    if (!process.env.ROTA_BENCH_WRITE) return;
    writeFileSync(
      new URL('./rotaBench.fixture.json', import.meta.url),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    console.log('\nrotaBench.fixture.json rewritten from this run.\n');
  });
});
