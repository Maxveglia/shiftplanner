// The refactor's own acceptance criterion, kept.
//
// Moving the scoring constants into `SchedulingObjective` is only allowed to
// change where the numbers LIVE. The fixture beside this file was generated
// from the generator before that move, and every assignment in it -- who, which
// day, which minutes, at what cost -- has to come back identical.
//
// It stays in the repo after the refactor lands because the next four steps all
// change weights on purpose. When one of them does, this suite is what says
// whether `DEFAULT_OBJECTIVE` still means "the calendar we shipped": a named
// profile may produce a different rota, the default may not. Regenerate the
// fixture only alongside a decision to change the default, never to make a red
// test go green.
//
// The rest of the suite deliberately asserts properties rather than choices, so
// that it survives the CP-SAT solver landing behind this signature. That makes
// it the wrong tool here, and this file the right one: a rota can satisfy every
// property in generate.test.ts and still put a different person on Thursday.
//
// HOW FAR THIS ACTUALLY REACHES. Ten of the fifteen weights were checked by
// setting each to zero and to ten times its value and confirming at least one
// scenario changes. Five did not move any of them:
//
//     respectWeeklyCap, avoidOvershootingBase, spreadHoursWhenToppingUp,
//     urgencyOfRemainingBase, preferKnownShiftsWhenToppingUp
//
// Not because they are unused -- every one is read on a path these scenarios
// execute -- but because in each case something else decides first. The
// clearest is `urgencyOfRemainingBase` against `spreadHoursWhenToppingUp`: the
// person with the most hours still owed is usually the person with the fewest
// hours so far, so both weights rank the candidates identically and scaling
// either one changes no winner. That is worth knowing about the SCORE, not
// just about the tests: two of these weights may turn out to be one.
//
// REGENERATED ONCE, on purpose. Adding `keepHoursForLaterDays` and letting a
// candidate be trimmed to somebody's remaining week changes the default rota,
// which is exactly the decision this fixture exists to make visible. Three of
// the ten scenarios moved, and every one was compared outcome by outcome before
// the fixture was rewritten:
//
//     salaried and hourly on the same rota   16 uncovered person-hours -> 6
//     org templates against synthesised bands  same cover, 1.5 fewer hours paid
//     mixed contract floors and ceilings       same cover, same hours, different people
//
// The other seven are byte-identical. No scenario gained a gap, and none put
// anybody below their contracted minimum. See lastDayOfWeek.test.ts for the
// brief that prompted it.
//
// So this file proves the refactor exactly, and guards the default partially.
// Step 2 closes the rest for free: a named profile moves several weights at
// once, and pinning each profile's calendar puts every weight under load in a
// combination that does change the answer.
//
// EXTENDED, on purpose, and NOT regenerated. Step 2 landed and added two
// scenarios written to make named profiles disagree with the default rather
// than to isolate one weight -- 'house templates and a wage gap' and 'a pending
// request against a much cheaper alternative'. Both are appended, so this
// fixture gained two keys and changed none: the ten calendars above are still
// byte-for-byte the ones generated before the constants moved, which is the
// only thing this file has ever promised. What step 2 found while doing it is
// written up on the profiles it belongs to, in ./objective; the short version
// is that two of the five weights listed above are now moved by a named profile
// and STILL change nothing, for the reason given above, and the other three
// remain unproven because no sentence a manager would recognise asks for them.

// REGENERATED A SECOND TIME, on purpose, when a contract's stated hours became
// the agreement. `extraBeyondContract` read only `max_hours_per_week`, so a
// contract of "20 hours" with no maximum -- which is how a brief's "dos con 20
// horas" arrives -- put nobody beyond anything, and the coverage pass used
// those people like full-timers. It now reads the minimum when there is no
// maximum. Two scenarios moved, both the ones with min-only contracts, and
// each was compared outcome by outcome:
//
//     mixed contract floors and ceilings       10 uncovered person-hours -> 4;
//                                              e1 (20h) and e4 (24h) at 40h
//                                              instead of 38h, and their 36
//                                              hours beyond contract now SHOWN
//                                              as such instead of hidden
//     contracted minimums the coverage cannot  59 hours -> 57 handed out
//     fill                                     against 40 of cover; e3 2h over
//                                              base now marked, e2 1h under
//                                              (was 2.5h over)
//
// The other ten are byte-identical. Neither scenario gained a gap; nobody fell
// below their contracted minimum on a full week. The profiles fixture moved
// with it, and `familiar` now differs from the default on the first scenario.

// REGENERATED A THIRD TIME, on purpose, when an extra hour started being
// measured against the contract instead of against forty. Art. 35.1 ET defines
// it that way -- "sobre la duracion maxima de la jornada ordinaria", which is
// the contract's maximum -- and reading the FLSA's 40 for everybody meant the
// only people the threshold never reached were the ones furthest below it: a
// 20-hour contract could be worked at 35 hours every week and show no extra
// hour at all. `ordinaryWeeklyHours` now returns min(contract, statutory week).
//
// The same two min-only-contract scenarios moved, and both were read outcome by
// outcome before this was rewritten:
//
//     mixed contract floors and ceilings       4 uncovered person-hours -> 2,
//                                              153 -> 153.5 hours handed out,
//                                              and the 62.5 hours beyond
//                                              contract now COSTED as extra
//                                              (0 -> 62.5 overtime, +668.50)
//     contracted minimums the coverage cannot  the calendar is unchanged --
//     fill                                     same people, same 13/16/28
//                                              hours, no new gap. Two of e3's
//                                              hours are simply named: their
//                                              contract is 26 and they work 28
//
// Nobody fell below their contracted minimum in either. The quality bench
// (rotaBench.test.ts) reports the first as BETTER on cover and pattern drift
// and the second as unchanged in quality, which is the whole trade this change
// was asking for: the same rota, honestly priced.
//
// The profiles fixture lost two entries rather than gaining any -- `cheapest`
// on the second scenario and `protective` on the first now agree with the
// default. That is worth noticing rather than tidying past: with the threshold
// at each person's own contract, two objectives that used to disagree about
// these rotas no longer have anything to disagree about.

// REGENERATED A FOURTH TIME, on purpose, when an hour inside somebody's
// remaining contract stopped being charged as a cost in the coverage pass. It
// is paid whether or not it is worked, and charging it made the pass pick the
// shortest shift that closed each gap -- a bar open 17:00-03:00 gave its four
// forty-hour people 36-38 hours a week built of four-hour shifts, while the
// 16-hour contract picked up the long ones. The owed hours are counted up to
// today's share of the week, not the whole week, so a contract is not spent by
// Thursday (lastDayOfWeek.test.ts guards that).
//
// One default scenario moved, and it was read outcome by outcome:
//
//     contracted minimums the coverage cannot  2 hours beyond contract -> 0,
//     fill                                     pattern drift 50 min -> 0,
//                                              cost 1128 -> 1074; same cover
//
// The other eleven are byte-identical. In the profiles: `cheapest` on mixed
// contracts builds a different rota with identical metrics; `cheapest` on the
// scenario above now matches that improvement and differs from the default;
// `fair` there closes its 1.5 hours short of minimum (+21 in cost).

// REGENERATED A FIFTH TIME, on purpose, when the week moved to Monday.
//
// Not a change of weights at all: the scenarios are ONE WHOLE WEEK each, and a
// week that started on Sunday the 1st of March stopped being one week the
// moment a week started on Monday. They now run Monday the 2nd to Sunday the
// 8th, and the two people with a half-week already behind them keep their
// pinned days inside it.
//
// Every scenario was compared before this was rewritten, and none of them
// moved in any way that matters:
//
//     shifts, hours paid, cost, overtime, uncovered person-hours, people
//     below their contracted minimum -- IDENTICAL in all twelve
//     hours per person -- IDENTICAL in all twelve
//
// Eight of the twelve are the same calendar one day later, byte for byte. In
// the other four somebody swaps a day with somebody else, because the absences
// and the closed Sunday sit on their WEEKDAY while the week now opens a day
// later: same people, same hours each, same gaps, different day. The profiles
// fixture pins the same fifteen disagreements it pinned before.

// REGENERATED A SIXTH TIME, on purpose, when premiums reached the generator
// and nights and weekends started being shared out by default.
//
// Two things landed together and only one of them could move this fixture.
// The premiums -- booked into each shift's cost, and used to break a tie
// between candidates the score calls equal -- apply only when a pay policy is
// passed, and none of the twelve briefs above passes one. The new weight,
// `spreadUnsocial`, is in the default, so it reaches all of them. Before this
// was rewritten the twelve were run with that weight at zero, and all twelve
// came back byte-identical to the old fixture: whatever moved below moved
// because of the weight, and for no other reason.
//
// At 0.06 one scenario moved, and it was read outcome by outcome:
//
//     one approved absence and one still      Sunday 09:00-17:00 moved from e2
//     pending                                 to e3: e2 had already worked the
//                                             Saturday, e3 had no weekend hours
//                                             at all. Weekend spread 15 hours
//                                             -> 0; same cover, same hours,
//                                             same cost, nobody short
//
// The other eleven are byte-identical. One was added: 'a late bar, one person
// paid no night premium', the first brief with a pay policy, whose booked
// costs are therefore what payroll pays -- premiums included. The profiles
// fixture did not change by a byte: all four profiles already agreed with the
// default on the pending-absence week and still do, and none of them builds
// the late bar differently from the default.
//
// The quality bench was re-pinned alongside it. It had fallen behind: two
// earlier improvements (mixed contracts 4 uncovered hours -> 2, contracted
// minimums pattern drift 50 -> 0) had passed the ratchet without ever being
// adopted. Against the numbers measured before this change, no scenario is
// worse on any quality axis.

// REGENERATED A SEVENTH TIME, on purpose, when the wage stopped deciding who
// works. "Que el coste pese pero no mande": the base wage was split into what
// an hour costs on this roster (still `wageSensitivity`, at 1) and what one
// person costs above or below that (`preferCheaperPeople`, now 0.7). Before
// this was rewritten the thirteen were run with the second weight at 1, and
// all thirteen came back byte-identical to the old fixture: average plus
// difference is each person's own rate, so whatever moved below moved because
// of the 0.7 and for no other reason.
//
// Two scenarios moved, and both were read outcome by outcome:
//
//     house templates and a wage gap          Sunday 08:00-16:00 moved from
//                                             the two on 20 an hour to the two
//                                             on 30, who had worked 15 hours
//                                             each. Hours spread 24 -> 16.5,
//                                             weekend spread 15 -> 3.5, pattern
//                                             drift 133 -> 112 minutes; same
//                                             cover, same hours, +150 (+4.5%)
//     a pending request against a much        Ana's Thursday went to e3 and
//     cheaper alternative                     Ana took the Sunday instead: the
//                                             50-an-hour gap is now worth 35
//                                             points against her request's 40,
//                                             so the default honours both days
//                                             she asked for. Same cover, same
//                                             hours each, same cost
//
// The other eleven are byte-identical. One was added: 'a pending request
// against a far cheaper alternative', the same brief at 80 an hour, because
// the second move above left `protective` with no calendar of its own. There
// the default still puts Ana on her Thursday and `protective` does not.
//
// WHY 0.7 AND NOT LOWER, since the sentence reads lower. 0.62 to 0.9 build
// the same calendars; from 0.61 down the half-worked week's pattern drift goes
// 88 -> 164, and from 0.6 down the salaried shop's goes 181 -> 194 and the
// house-templates shop's up to 208, and the quality bench forbids all three.
// At 0.2 they are the price of sharing out: in the house-templates shop the
// worst-treated person's drift IMPROVES (240 -> 192) while the average rises,
// because the two dearest people go from two shifts at one start time to four
// at two, and the salaried shop gains two covered hours (6 uncovered -> 4) for
// its 13 minutes. Hours spread there would fall 24 -> 3.5 for +380 (+11.5%).
// That trade is a decision about pattern drift for the owner, not a tuning
// step, so it is written down here rather than taken.
//
// In the profiles: `cheapest` and `fair` build exactly what they built before
// (each sets both halves of the wage to its old single number). `protective`
// loses its entry on the much-cheaper brief -- the default now agrees with it
// there -- and gains one on the far-cheaper brief; on house templates it
// followed the default to the new calendar, as it always matched it there.
// `familiar` did the same on the much-cheaper brief. The quality bench was
// re-pinned with the added row; against the numbers pinned before, no scenario
// is worse on any quality axis.

// REGENERATED AN EIGHTH TIME, on purpose, when `fair` stopped pushing the
// part-timers past their contracts on the bar in contractFirst.test.ts (Diego
// 24 hours a week on 16, Luka up to 29.5 on 20). Three changes, all in
// generate.ts, and only the third reaches a default scenario:
//
//   - the coverage pass stops paying a shift's PADDING -- contract hours spent
//     on hours nobody was short of -- when that shift stops short of the hole
//     and the same person had one that closed it;
//   - a pick that takes somebody beyond their contract gives way to somebody
//     inside theirs who closes as much of the hole;
//   - the top-up pass may also offer each band cut down to what the person is
//     still owed (never under three hours), so half an hour short no longer
//     costs a whole five-hour band.
//
// With only the first two in place all thirteen scenarios came back
// byte-identical, under the default and under every profile. The third moved
// one, and it was read outcome by outcome:
//
//     a late bar, one person paid no night   Sofia's Wednesday top-up is
//     premium                                17:00-22:00 (the evening band cut
//                                            to the five hours she was owed)
//                                            instead of 23:00-03:00, which
//                                            lands her on her 20-hour base, so
//                                            Thursday's second 23:00-03:00
//                                            top-up is gone. 184 -> 181 hours,
//                                            3122.81 -> 3047.81, pattern drift
//                                            124 -> 100 minutes; same cover,
//                                            nobody short. Her night hours fall
//                                            16.4 -> 8.4, so night spread goes
//                                            6.4 -> 13.2 -- a spread axis, not a
//                                            quality one, and Juan's nights are
//                                            exactly where they were
//
// The other twelve are byte-identical. The profiles fixture did not change by
// a byte: all four profiles still build the late bar exactly as the default
// does. The quality bench was re-pinned; against the numbers pinned before, no
// scenario is worse on any quality axis under the default or any profile.

import { describe, expect, it } from 'vitest';
import { SCENARIOS, canonical } from '../../test/objectiveScenarios';
import fixture from './objective.identity.fixture.json';

const pinned = fixture as Record<string, unknown>;

describe('the default objective reproduces the calendar the constants produced', () => {
  it('has a pinned calendar for every scenario, and no orphans', () => {
    expect(Object.keys(pinned).sort()).toEqual(SCENARIOS.map((s) => s.name).sort());
  });

  for (const scenario of SCENARIOS) {
    it(scenario.name, () => {
      expect(canonical(scenario.run())).toEqual(pinned[scenario.name]);
    });
  }
});
