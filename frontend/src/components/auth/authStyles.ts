// Class lists for controls standing on the sign-in's dark stage. The glow and
// its hover live in styles/motion-auth.css (`auth-submit`).

/**
 * The submit button: full width, rounder, glowing in menta. While it waits it
 * keeps its colour -- the Button's own disabled look is a pale green that left
 * "Signing in…" at 1.6:1 -- and says so with the cursor instead; its focus
 * ring is menta-light, because the Button's (its own colour) vanished here.
 */
export const AUTH_SUBMIT = [
  'auth-submit mt-1 w-full rounded-xl py-2.5',
  'disabled:!bg-brand-600 disabled:!opacity-100 disabled:cursor-wait',
  'focus-visible:!outline-brand-300',
].join(' ');

/** A link on the stage, in menta-light. */
export const AUTH_LINK =
  'font-medium text-brand-300 underline-offset-4 transition-colors hover:text-brand-800 hover:underline';

/** The id the error line carries, for the fields' aria-describedby. */
export const AUTH_ERROR_ID = 'auth-error';
