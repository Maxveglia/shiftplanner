// The dictionary's one structural rule: both languages carry the same keys.
//
// A missing Spanish string does not break anything — `translateIn` falls back
// to English and warns in dev — which is exactly why it survives. The screen
// looks fine to whoever wrote it and shows two English words to the manager who
// speaks Spanish, and the dev warning only fires if somebody happens to open
// that screen with that language selected.
//
// Order is checked too, and not out of tidiness: the modules are read side by
// side when a string is written or changed, and a pair that has drifted out of
// order is a pair where the reviewer is comparing the wrong two lines.
//
// WHAT IS DELIBERATELY NOT CHECKED: that the two sides interpolate the same
// placeholders. That looks like the same class of bug and is not one. The hour
// ruler passes `h12`, `h24` and `h` to one key and lets each language take the
// one it writes with -- "1p" in English, "13" in Spanish -- so a rule demanding
// identical placeholders would forbid the very thing the dictionary is for.

import { describe, expect, it } from 'vitest';
import { common } from './common';
import { dashboard } from './dashboard';
import { schedule } from './schedule';
import { calendar } from './calendar';
import { people } from './people';
import { employee } from './employee';
import { backoffice } from './backoffice';
import { domain } from './domain';
import { settings } from './settings';
import { labels } from './labels';
import { roster } from './roster';
import { questions } from './questions';
import { onboarding } from './onboarding';
import { interview } from './interview';
import { assistant } from './assistant';
import { labour } from './labour';
import { errors } from './errors';
import { workday } from './workday';
import { inventory } from './inventory';
import { dayNotes } from './dayNotes';
import { scanner } from './scanner';
import { menu } from './menu';
import { store } from './store';
import { recipes } from './recipes';
import { orders } from './orders';
import { access } from './access';
import type { MessageModule } from './types';

const MODULES: Record<string, MessageModule> = {
  common,
  dashboard,
  schedule,
  calendar,
  people,
  employee,
  backoffice,
  domain,
  settings,
  labels,
  roster,
  questions,
  onboarding,
  interview,
  assistant,
  labour,
  errors,
  // Absent from this list until now, which is exactly how a module drifts:
  // the working year gained a dozen keys in one redesign and nothing was
  // checking that both languages got all of them.
  workday,
  inventory,
  dayNotes,
  scanner,
  menu,
  store,
  recipes,
  orders,
  access,
};

describe.each(Object.entries(MODULES))('%s', (_name, module) => {
  it('says the same things in both languages, in the same order', () => {
    expect(Object.keys(module.es)).toEqual(Object.keys(module.en));
  });

  it('leaves no sentence empty in either language', () => {
    for (const key of Object.keys(module.en)) {
      expect(module.en[key].trim(), key).not.toBe('');
      expect(module.es[key].trim(), key).not.toBe('');
    }
  });
});
