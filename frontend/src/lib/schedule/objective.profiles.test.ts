// What each named objective actually does to a calendar, pinned.
//
// objective.identity next door proves the default did not move. This file is
// the other half of the same argument, and the one the manager is buying: a
// profile is a promise that picking it changes the rota, and the only way to
// keep that promise honest is to write down which rotas it changes and how.
//
// THE FIXTURE HOLDS ONLY THE DIFFERENCES. Every profile is run against all
// twelve scenarios; a scenario that comes out identical to the default is
// asserted against objective.identity.fixture.json instead, and does not appear
// here. So the fixture beside this file reads as a list of what each profile is
// FOR, rather than as forty-eight calendars of which most say nothing, and a
// weight that quietly stopped mattering shows up as an entry that disappeared
// rather than as a diff nobody reads.
//
// That makes three claims testable at once:
//
//   1. a named profile produces exactly the calendar we measured (the fixture),
//   2. everywhere else it produces exactly the default's calendar, so no
//      profile is quietly retuning rotas its sentence never mentioned,
//   3. every profile changes SOMETHING. A profile that changed nothing would be
//      a lie in the interface -- four options that all do the same thing --
//      and it is the failure this file exists to make impossible to ship.
//
// WHAT THIS PUTS UNDER LOAD. The identity header lists five weights no scenario
// could vouch for, because in each case something else decided first. Two of
// them -- `spreadHoursWhenToppingUp` and `preferKnownShiftsWhenToppingUp` --
// are moved by `fair` and `familiar` here, and neither changes a calendar even
// so. That is not a gap this file failed to close; it is the same finding,
// confirmed from a second direction and written down on the profiles that carry
// them. `respectWeeklyCap`, `avoidOvershootingBase` and `urgencyOfRemainingBase`
// are still unproven, and no profile moves them, because no sentence a manager
// would recognise asks for them on their own.

import { describe, expect, it } from 'vitest';
import { SCENARIOS, canonical } from '../../test/objectiveScenarios';
import { OBJECTIVES, OBJECTIVE_CODES } from './objective';
import defaults from './objective.identity.fixture.json';
import fixture from './objective.profiles.fixture.json';

const pinnedDefault = defaults as Record<string, unknown>;
const pinnedProfile = fixture as Record<string, unknown>;

/** The fixture key for one profile's take on one scenario. */
function key(code: string, scenario: string): string {
  return `${code} :: ${scenario}`;
}

describe('every named objective builds the calendar it was measured to build', () => {
  it('pins nothing that is not a difference, and nothing that no longer exists', () => {
    const known = new Map(
      OBJECTIVE_CODES.flatMap((code) =>
        SCENARIOS.map((s) => [key(code, s.name), s.name] as const),
      ),
    );
    for (const [k, entry] of Object.entries(pinnedProfile)) {
      const scenario = known.get(k);
      // An entry for a profile or a scenario that no longer exists.
      expect(scenario, k).toBeDefined();
      // An entry that has stopped being a difference. Left alone it would read
      // as "this profile changes this calendar" for ever, which is the exact
      // claim this file exists to keep true.
      expect(entry, k).not.toEqual(pinnedDefault[scenario as string]);
    }
  });

  for (const code of OBJECTIVE_CODES) {
    describe(code, () => {
      it('changes at least one calendar, or it is a lie in the interface', () => {
        const changed = SCENARIOS.filter((s) => key(code, s.name) in pinnedProfile);
        expect(changed.length).toBeGreaterThan(0);
      });

      for (const scenario of SCENARIOS) {
        const k = key(code, scenario.name);
        const differs = k in pinnedProfile;
        it(`${scenario.name} — ${differs ? 'its own calendar' : "the default's calendar"}`, () => {
          expect(canonical(scenario.run(OBJECTIVES[code]))).toEqual(
            differs ? pinnedProfile[k] : pinnedDefault[scenario.name],
          );
        });
      }
    });
  }
});
