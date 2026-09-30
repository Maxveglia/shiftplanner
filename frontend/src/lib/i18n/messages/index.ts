// The dictionary, assembled from one module per area of the product.
//
// Split by screen rather than kept in one file so that several people (or
// several agents) can translate different parts without ever touching the same
// file. Adding an area means adding a module here and nothing else.

import type { MessageModule } from './types';
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

const modules: MessageModule[] = [
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
  workday,
  inventory,
  dayNotes,
  scanner,
  menu,
  store,
  recipes,
  orders,
  access,
  errors,
];

export const messages = {
  en: Object.assign({}, ...modules.map((m) => m.en)) as Record<string, string>,
  es: Object.assign({}, ...modules.map((m) => m.es)) as Record<string, string>,
};
