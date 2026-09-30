// The bench itself: twelve shops, one configuration, one table.
//
// rotaQuality knows how to score ONE calendar. This file is what you point at
// a configuration -- an objective, a prompt, a model, a generator -- and get
// back a row per scenario, ready to be pinned, printed, or held up against the
// run somebody did before the change.
//
// THE TWELVE ARE NOT NEW. They are the same briefs objective.identity and
// objective.profiles already pin, and that is the point: they were written to
// disagree with each other -- a shop with a lunch dip, a team too small for
// its own week, a pending request standing in front of the cheap option -- so
// a configuration that is worse in only one of those ways still has somewhere
// to show it. A bench with its own dozen happy-path shops would report green
// for every change anybody ever made.
//
// TWO WAYS IN, because there are two things we will want to compare.
// `measureGenerated` runs the deterministic generator and scores what comes
// out: that is the baseline, it costs nothing, and it is what tells us whether
// a change to the RULES moved the rota. `measureProposals` scores calendars
// that arrived from somewhere else -- a model, a cheaper prompt, a recorded
// response replayed from disk -- against exactly the same briefs. The second
// is why the bench exists; the first is what gives it a line to measure from.

import { SCENARIOS, runInputs } from './objectiveScenarios';
import { measureRota, type RotaMetrics } from './rotaQuality';
import type { Assignment, SchedulingObjective } from '../lib/schedule/types';

/** Every scenario's name, in the order the bench reports them. */
export const BENCH_SCENARIOS: readonly string[] = SCENARIOS.map((s) => s.name);

/**
 * The baseline: what the deterministic greedy generator makes of each brief.
 *
 * Not a claim that this is the BEST rota -- generate.ts is greedy and says so,
 * and several of these scenarios have uncovered hours it cannot avoid. It is a
 * claim that this is the rota we ship today, measured, so that anything
 * proposed in its place can be compared against something real instead of
 * against a hope.
 */
export function measureGenerated(objective?: SchedulingObjective): RotaMetrics[] {
  return SCENARIOS.map((scenario) => {
    // One inputs object, used to build AND to judge. Building a second one
    // would be building a second shop, and every number below would be about
    // the wrong one the first time somebody edited a brief by hand.
    const inputs = scenario.inputs(objective);
    const result = runInputs(inputs);
    return measureRota(scenario.name, result.assignments, inputs);
  });
}

/**
 * The baseline calendars themselves, keyed by scenario.
 *
 * The shape `measureProposals` takes, so that a recorded model response and a
 * generated rota can be held side by side in the same variable. It is also how
 * a real A/B will be run: generate once, keep the shifts on disk, and score
 * them again next month without asking anybody for another calendar.
 */
export function generatedProposals(
  objective?: SchedulingObjective,
): Record<string, Assignment[]> {
  const out: Record<string, Assignment[]> = {};
  for (const scenario of SCENARIOS) {
    out[scenario.name] = runInputs(scenario.inputs(objective)).assignments;
  }
  return out;
}

/**
 * Score calendars that came from somewhere other than the generator.
 *
 * Keyed by scenario name, and a scenario with no proposal is SKIPPED rather
 * than scored as empty. A model that returned nothing for one shop has failed
 * in a way this bench is not equipped to price -- a blank calendar covers
 * nothing and breaks no rule, so it would score as legal with 100% uncovered
 * and drag an average around -- and the honest report is that the row is
 * missing. `compareSuites` already says so out loud.
 */
export function measureProposals(
  proposals: Record<string, Assignment[]>,
  objective?: SchedulingObjective,
): RotaMetrics[] {
  const out: RotaMetrics[] = [];
  for (const scenario of SCENARIOS) {
    const assignments = proposals[scenario.name];
    if (!assignments) continue;
    out.push(measureRota(scenario.name, assignments, scenario.inputs(objective)));
  }
  return out;
}
