// A behaviour the product has promised and does not deliver yet.
//
// Written as the test it will one day be, and run as `it.fails` in CI: the
// suite stays green while the gap is open, and the day the app starts doing
// it the expected failure stops failing, CI goes red, and whoever closed the
// gap has to turn this back into a plain `it`. A gap cannot close in silence.
//
// With SP_EVALS=1 it is an ordinary `it`, so the eval that owns the case
// (.claude/evals/*/cases) sees the honest answer: red while the gap exists.
//
// `process` is declared in ./benchRuntime.d.ts -- this repo has no @types/node.

import { it } from 'vitest';

export const knownGap = process.env.SP_EVALS ? it : it.fails;
