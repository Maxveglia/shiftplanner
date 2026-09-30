// The one question worth stopping a manager for.
//
// The rest of this product does the opposite, and on purpose: a number the
// brief left open is assumed, drawn, and corrected in a sentence, because a
// manager looking at a rota can SEE a wrong number (see `OpenQuestions`). That
// test is exactly why this one is a modal rather than a panel beside the
// calendar. "Juanito is off from the 15th to the 22nd" draws the SAME CALENDAR
// whether that week is sick leave, holiday, or unpaid: the difference is
// invisible here and shows up in his payslip and in his working year, weeks
// later, when nobody is looking at this screen any more.
//
// It asks about ONE thing, with the consequence of each answer written next to
// it, read off the org's own absence types rather than assumed — a business
// whose sick leave does come off the holiday balance has to see that here.
//
// Several absences in one sentence ("Ana and Luis are both off that week") are
// asked one after another rather than all at once: each is a different person
// and may be a different kind of leave, and a form with two of everything is
// how the second one gets whatever the first one got.
//
// Kept mounted by its caller and closed with `request={null}`: the last
// absence asked about -- and the count of those behind it -- stays on screen
// while the dialog leaves (useLastShown), instead of the dialog vanishing the
// moment it is answered.

import { useMemo } from 'react';
import { absenceTypeLabel, formatDate } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { plural } from '../../lib/i18n/core';
import { consequenceOf } from '../../lib/roster/absenceKind';
import type { AbsenceRequest } from '../../lib/roster/ops';
import type { AbsenceTypeOut } from '../../types';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { useLastShown } from '../motion/useDialogMotion';

interface AbsenceKindModalProps {
  /** The absence being asked about — who, and which days; null when none is. */
  request: AbsenceRequest | null;
  /** How many are still queued behind this one, for the counter. */
  remaining: number;
  types: AbsenceTypeOut[];
  onChoose: (type: AbsenceTypeOut) => void;
  onCancel: () => void;
}

export function AbsenceKindModal({
  request,
  remaining,
  types,
  onChoose,
  onCancel,
}: AbsenceKindModalProps) {
  const t = useT();
  // One value, so what is kept for the exit is the question AND its counter
  // as they were; memoised so it is the same object while nothing changes.
  const asked = useMemo(
    () => (request ? { request, remaining } : null),
    [request, remaining],
  );
  const last = useLastShown(asked);
  if (!last) return null;
  const shown = last.request;
  const more = last.remaining;
  const who =
    shown.from === shown.to
      ? t('roster.absenceKind.forOne', {
          name: shown.employee,
          from: formatDate(shown.from),
        })
      : t('roster.absenceKind.forRange', {
          name: shown.employee,
          from: formatDate(shown.from),
          to: formatDate(shown.to),
        });

  return (
    <Modal
      open={request !== null}
      onClose={onCancel}
      title={t('roster.absenceKind.title')}
      footer={
        <Button variant="secondary" onClick={onCancel}>
          {t('roster.absenceKind.cancel')}
        </Button>
      }
    >
      <p className="text-sm font-medium text-gray-900">{who}</p>
      <p className="mt-1 text-sm text-gray-500">{t('roster.absenceKind.why')}</p>

      {types.length === 0 ? (
        <p className="mt-4 text-sm text-amber-800">
          {t('roster.absenceKind.noTypes')}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {types.map((type) => {
            const consequence = consequenceOf(type);
            // The consequence, in the manager's own set-up. Read off the row
            // rather than assumed from the name: "Sick" is not paid
            // everywhere, and this question is the last place to be wrong
            // about that.
            const notes = [
              consequence.paid
                ? t('roster.absenceKind.paid')
                : t('roster.absenceKind.unpaid'),
              consequence.consumesBalance
                ? t('roster.absenceKind.consumesBalance')
                : null,
              consequence.recoverable
                ? t('roster.absenceKind.recoverable')
                : null,
            ].filter(Boolean);
            return (
              <li key={type.id}>
                <button
                  type="button"
                  onClick={() => onChoose(type)}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:border-brand-400 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
                >
                  <span className="block text-sm font-medium text-gray-900">
                    {absenceTypeLabel(type)}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {notes.join(' · ')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {more > 0 && (
        <p className="mt-4 text-xs text-gray-500">
          {plural(
            more,
            'roster.absenceKind.more.one',
            'roster.absenceKind.more.other',
          )}
        </p>
      )}
    </Modal>
  );
}
