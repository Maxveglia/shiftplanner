// Before the handover, who it changes what for.
//
// Publishing replaces the window on the server with the draft on screen. It
// used to do that blind. This dialog reads what the server holds RIGHT NOW
// -- its own query, refetched on every open -- diffs the draft against it,
// and puts the count on the button: "Publish 3 changes", and nothing to
// press when there is nothing. If the read fails the publish is still
// allowed, under the plain label and a warning: a failed read must not lock
// the team out of its rota.
//
// AND AFTERWARDS, who was told. The dialog does not vanish on success: the
// publish answers with how many people were emailed and how many could not be,
// and the second number is one a manager has to act on -- pick up a phone,
// or go and put an address on somebody's login. A toast that fades takes that
// away from whoever looked up a second too late, so the dialog stays until it
// is dismissed.
//
// ONE dialog that changes what it says, kept mounted by its caller and closed
// with `open={false}`: the receipt takes the confirmation's place inside the
// same panel, so the page behind stays dimmed throughout, focus stays in the
// dialog (on "Done"), and closing plays the Modal's exit instead of vanishing.

import { useMemo, useRef, type CSSProperties } from 'react';
import { usePublishedSchedule } from '../../api/schedule';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { ChangeList } from './ChangeSummary';
import { getErrorMessage } from '../../lib/api';
import { plural } from '../../lib/i18n/core';
import { useT } from '../../lib/i18n';
import { diffAssignments } from '../../lib/schedule/diff';
import { fromAssignmentOutList } from '../../lib/schedule/persist';
import type { Assignment } from '../../lib/schedule/types';
import type { EmployeeOut, PublishResult, ShiftTemplateOut } from '../../types';
import type { Point } from './calendarMotion';

interface PublishConfirmModalProps {
  open: boolean;
  from: Date;
  to: Date;
  draft: Assignment[];
  employees: EmployeeOut[];
  templates: ShiftTemplateOut[];
  /**
   * Publish. `from` is the centre of the button that was pressed, on screen:
   * where the celebration is thrown from if it goes through (PublishBurst).
   */
  onConfirm: (from?: Point) => void;
  onClose: () => void;
  isPublishing: boolean;
  error: unknown;
  /** What the publish answered, once it has. Null until then. */
  outcome: PublishResult | null;
}

export function PublishConfirmModal({
  open,
  from,
  to,
  draft,
  employees,
  templates,
  onConfirm,
  onClose,
  isPublishing,
  error,
  outcome,
}: PublishConfirmModalProps) {
  const t = useT();
  // Read only while open. `fresh` makes it stale at once, so every opening
  // enables it again and asks the server anew.
  const published = usePublishedSchedule(from, to, open, { fresh: true });
  const liveDiff = useMemo(
    () =>
      open && published.data
        ? diffAssignments(fromAssignmentOutList(published.data, templates), draft)
        : null,
    [open, published.data, templates, draft],
  );
  // While it leaves (`open` false) it keeps saying what it said: without
  // this the body jumped to the amber "could not compare" and the button to
  // its plain label for the length of the exit.
  const shownDiff = useRef(liveDiff);
  if (open) shownDiff.current = liveDiff;
  const diff = open ? liveDiff : shownDiff.current;
  const comparing = published.isPending;
  // While the publish is on its way the dialog cannot be closed -- not by
  // Cancel, Escape, the cross or the backdrop: its answer (who was told, who
  // was not) has to land somewhere the manager will see it.
  const close = () => {
    if (!isPublishing) onClose();
  };

  const label = () => {
    if (isPublishing) return t('dashboard.publish.pending');
    if (comparing) return t('dashboard.publish.confirm.comparing');
    if (!diff) return t('dashboard.publish.cta');
    if (diff.total === 0) return t('dashboard.publish.confirm.nothing');
    return plural(diff.total, 'dashboard.publish.confirm.one', 'dashboard.publish.confirm.other');
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={outcome ? t('dashboard.publish.done.title') : t('dashboard.publish.confirm.title')}
      footer={
        outcome ? (
          // autoFocus: the button pressed to get here went with the
          // confirmation, and focus must not drop out of the dialog. Keyed so
          // it is a new button: without it React reuses "Cancel" (the first
          // button of the same type) and autoFocus, a mount-only prop, does
          // nothing.
          <Button key="done" autoFocus onClick={close}>
            {t('dashboard.publish.done.close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={isPublishing}>
              {t('dashboard.publish.confirm.cancel')}
            </Button>
            <Button
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onConfirm({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
              }}
              disabled={isPublishing || comparing || (diff !== null && diff.total === 0)}
            >
              {label()}
            </Button>
          </>
        )
      }
    >
      {outcome ? (
        <PublishedSummary outcome={outcome} />
      ) : (
        <>
          {comparing ? (
            <p className="text-sm text-gray-500">{t('dashboard.publish.confirm.loading')}</p>
          ) : !diff ? (
            <p className="text-sm text-amber-800">{t('dashboard.publish.confirm.unknown')}</p>
          ) : diff.total === 0 ? (
            <p className="text-sm text-gray-600">{t('dashboard.publish.confirm.none')}</p>
          ) : (
            <ChangeList diff={diff} employees={employees} className="text-sm text-gray-800" />
          )}
          {error != null && (
            <p className="mt-3 text-sm text-red-600">{getErrorMessage(error)}</p>
          )}
        </>
      )}
    </Modal>
  );
}

/**
 * What just happened, and who now knows about it.
 *
 * The two counts are read as optional on purpose: a browser holding this build
 * can be talking to an API that predates them, and "undefined people were
 * told" must come out as silence rather than as a number. When the server does
 * send them, `unreachable` gets its own amber line even at one person -- it is
 * the sentence that sends a manager to find them.
 */
function PublishedSummary({ outcome }: { outcome: PublishResult }) {
  const t = useT();
  const said = outcome.notified ?? null;
  const missed = outcome.unreachable ?? null;
  // `false` and not "falsy": an API that predates the field says nothing about
  // mail either way, and guessing "not configured" from a missing field would
  // put an explanation on screen that nobody can act on.
  const noMail = outcome.mail_configured === false;

  return (
    <>
      <p className="m-rise text-sm text-gray-800">
        {plural(
          outcome.published,
          'dashboard.publish.done.shifts.one',
          'dashboard.publish.done.shifts.other',
        )}
      </p>
      {said !== null && said > 0 && (
        <p className="m-rise mt-2 text-sm text-gray-600" style={{ '--d': '80ms' } as CSSProperties}>
          {plural(
            said,
            'dashboard.publish.done.notified.one',
            'dashboard.publish.done.notified.other',
          )}
        </p>
      )}
      {missed !== null && missed > 0 && (
        <p className="m-rise mt-2 text-sm text-amber-800" style={{ '--d': '160ms' } as CSSProperties}>
          {noMail
            ? t('dashboard.publish.done.noMail')
            : plural(
                missed,
                'dashboard.publish.done.unreachable.one',
                'dashboard.publish.done.unreachable.other',
              )}
        </p>
      )}
      {(outcome.skipped_on_leave ?? 0) > 0 && (
        <p className="m-rise mt-2 text-sm text-amber-800" style={{ '--d': '240ms' } as CSSProperties}>
          {plural(
            outcome.skipped_on_leave!,
            'dashboard.publish.done.onLeave.one',
            'dashboard.publish.done.onLeave.other',
          )}
        </p>
      )}
      {said === 0 && missed === 0 && (
        <p className="m-rise mt-2 text-sm text-gray-500" style={{ '--d': '80ms' } as CSSProperties}>{t('dashboard.publish.done.nobody')}</p>
      )}
    </>
  );
}
