// Whether to ask the manager about the kind of business we GUESSED they run.
//
// A vertical can reach the profile two ways. A manager can say it ("declared"),
// or the server can deduce it from the opening interview ("inferred"). The
// second is a guess, and the backend treats it as one: an inferred vertical
// contributes nothing to a calendar until somebody confirms it. So a guess
// nobody is shown is a guess that does nothing forever, and this is where it
// is shown -- one line on the dashboard, asked once.
//
// Two guesses are deliberately NOT put to the manager:
//
//   "other"        is not a guess about anything. "It looks like Something
//                  else, right?" is a question with no content, and saying yes
//                  to it changes nothing: the template behind it has no
//                  suggestions and a context sentence that says we were not
//                  told.
//   an unknown     code (one the list the server sent does not carry) has no
//                  label we could put in front of a person, and a raw code on
//                  a manager's screen is worse than no question.

export interface VerticalChoice {
  code: string;
  label: string;
}

/** The slice of the business profile this decision reads. */
export interface VerticalView {
  vertical: string | null;
  vertical_source: string;
  verticals: VerticalChoice[];
}

export const OTHER_VERTICAL = 'other';

/**
 * The guessed vertical to confirm, or null when there is nothing to ask.
 *
 * Null for a declared one (a human already said it), for no vertical at all,
 * and for the two cases above.
 */
export function verticalToConfirm(
  profile: VerticalView | null | undefined,
): VerticalChoice | null {
  if (!profile) return null;
  if (profile.vertical_source !== 'inferred') return null;
  if (!profile.vertical || profile.vertical === OTHER_VERTICAL) return null;
  return profile.verticals.find((v) => v.code === profile.vertical) ?? null;
}

/**
 * What else it could be, once the manager has said it is not `rejected`.
 *
 * The rejected guess is left out rather than shown unpressed: they have just
 * told us it is wrong, and offering it again beside the others reads as if we
 * had not heard. "Something else" stays, because it is a real answer -- the
 * one for a business none of the others describe. The server's order is kept.
 */
export function otherVerticals(
  verticals: VerticalChoice[],
  rejected: string,
): VerticalChoice[] {
  return verticals.filter((v) => v.code !== rejected);
}
