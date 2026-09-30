// Test runner config, kept OUT of vite.config.ts on purpose.
//
// `defineConfig` from 'vite' does not know about the `test` key, so folding the
// two together would mean either a type assertion or a triple-slash reference
// in the file that builds production. Vitest reads this file in preference to
// vite.config.ts, and the app build never loads it at all.
//
// Environment is `node`: everything under test is pure scheduling and roster
// logic. No jsdom, no testing-library — a DOM here would only be weight, and
// the absence of one is a useful guard that this logic stays free of the UI.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests live beside the code they cover, inside src/, so `tsc --noEmit`
    // type-checks them along with everything else. They are never imported by
    // the app, so they cannot reach the production bundle.
    include: ['src/**/*.test.ts'],
  },
});
