// The weights the generator scores with, and what they were before they had a
// name.
//
// Every number below was a literal sitting inside one of the two scoring
// expressions in ./generate. They were duplicated across the two passes with
// different values, which made the pair impossible to reason about: reading one
// told you nothing about the other, and changing one silently left the calendar
// half-tuned. Naming them for what they mean to a BUSINESS -- rather than for
// the local variable each happened to multiply -- is what makes the next step
// possible, where a manager picks an objective in a sentence instead of a
// number.
//
// That step is `OBJECTIVES` at the foot of this file. The default began with
// no policy of its own: `DEFAULT_OBJECTIVE` was exactly the calendar the
// constants produced, to the assignment, and objective.identity is what proved
// it. It has since taken two decisions on purpose -- nights and weekends shared
// out (`spreadUnsocial`), and the wage allowed to weigh but not to decide who
// works (`preferCheaperPeople`) -- and objective.identity's header records,
// scenario by scenario, what each one moved. The four named profiles hold the
// rest of the policy, which is why each one starts from the default and moves
// only the weights its own sentence pays for.

import type { SchedulingObjective } from './types';

/**
 * What the generator optimised for before anyone could choose.
 *
 * Not a recommendation and not a balanced starting point -- just the set of
 * numbers that had accumulated in the code, preserved so that adding the dial
 * changes no existing customer's rota. Treat a change here as a change to every
 * business that never picked an objective.
 */
export const DEFAULT_OBJECTIVE: SchedulingObjective = {
  // Coverage pass.
  wageSensitivity: 1,
  /*
   * The second weight here that is not what the constants produced, and the
   * one the owner asked for in a sentence: "que el coste pese pero no mande;
   * que manden las indicaciones que da el manager". Until it existed the whole
   * wage sat under `wageSensitivity` at 1, where a candidate's cost term is
   * roughly their hourly rate -- 20 points for somebody on 20 an hour, against
   * `spreadHours` at 0.6 per hour they have already worked. Two people 8 an
   * hour apart were then 8 points apart, and the cheaper one kept the hour
   * until they were more than thirteen hours ahead of the other. That is the
   * wage deciding who works, which is the manager's call and not the payroll's.
   *
   * `wageSensitivity` still prices every hour bought, at the roster's average
   * rate (see `teamRate` in ./generate); this prices only what one person costs
   * above or below that average. At 0.7 the same 8-euro gap is worth 5.6
   * points, and fairness takes the hour back once the cheaper person is nine
   * hours ahead -- about one shift -- instead of thirteen. Equal pay decides
   * nothing either way, and between two people the manager's terms cannot
   * tell apart, the cheaper one still gets the hour: it weighs.
   *
   * 0.7 is the lowest the quality bench allows, and it was measured, not
   * chosen. Everything from 0.62 to 0.9 builds the same thirteen calendars:
   * two move, and nothing gets worse on any quality axis -- the house-templates
   * shop shares its hours out (spread 24 -> 16.5, weekends 15 -> 3.5, pattern
   * drift 133 -> 112 minutes, 150 euros dearer) and the pending-request week
   * stops putting Ana on a day she asked for. At 0.61 the half-worked week
   * trades pattern for fairness (drift 88 -> 164), and from 0.6 down the
   * salaried shop and the house-templates shop do the same (drift 181 -> 194,
   * 133 -> up to 208) -- the average worsens because the dear people who
   * used to work two shifts at one time now work four at two, even where the
   * worst-treated person's drift improves. The bench forbids that trade, so
   * the weight stops at its edge and the ratio stops at 0.7, not at the 0.1
   * or 0.2 the sentence would suggest. Going lower is a decision about pattern
   * drift, not about this weight; see the note on it in objective.identity.
   *
   * Lowering `wageSensitivity` itself was the first thing measured and it is
   * worse at every step: at 0.8 the contracted-minimums shop puts 2 hours
   * beyond contract and its drift goes from 0 to 50, and at 0.2 the
   * house-templates shop buys 54 more hours for the same cover, because the
   * brake on shift LENGTH went with the choice of person.
   */
  preferCheaperPeople: 0.7,
  spreadHours: 0.6,
  respectContract: 12,
  respectWeeklyCap: 8,
  protectPendingTimeOff: 40,
  honourContractedMinimum: 3,
  rewardHoursCovered: 2,
  preferKnownShifts: 6,
  keepHoursForLaterDays: 6,

  // Top-up pass.
  avoidOvershootingBase: 4,
  avoidStoppingShort: 2,
  spreadHoursWhenToppingUp: 0.3,
  urgencyOfRemainingBase: 3,
  wageSensitivityWhenToppingUp: 0.01,
  preferKnownShiftsWhenToppingUp: 3,

  // Both.
  overtimeAversion: 25,
  /*
   * The first weight here that was NOT what the constants produced: it was added
   * with the premiums, on purpose, so that nights and weekends are shared out
   * by default rather than only for a business that picked `fair`. What it
   * moved is written up, scenario by scenario, in objective.identity's header.
   *
   * 0.06 sits in a measured window, not on a round number. From 0.001 to
   * 0.12 all thirteen scenarios come out the same: two move -- the
   * pending-absence week, whose Sunday stops going to somebody who already
   * had Saturday (weekend spread 15 hours -> 0), and the late bar (7.5 ->
   * 0.5) -- and nothing gets worse on any quality axis. At 0.15 it starts
   * buying weekend spread with pattern drift -- the half-worked week swaps a
   * Sunday evening for a Sunday morning and drift goes from 88 to 118
   * minutes -- and the quality bench forbids that trade, so the weight sits
   * at half the edge. The bar in contractFirst.test.ts holds its part-timers
   * to their contracts up to 2, so that is not the limit.
   *
   * Small, because it only has to separate people the rest of the score
   * finds nearly equal; it does not overrule cover, a contract or a day off,
   * and on the late bar it leaves the nights exactly where they were (every
   * shift in a bar that opens at five touches the night, so there is little
   * to move). What keeps the cheapest night off one person's back is not
   * this weight -- it is that the premium never enters the score at all
   * (`beats`, in ./generate).
   */
  spreadUnsocial: 0.06,
};

/**
 * The objectives a manager can actually pick, by code.
 *
 * The CODE is what the business profile stores; the weights live here, beside
 * the generator that reads them. Keeping a copy of the numbers server-side was
 * the other option and was rejected: it would leave two places in the product
 * able to disagree about what a good calendar is, and the one that would win
 * the argument is the one that has never run a schedule.
 */
export type ObjectiveCode = 'cheapest' | 'fair' | 'familiar' | 'protective';

/** In the order the manager reads them. */
export const OBJECTIVE_CODES: readonly ObjectiveCode[] = [
  'cheapest',
  'fair',
  'familiar',
  'protective',
] as const;

export function isObjectiveCode(
  value: string | null | undefined,
): value is ObjectiveCode {
  return value != null && (OBJECTIVE_CODES as readonly string[]).includes(value);
}

/**
 * Four objectives, each one a sentence a manager can agree or disagree with.
 *
 * Every one starts from `DEFAULT_OBJECTIVE` and moves only the weights its
 * sentence pays for. That is the whole discipline of this file: a profile that
 * quietly retuned all fifteen numbers would be a second default wearing a name,
 * and nobody could say what picking it had bought.
 *
 * None of them can reach a HARD filter -- an approved absence, the minimum rest
 * between shifts, a contract that ended, a day the shop is shut. `cheapest`
 * does not mean "work somebody through their holiday because it is cheap"; it
 * means that among the people who could all legally take that hour, the
 * cheapest one gets it.
 *
 * Every number below was chosen by MEASURING, against the twelve scenarios in
 * test/objectiveScenarios: a weight was moved, all twelve calendars were
 * rebuilt, and the value kept is the one that changed the rota the sentence
 * promises to change without introducing uncovered hours somewhere else. Where
 * a weight turned out to change nothing at all, it says so rather than
 * implying otherwise. objective.profiles.test.ts pins the result.
 */
export const OBJECTIVES: Record<ObjectiveCode, SchedulingObjective> = {
  /**
   * "The cheapest shift that covers the hour."
   *
   * The wage bill is the first question and everything else breaks ties. The
   * default weighs the gap between two people's rates at 0.7 so that it cannot
   * outvote the manager's own terms; this profile is the manager saying the
   * opposite, and puts BOTH halves of the wage back at 5 -- the price of every
   * hour bought and who is cheaper to buy it from. At 5, two people $8 an hour
   * apart are 40 points apart, which no amount of accumulated fairness buys
   * back inside a week.
   *
   * Overtime is the same decision seen twice. The premium is already inside
   * `cost`, so `overtimeAversion` is what sits ON TOP of it, and a business
   * squeezing its margin would rather pay a dearer person plain than a cheap
   * one time-and-a-half. Left at 25 while cost was worth five times more, the
   * half-worked week ran somebody to 44 hours to save $185; at 60 it stops at
   * 40 and pays the difference. That is the profile buying something it did not
   * ask for -- a cheap rota is not a rota that quietly turns two people into
   * overtime -- and it is the one place this profile deliberately costs more.
   *
   * Spreading hours is what it spends instead. Dropping it to 0.1 rather than
   * to zero is the honest version of that trade: it decides two scenarios that
   * 0.6 did not, and a tie between two people on the SAME rate still goes to
   * whoever has less -- there is no saving in handing one of two identical
   * candidates a fourteenth shift, so nothing here should.
   *
   * What this cannot promise is a cheaper week. The generator is greedy and
   * fills one day at a time, so taking the cheapest option every hour is not
   * the cheapest set of options: in 'house templates and a wage gap' it lands
   * $24 above the default on identical cover. It is cheaper where the choice is
   * genuinely local -- $145 on 'salaried and hourly', which it pays for with
   * two more uncovered hours the manager can see.
   */
  cheapest: {
    ...DEFAULT_OBJECTIVE,
    wageSensitivity: 5,
    // Equal to `wageSensitivity`, so the average and the difference add back
    // up to each person's own bill at 5 -- the term this profile was measured
    // with before the wage was split, calendar for calendar. The default let
    // go of who-is-cheaper; this is the sentence that asks for it back.
    preferCheaperPeople: 5,
    overtimeAversion: 60,
    spreadHours: 0.1,
    // Lower than the default, and measured to be: with cost five times
    // louder, anything from 0.05 up trades the half-worked week's pattern
    // (drift 88 -> 118 minutes) for its weekend spread. 0.01 still shares out
    // the same two weekends the default shares out, and nothing else. It is
    // not zero for the reason `spreadHours` is not: nothing is saved by
    // giving one of two identical people every Saturday.
    spreadUnsocial: 0.01,
  },

  /**
   * "The hours shared out across the team."
   *
   * `spreadHours` has to beat cost outright rather than merely argue with it,
   * so the two move together: 5 points per hour already worked, against a cost
   * term halved to 0.5. Two hours of difference in what people have already
   * been given now outweighs the widest wage gap in the scenarios -- which is
   * exactly what "shared out" has to mean on the days the cheap person and the
   * fair person are not the same person. It shows: six of the twelve calendars
   * change, one of them from a spread of 15-to-39 hours to 30-to-33.5, and the
   * salaried scenario loses its six uncovered hours on the way.
   *
   * Halved and not quartered. At 0.2 cost stops braking the LENGTH of a shift
   * as well as its price, and the same scenario went from 182 paid hours to
   * 236 -- fifty-four hours of overtime-free padding nobody needed, bought with
   * money, to cover the same shop. Even hours are the promise; more hours are
   * not.
   *
   * `honourContractedMinimum` rises to 12 because the fairest hours to hand out
   * first are the ones somebody was already promised. It is not riding along:
   * taking it back out changes two of the twelve, one of them the shop whose
   * cover cannot fill three contracted minimums at once. There, sharing out and
   * honouring a promise are different instructions, and the rota that ignores
   * the promise hands the hours to somebody who was owed fewer.
   *
   * `spreadHoursWhenToppingUp` at 2.5 changes NONE of the twelve, and is here
   * anyway. The reason it cannot is already written down in
   * objective.identity's header: whoever is furthest below their base is
   * usually whoever has fewest hours, so it and `urgencyOfRemainingBase` rank
   * the candidates identically and scaling either changes no winner. It stays
   * because the day those two disagree is a day the top-up pass would otherwise
   * undo the coverage pass's promise, and a promise about how hours are shared
   * that holds in only one of the two passes that hand them out is half a
   * promise.
   */
  fair: {
    ...DEFAULT_OBJECTIVE,
    spreadHours: 5,
    honourContractedMinimum: 12,
    wageSensitivity: 0.5,
    // Below the default's 0.7, as a profile about sharing must be, and equal
    // to its own `wageSensitivity` so it builds exactly what it built before
    // the split. Not lower: anywhere from 0.3 down to zero the
    // mixed-contracts shop gains two uncovered hours (4 -> 6) and the
    // house-templates shop's pattern drift goes from 122 to 168 minutes.
    preferCheaperPeople: 0.5,
    spreadHoursWhenToppingUp: 2.5,
    // Nights and weekends are what the backend's description of this profile
    // promises to spread (business_profile.py, OBJECTIVE_CONTEXT), so it
    // weighs them far more than the default. 1, a third of the way to the
    // measured edge: nothing on the bench gets worse up to 3, and nothing
    // changes between 0.001 and 3 either -- this profile's `spreadHours` of 5
    // already shares the hours so evenly that the unsocial ones follow, and
    // on the twelve briefs this weight only ever moves the same two weekends
    // the default moves. It is here so that the day a roster gives it
    // something to decide, it decides it for the sentence the manager picked.
    //
    // Not higher than that on faith. A first version of this weight counted
    // unsocial hours rather than their share, and there every value from 0.3
    // up made the late bar's NIGHTS less even (spread 6.4 -> 9.3 hours at 2):
    // a greedy pass that pushes Saturday off one person pushes Friday night
    // onto another. The share cured that, and the measurements above are of
    // the share.
    spreadUnsocial: 1,
  },

  /**
   * "The shifts you already have, worked by the same faces."
   *
   * Read what this does NOT claim. No weight in the objective means "the same
   * person on the same shift every week", so this profile cannot promise
   * continuity and the strings that describe it must not either. What it can do
   * is exactly two things: prefer the templates the business itself defined
   * over the bands the generator synthesises to plug a hole, and stop spreading
   * work, so the people who covered Tuesday are the ones offered Wednesday.
   *
   * 25 is sized between the two weights it has to sit between, and both edges
   * were measured. Below it is `rewardHoursCovered`, which is what beats a
   * template in practice: a synthesised band shaped to the gap resolves three
   * or four more hours at 2 points each, and a bonus of 6 lost that argument
   * every time -- at 15 the templates scenario still came out identical to the
   * default. Above it is `keepHoursForLaterDays`, the guard that stops a week
   * being spent by Thursday, and at 40 the bonus simply outbid it: the shop
   * took long house shifts all week and opened Saturday with nobody left,
   * fourteen hours uncovered. 25 prefers the template and still loses to the
   * pace guard, which is the right order for a preference to lose in.
   *
   * `preferKnownShiftsWhenToppingUp` rises in the ratio it already had. It
   * changes none of the twelve calendars -- the scenarios that reach the top-up
   * pass have templates the default already picks -- and it is here so that the
   * two passes cannot disagree about what a recognisable shift is.
   *
   * `spreadHours` at 0.1 also changes none of them, and that is worth stating
   * plainly rather than implying. Fairness is frequently the ONLY term
   * separating two candidates, and scaling the only term that separates them
   * reorders nothing; it bites where cost or a template argues back, which in
   * these twelve is nowhere. The sentence still pays for it -- "the same faces"
   * is a promise about people, not just about shift shapes -- but nothing here
   * proves it, and a reader deserves to know which of the three numbers above
   * is doing the work.
   */
  familiar: {
    ...DEFAULT_OBJECTIVE,
    preferKnownShifts: 25,
    preferKnownShiftsWhenToppingUp: 12,
    spreadHours: 0.1,
    // Same figure as `cheapest`, and for the same measured reason: from 0.05
    // it swaps a Sunday evening for a morning to share out a weekend, which
    // is exactly the shift pattern this profile is for keeping.
    spreadUnsocial: 0.01,
  },

  /**
   * "What people asked for, respected."
   *
   * `protectPendingTimeOff` is a flat penalty per candidate rather than a
   * per-hour one, so it has to clear the whole of the rest of the score in one
   * go. 'a pending request against a much cheaper alternative' is what sized
   * it: Ana costs 10 an hour and has asked for two days off, the only other two
   * people cost 60, and when the default weighed that gap at 1, 40 points did
   * not buy 50 points of it and she worked one of the days she asked for. At
   * 200 the calendar will sooner pay a day of overtime, or stretch two
   * contracts, than do that. It still cannot create a gap: an unanswered
   * request is not an approved absence, and the honest thing when there is no
   * alternative is to schedule the shift and show it.
   *
   * Since the default weighs a wage gap at 0.7 (`preferCheaperPeople`), that
   * 50 is worth 35 and the default honours Ana's request on its own. What is
   * left to this profile is the dearer version, 'a pending request against a
   * far cheaper alternative': 80 an hour, worth 56 to the default and still
   * short of 200 here. The sentence did not change; the default moved towards
   * it.
   *
   * `respectContract` is the same promise, written down rather than typed into
   * a form. At 12 an hour a contracted maximum was a preference the coverage
   * pass would trade away for a cheaper shape; at 40 stretching an agreement is
   * the last thing tried before leaving an hour uncovered. The two weights bite
   * in different scenarios, which is how we know neither is riding along.
   */
  protective: {
    ...DEFAULT_OBJECTIVE,
    protectPendingTimeOff: 200,
    respectContract: 40,
  },
};

/**
 * The weights behind a stored code, or `undefined` for a business that never
 * chose.
 *
 * `undefined` and not `DEFAULT_OBJECTIVE`: the spec's `objective` is optional
 * and the generator already reads the default when it is missing, so leaving
 * the field off is what guarantees a business that picks nothing keeps exactly
 * the calendar it has today. An unrecognised code -- an older client, a newer
 * server -- takes that same path rather than throwing: a calendar is more use
 * to a manager than an exception.
 */
export function objectiveFor(
  code: string | null | undefined,
): SchedulingObjective | undefined {
  return isObjectiveCode(code) ? OBJECTIVES[code] : undefined;
}
