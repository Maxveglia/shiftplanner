// Every rule behind the rota, in one list, said out loud.
//
// WHERE IT LIVES, AND WHY IT MOVED TWICE. It began as sections inside the
// profile panel, came out to sit beside the calendar, and now sits in
// Settings: eleven rows under the brief filled the screen a manager opens to
// write one, and what they are for is answering "why does the rota say this?"
// -- a question asked occasionally, not every time the page loads. The rows
// are the same rows, and the state is the same state: the draft store lives
// in the layout, so both screens read one answer rather than two.
//
// WHY THIS IS NOT INSIDE THE PROFILE PANEL. It was: sections of assumptions and
// beliefs, behind a collapsed header, in a panel about what the product has
// LEARNED from past corrections. Learning is a curiosity a manager may never
// open. A rule is load-bearing -- it is the reason the calendar in front of
// them says two people on Monday -- and something that is only true because we
// chose it has to be visible next to the thing it made true.
//
// ONE LIST, NOT FIVE SECTIONS. What a manager wants from this is a sweep of the
// eye: what governs this rota, and where each line came from. Five headed
// sections, each with its own help text, made that a reading exercise. So every
// kind of thing renders as the SAME row -- a pill saying where it came from,
// the claim, and underneath it the reason -- and the pill is what tells them
// apart. The order is the authority: what they said, what we learned from them,
// what we assumed, and then, below the line, what does not govern anything yet.
//
// EACH ROW IS TWO HALVES. What is in force, and why -- built by
// ../../lib/schedule/assumptions from the server's field and reason codes, in
// the manager's language, never from the prose the server happens to attach.
// A row with only its first half is a setting somebody forgot changing; the
// second half is what makes it a reading of their own brief, which is the thing
// they can correct in a sentence.

import { Fragment, useMemo, useState } from 'react';
import { useT } from '../../lib/i18n';
import { suggestionLabel } from '../../lib/format';
import { useBusinessProfile, useSetHintRejected } from '../../api/profile';
import {
  assumedStaff,
  describeAssumptions,
  isCorrectable,
} from '../../lib/schedule/assumptions';
import { describeDeclarations } from '../../lib/schedule/declarations';
import { describeHint, isFromEdits } from '../../lib/schedule/hints';
import type {
  AppliedHint,
  Declaration,
  ProfileSuggestion,
  SpecGap,
} from '../../api/schedule';
import type { SchedulingSpec } from '../../lib/schedule/types';

/**
 * Where a row came from, which is the only thing that varies between rows.
 *
 * A code and not a colour: the tone table below is presentation, and nothing
 * here may branch on the translated pill text.
 */
type Origin =
  | 'stated'
  /**
   * Read out of a sentence the manager typed, and waiting on their answer.
   *
   * Its own origin rather than 'learned' because the two are promoted by
   * different things and the row has to say which: a learned hint earns its
   * place with evidence over days, and this one earns it the moment a human
   * says "yes, always". Until then it changes nothing.
   */
  | 'heard'
  /**
   * Noticed in how the manager retouches our calendars, and waiting on them.
   *
   * The same question as 'heard' -- inert until confirmed -- with a different
   * pill, because nobody said it: "te lo oímos" over a rule they never typed
   * would be us putting words in their mouth.
   */
  | 'noticed'
  | 'learned'
  | 'assumed'
  | 'default'
  | 'watching'
  | 'typical'
  | 'forgotten';

const PILL_TONE: Record<Origin, string> = {
  stated: 'bg-brand-100 text-brand-800',
  heard: 'bg-amber-100 text-amber-800',
  noticed: 'bg-amber-100 text-amber-800',
  learned: 'bg-brand-50 text-brand-700',
  assumed: 'bg-amber-100 text-amber-800',
  default: 'bg-gray-100 text-gray-600',
  watching: 'bg-gray-100 text-gray-500',
  typical: 'bg-gray-100 text-gray-600',
  forgotten: 'bg-gray-100 text-gray-500',
};

const PILL_LABEL: Record<Origin, string> = {
  stated: 'calendar.standing.pill.stated',
  heard: 'calendar.standing.pill.heard',
  noticed: 'calendar.standing.pill.noticed',
  learned: 'calendar.standing.pill.learned',
  assumed: 'calendar.standing.pill.assumed',
  default: 'calendar.standing.pill.default',
  watching: 'calendar.standing.pill.watching',
  typical: 'calendar.standing.pill.typical',
  forgotten: 'calendar.standing.pill.forgotten',
};

/** One line of the list, whatever it came from. */
interface Row {
  key: string;
  origin: Origin;
  /** What is in force, or proposed. */
  what: string;
  /** Why it is, or null when there was nothing to lean on. */
  why: string | null;
  /** The evidence behind it, shown small and to the right. */
  note?: string;
  /** The one thing a manager can do to this row from here. */
  action?: { label: string; onClick: () => void };
  /**
   * A second thing, for the one row that is a question rather than a fact.
   *
   * Every other row states something in force and offers one way out of it. A
   * rule we only heard is asking, and a question with one button is not a
   * question -- it is a nudge towards yes.
   */
  secondary?: { label: string; onClick: () => void };
  /** Index into `gaps` for the rows that can be corrected with a number. */
  gapIndex?: number;
  /** Rows that are on the page to say they are NOT in force. */
  muted?: boolean;
}

export function StandingRules({
  gaps,
  spec,
  declared,
  applied,
  suggestions,
  onCorrect,
  onForget,
}: {
  gaps: SpecGap[];
  spec: SchedulingSpec;
  /** What is in force because the manager said so. */
  declared: Declaration[];
  /** The learned hints this calendar actually used. */
  applied: AppliedHint[];
  /** Industry-typical proposals for the fields the brief left silent. */
  suggestions: ProfileSuggestion[];
  /**
   * The manager's own number for one assumption. Rebuilds the calendar.
   *
   * Optional, because this list is read in two places and only one of them
   * has a calendar to rebuild: on the settings screen the rows explain what
   * is in force, and the place to change a number is the brief.
   */
  onCorrect?: (gap: SpecGap, staff: number) => void;
  /** Take back one declaration. */
  onForget: (key: string) => void;
}) {
  const t = useT();
  // Keyed by row, so two open editors cannot overwrite each other's draft.
  const [draft, setDraft] = useState<Record<string, string>>({});
  // The beliefs are read here rather than passed down: they belong to the
  // business and not to the calendar on screen, so they outlive a generation
  // and there is no prop for the dashboard to keep in sync.
  const profile = useBusinessProfile();
  const setRejected = useSetHintRejected();
  const hints = profile.data?.hints ?? [];

  // Recomputed when the language changes, because every sentence in here is
  // built at render time rather than stored.
  const assumptions = useMemo(() => describeAssumptions(gaps, spec), [gaps, spec]);
  const stated = useMemo(() => describeDeclarations(declared), [declared]);

  const rows: Row[] = [];

  // 1. What they said. First, because it outranks everything below it and
  //    because a manager scanning this list is looking for their own decisions.
  for (const d of stated) {
    rows.push({
      key: `stated:${d.key}`,
      origin: 'stated',
      what: d.what,
      why: null,
      action: { label: t('calendar.standing.forget'), onClick: () => onForget(d.key) },
    });
  }

  // 2. What their corrections taught us, and whether this calendar needed it.
  //    Keyed off the hint rather than the applied row so the claim is the one
  //    sentence the profile holds; an applied hint with no hint behind it (the
  //    profile is still loading) falls back to the label the server sent.
  const appliedKeys = new Set(applied.map((a) => a.key));
  const hintKeys = new Set(hints.map((h) => h.key));
  // 2a. Rules heard in something they typed, waiting on a yes or no. These
  //     change nothing at all until confirmed -- the server keeps them inert
  //     -- so the row leads with the question rather than with a claim.
  //     The ones noticed in their retouches ask the same question with their
  //     own pill and reason: it was something they did, not something they
  //     said, and the evidence is the days they did it on.
  for (const h of hints.filter((x) => x.stated && !x.accepted && !x.rejected)) {
    const noticed = isFromEdits(h.key);
    rows.push({
      key: `heard:${h.key}`,
      origin: noticed ? 'noticed' : 'heard',
      what: describeHint(h),
      // A note the planner wrote itself has no days of evidence to count --
      // it was written once, after a publication -- so it says that instead.
      why:
        h.value?.source === 'planner_notes'
          ? t('calendar.standing.notes.why')
          : noticed
            ? t('calendar.standing.edits.why', { count: h.evidence })
            : t('calendar.standing.heard.why'),
      action: {
        label: t('calendar.standing.heard.confirm'),
        onClick: () => setRejected.mutate({ key: h.key, rejected: false, accepted: true }),
      },
      secondary: {
        label: t(noticed ? 'calendar.standing.edits.dismiss' : 'calendar.standing.heard.dismiss'),
        onClick: () => setRejected.mutate({ key: h.key, rejected: true }),
      },
    });
  }

  // 2b. Confirmed ones, in force. No evidence count: a sentence the manager
  //     typed is not true because it was seen on three days.
  for (const h of hints.filter((x) => x.stated && x.active)) {
    rows.push({
      key: `heardOk:${h.key}`,
      origin: 'stated',
      what: describeHint(h),
      why: t(
        isFromEdits(h.key)
          ? 'calendar.standing.edits.inForce'
          : 'calendar.standing.heard.inForce',
      ),
      action: {
        label: t('calendar.standing.forget.hint'),
        onClick: () => setRejected.mutate({ key: h.key, rejected: true }),
      },
    });
  }

  for (const h of hints.filter((x) => x.active && !x.stated)) {
    const used = appliedKeys.has(h.key);
    rows.push({
      key: `hint:${h.key}`,
      origin: 'learned',
      what: describeHint(h),
      why: t(used ? 'calendar.standing.learned.used' : 'calendar.standing.learned.idle'),
      note: t(
        h.evidence === 1
          ? 'calendar.standing.evidence.one'
          : 'calendar.standing.evidence.other',
        { count: h.evidence },
      ),
      action: {
        label: t('calendar.standing.forget.hint'),
        onClick: () => setRejected.mutate({ key: h.key, rejected: true }),
      },
    });
  }
  for (const a of applied.filter((x) => !hintKeys.has(x.key))) {
    rows.push({
      key: `applied:${a.key}`,
      origin: 'learned',
      what: describeHint({ key: a.key, value: a.value, claim: a.label }),
      why: t('calendar.standing.learned.used'),
      note: t(
        a.evidence === 1
          ? 'calendar.standing.evidence.one'
          : 'calendar.standing.evidence.other',
        { count: a.evidence },
      ),
    });
  }

  // 3. What nobody said, so we decided. The rows that carry a correction.
  assumptions.forEach((r, i) => {
    rows.push({
      key: `gap:${r.key}`,
      origin: r.filledBy === 'derived' ? 'assumed' : 'default',
      what: r.what,
      why: r.because ?? t('calendar.standing.nothing'),
      gapIndex: i,
    });
  });

  // 4. Below the line: everything that governs nothing. A belief still counting
  //    days, a stereotype about businesses like this one, and what they told us
  //    to forget -- each said plainly so no belief ever appears fully formed.
  for (const h of hints.filter((x) => !x.active && !x.rejected)) {
    rows.push({
      key: `forming:${h.key}`,
      origin: 'watching',
      what: describeHint(h),
      why: t('calendar.standing.watching.why', {
        evidence: h.evidence,
        needed: h.needed,
      }),
      muted: true,
    });
  }
  for (const s of suggestions) {
    rows.push({
      key: `typical:${s.key}`,
      origin: 'typical',
      what: suggestionLabel(s),
      why: t('calendar.standing.typical.why'),
      muted: true,
    });
  }
  for (const h of hints.filter((x) => x.rejected)) {
    rows.push({
      key: `forgotten:${h.key}`,
      origin: 'forgotten',
      what: describeHint(h),
      why: t('calendar.standing.forgotten.why'),
      muted: true,
      action: {
        label: t('calendar.standing.reuse'),
        onClick: () => setRejected.mutate({ key: h.key, rejected: false }),
      },
    });
  }

  if (rows.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-amber-200/70 bg-amber-50/60 p-4">
      <h3 className="text-sm font-semibold text-amber-900">
        {t('calendar.standing.title')}
      </h3>
      <p className="mt-0.5 text-xs text-amber-800/80">{t('calendar.standing.help')}</p>

      <ul className="mt-3 space-y-2">
        {rows.map((row, i) => (
          <Fragment key={row.key}>
            {/* One line between what governs the rota and what does not. The
                pills already say which is which; this is so the eye does not
                have to read them to find where the rules stop. */}
            {row.muted && !rows[i - 1]?.muted && (
              <li className="flex items-center gap-2 pt-1" aria-hidden="true">
                <span className="text-[11px] font-medium uppercase tracking-wide text-amber-800/70">
                  {t('calendar.standing.notYet')}
                </span>
                <span className="h-px flex-1 bg-amber-200" />
              </li>
            )}
          <li
            className={`flex items-start gap-2 rounded-lg border border-amber-200/70 px-3 py-2 ${
              row.muted ? 'bg-white/[0.02]' : 'bg-surface'
            }`}
          >
            {/* Fixed width once there is room for it: the pills are what the
                eye reads down this list, and ragged ones put every claim at a
                different indent. It goes back to hugging its text on a phone,
                where a column of that width is a third of the screen. */}
            <span
              className={`mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-medium sm:w-[7.25rem] ${
                PILL_TONE[row.origin]
              }`}
            >
              {t(PILL_LABEL[row.origin])}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm ${
                  row.muted ? 'text-gray-500' : 'text-gray-900'
                } ${row.origin === 'forgotten' ? 'line-through' : ''}`}
              >
                {row.what}
              </p>
              {/* No reason is not a blank line: it is the admission that
                  nothing in the brief pointed at this number, which is the
                  whole difference between a defensible figure and a
                  constant. */}
              {row.why && <p className="mt-0.5 text-xs text-gray-500">{row.why}</p>}
              {row.gapIndex !== undefined && onCorrect && isCorrectable(gaps[row.gapIndex]) && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number.parseInt(draft[row.key] ?? '', 10);
                    // Zero people is not a correction, it is a closure, and
                    // it is said by closing the day rather than by emptying
                    // a requirement the brief asked for.
                    if (!Number.isFinite(n) || n < 1 || n > 50) return;
                    onCorrect?.(gaps[row.gapIndex as number], n);
                  }}
                >
                  <label className="text-xs text-gray-500" htmlFor={`fix-${row.key}`}>
                    {t('calendar.standing.change.label')}
                  </label>
                  <input
                    id={`fix-${row.key}`}
                    type="number"
                    min={1}
                    max={50}
                    placeholder={String(assumedStaff(gaps[row.gapIndex], spec))}
                    value={draft[row.key] ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [row.key]: e.target.value }))
                    }
                    className="w-16 rounded-lg border border-gray-400 px-2 py-1 text-sm hover:border-gray-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
                  />
                  <span className="text-xs text-gray-500">
                    {t('calendar.standing.change.people')}
                  </span>
                  <button
                    type="submit"
                    className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    {t('calendar.standing.change.apply')}
                  </button>
                </form>
              )}
            </div>
            {row.note && (
              <span className="shrink-0 text-xs text-gray-500">{row.note}</span>
            )}
            {row.action && (
              <button
                type="button"
                onClick={row.action.onClick}
                className={
                  row.secondary
                    ? 'shrink-0 rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white shadow-[0_8px_20px_-10px_rgb(68_214_180/0.6)] hover:bg-brand-deep'
                    : 'shrink-0 text-xs text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline'
                }
              >
                {row.action.label}
              </button>
            )}
            {row.secondary && (
              <button
                type="button"
                onClick={row.secondary.onClick}
                className="shrink-0 text-xs text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
              >
                {row.secondary.label}
              </button>
            )}
          </li>
          </Fragment>
        ))}
      </ul>
    </section>
  );
}
