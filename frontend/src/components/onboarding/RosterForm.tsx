// The team, as rows to fill in rather than a list to type.
//
// It appears under the question the model asked (the turn comes back flagged
// `form: "roster"`), and what it produces is not a payload of its own: it is
// the manager's own next message, composed by lib/onboarding/roster and sent
// like anything they could have typed. That is the whole trick -- the
// conversation stays one conversation, and a manager who would rather write
// "somos seis, cuatro de 40" still can, in the box underneath.
//
// The hours column is a list to pick from rather than a number to type: the
// contracts a small business writes are a handful of lengths, and picking one
// is a tap where typing is a decision. The last option opens a box, so the
// list is a shortcut and never a limit -- and "no fixed hours" is up there
// with the rest, because somebody without a contract is a real answer and a
// form that demands a number gets an invented one.
//
// The rows are not empty when it opens: the manager said how many people work
// there one question earlier, and the table comes with a row each (see
// `entriesFor`). What is left to do is put a name on each line.

import { useState } from 'react';
import { Button } from '../Button';
import { formatDecimal } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { FIELD_SKIN, fieldTone } from '../Input';
import {
  emptyEntry,
  HOURS_OPTIONS,
  namedEntries,
  parseHours,
  type ContractHours,
  type RosterEntry,
} from '../../lib/onboarding/roster';

/** What the hours dropdown holds besides the lengths themselves. */
const UNSAID = '';
const NO_HOURS = 'none';
const OTHER = 'other';

/** Hours as the option value that stands for them. */
function hoursValue(hours: ContractHours): string {
  if (hours === null) return UNSAID;
  if (hours === 'none') return NO_HOURS;
  return HOURS_OPTIONS.includes(hours) ? String(hours) : OTHER;
}

export function RosterForm({
  entries,
  onChange,
  onDone,
  disabled = false,
}: {
  entries: RosterEntry[];
  onChange: (entries: RosterEntry[]) => void;
  /** Send what has been filled in as the manager's answer. */
  onDone: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const ready = namedEntries(entries).length > 0;
  // The rows whose hours are being typed rather than picked. Kept here and
  // not on the entry: it is which control is on screen, not a fact about the
  // person, and it has to survive the number being cleared mid-typing.
  const [custom, setCustom] = useState<Record<string, boolean>>({});

  const patch = (id: string, change: Partial<RosterEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...change } : e)));

  return (
    <div>
      <p className="text-xs text-gray-500">{t('interview.roster.help')}</p>

      <div className="mt-3 space-y-2">
        {/* Column headings once, not a label per row: seven rows of "Name"
            and "Hours a week" is the form shouting its own structure. */}
        <div className="flex items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
          <span className="flex-1">{t('interview.roster.name')}</span>
          <span className="w-28 shrink-0 text-right sm:w-32">
            {t('interview.roster.hours')}
          </span>
          <span className="w-6 shrink-0" />
        </div>

        {entries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2">
            <input
              value={entry.name}
              onChange={(e) => patch(entry.id, { name: e.target.value })}
              disabled={disabled}
              placeholder={t('interview.roster.namePlaceholder')}
              aria-label={t('interview.roster.name')}
              className={`min-w-0 flex-1 rounded-xl px-3 py-2 ${FIELD_SKIN} ${fieldTone(false)}`}
            />
            <div className="w-28 shrink-0 sm:w-32">
              {custom[entry.id] ? (
                <div className="relative">
                  <input
                    value={
                      typeof entry.weeklyHours === 'number'
                        ? String(entry.weeklyHours)
                        : ''
                    }
                    onChange={(e) =>
                      patch(entry.id, { weeklyHours: parseHours(e.target.value) })
                    }
                    onBlur={() => {
                      // An empty box on the way out is nobody's contract:
                      // the row goes back to the list rather than keeping a
                      // control that says nothing.
                      if (typeof entry.weeklyHours !== 'number') {
                        setCustom((c) => ({ ...c, [entry.id]: false }));
                      }
                    }}
                    autoFocus
                    disabled={disabled}
                    inputMode="decimal"
                    // The example is a number, so it is written the way the
                    // manager's language writes one. A hard-coded "37,5" was
                    // an English manager being shown a Spanish decimal in the
                    // one box that invites them to copy what they see.
                    placeholder={formatDecimal(37.5)}
                    aria-label={t('interview.roster.hours')}
                    className={`w-full rounded-xl py-2 pl-3 pr-7 ${FIELD_SKIN} ${fieldTone(false)}`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                    h
                  </span>
                </div>
              ) : (
                <select
                  value={hoursValue(entry.weeklyHours)}
                  onChange={(e) => {
                    const picked = e.target.value;
                    if (picked === OTHER) {
                      setCustom((c) => ({ ...c, [entry.id]: true }));
                      patch(entry.id, { weeklyHours: null });
                      return;
                    }
                    const chosen: ContractHours =
                      picked === UNSAID
                        ? null
                        : picked === NO_HOURS
                          ? 'none'
                          : Number(picked);
                    patch(entry.id, { weeklyHours: chosen });
                  }}
                  disabled={disabled}
                  aria-label={t('interview.roster.hours')}
                  className={`w-full rounded-xl px-2 py-2 ${FIELD_SKIN} ${fieldTone(false)}`}
                >
                  {/* An untouched row says "not said yet", never "this one
                      has no contract": the second is a claim, and nobody made
                      it. */}
                  <option value={UNSAID}>{t('interview.roster.hours.pick')}</option>
                  <option value={NO_HOURS}>{t('interview.roster.hours.none')}</option>
                  {HOURS_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {t('interview.roster.hours.option', {
                        hours: formatDecimal(h),
                      })}
                    </option>
                  ))}
                  <option value={OTHER}>{t('interview.roster.hours.other')}</option>
                </select>
              )}
            </div>
            {/* The last row keeps its place: taking it away would leave a form
                with nothing to fill in and no way back. */}
            <button
              type="button"
              onClick={() => onChange(entries.filter((e) => e.id !== entry.id))}
              disabled={disabled || entries.length === 1}
              aria-label={t('interview.roster.remove', {
                name: entry.name.trim() || t('interview.roster.name'),
              })}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-white/10 hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 disabled:opacity-0"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange([...entries, emptyEntry()])}
          disabled={disabled}
          className="rounded text-sm text-brand-300 underline-offset-4 hover:text-brand-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 disabled:opacity-50"
        >
          + {t('interview.roster.add')}
        </button>
        <Button onClick={onDone} disabled={disabled || !ready}>
          {t('interview.roster.continue')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-gray-500">{t('interview.roster.orType')}</p>
    </div>
  );
}
