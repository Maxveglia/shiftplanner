// The bridge from the brief to the roster: when the manager describes their
// team in words, this shows exactly what will change in the Employees section
// and lets them confirm line by line. Nothing is written until they apply — the
// human-in-the-loop contract, same as the scheduling rules.

import { useMemo, useState } from 'react';
import { Button } from '../Button';
import { employmentStatusLabel, employmentTypeLabel } from '../../lib/format';
import { translate } from '../../lib/i18n/core';
import { useT } from '../../lib/i18n';
import { APP_LOCALE } from '../../lib/locale';
import type { ApplySelection } from '../../lib/roster/apply';
import { describePremiums, type RosterPlan } from '../../lib/roster/reconcile';

interface TeamProposalProps {
  plan: RosterPlan;
  onApply: (selection: ApplySelection) => void;
  onDismiss: () => void;
  isApplying: boolean;
}

function Row({
  checked,
  onToggle,
  title,
  detail,
  tone = 'default',
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  detail: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-surface px-3 py-2 transition-colors hover:border-white/15 hover:bg-white/[0.03] motion-reduce:transition-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className={[
          'mt-0.5 h-4 w-4 rounded border-white/25',
          tone === 'danger' ? 'text-red-600' : 'text-brand-300',
        ].join(' ')}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">{title}</span>
        <span
          className={[
            'block text-xs',
            tone === 'danger' ? 'text-red-600' : 'text-gray-500',
          ].join(' ')}
        >
          {detail}
        </span>
      </span>
    </label>
  );
}

export function TeamProposal({
  plan,
  onApply,
  onDismiss,
  isApplying,
}: TeamProposalProps) {
  const t = useT();
  // Creates and updates start checked; retirements start OFF — you opt into
  // removing someone, you never do it by missing a checkbox.
  const [sel, setSel] = useState<ApplySelection>(() => ({
    creates: new Set(plan.creates.map((c) => c.key)),
    updates: new Set(plan.updates.map((u) => u.key)),
    resignations: new Set<string>(),
  }));

  const toggle = (bucket: keyof ApplySelection, key: string) =>
    setSel((prev) => {
      const next = new Set(prev[bucket]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [bucket]: next };
    });

  const total = useMemo(
    () => sel.creates.size + sel.updates.size + sel.resignations.size,
    [sel],
  );

  // Additions and term changes are written the moment the brief is understood,
  // so most of the time this card is here for one reason only: someone is on
  // the roster that the brief did not mention.
  const retireOnly =
    plan.creates.length === 0 && plan.updates.length === 0;

  return (
    <div className="m-rise mt-4 rounded-2xl border border-brand-200/60 bg-brand-50/60 p-5 shadow-[0_24px_60px_-36px_rgb(0_0_0/0.8)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {retireOnly
              ? t('schedule.teamProposal.title.retireOnly')
              : t('schedule.teamProposal.title.default')}
          </h2>
          <p className="mt-0.5 text-sm text-gray-600">
            {retireOnly
              ? t('schedule.teamProposal.body.retireOnly')
              : t('schedule.teamProposal.body.default')}
          </p>
        </div>
        <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
          {retireOnly
            ? t('schedule.teamProposal.badge.retireOnly', {
                retires: plan.resignations.length,
              })
            : t('schedule.teamProposal.badge.summary', {
                adds: plan.creates.length,
                updates: plan.updates.length,
                retires: plan.resignations.length,
              })}
        </span>
      </div>

      {plan.creates.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            {t('schedule.teamProposal.section.creates')}
          </p>
          <div className="space-y-1.5">
            {plan.creates.map((c) => (
              <Row
                key={c.key}
                checked={sel.creates.has(c.key)}
                onToggle={() => toggle('creates', c.key)}
                title={t('schedule.teamProposal.create.title', {
                  name: c.name,
                  status: employmentStatusLabel(c.status),
                })}
                detail={t('schedule.teamProposal.create.detail', {
                  terms: c.contract
                    ? describeDraft(c)
                    : t('schedule.teamProposal.create.noTerms'),
                  reason: c.reason,
                })}
              />
            ))}
          </div>
        </div>
      )}

      {plan.updates.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            {t('schedule.teamProposal.section.updates')}
          </p>
          <div className="space-y-1.5">
            {plan.updates.map((u) => (
              <Row
                key={u.key}
                checked={sel.updates.has(u.key)}
                onToggle={() => toggle('updates', u.key)}
                title={u.name}
                detail={u.changes.join(' · ')}
              />
            ))}
          </div>
        </div>
      )}

      {plan.resignations.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-red-600">
            {t('schedule.teamProposal.section.resignations')}
          </p>
          <div className="space-y-1.5">
            {plan.resignations.map((r) => (
              <Row
                key={r.key}
                tone="danger"
                checked={sel.resignations.has(r.key)}
                onToggle={() => toggle('resignations', r.key)}
                title={r.name}
                detail={t('schedule.teamProposal.resign.detail')}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={() => onApply(sel)} disabled={isApplying || total === 0}>
          {isApplying
            ? t('schedule.teamProposal.apply.applying')
            : total === 0
              ? t('schedule.teamProposal.apply.none')
              : total === 1
                ? t('schedule.teamProposal.apply.one')
                : t('schedule.teamProposal.apply.other', { count: total })}
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={isApplying}
          className="rounded-lg px-2 py-1 text-sm text-gray-600 transition-colors hover:bg-white/[0.06] hover:text-gray-900 disabled:opacity-60 motion-reduce:transition-none"
        >
          {t('schedule.teamProposal.dismiss')}
        </button>
      </div>
    </div>
  );
}

function describeDraft(c: RosterPlan['creates'][number]): string {
  if (!c.contract) return '';
  const parts: string[] = [];
  parts.push(employmentTypeLabel(c.contract.employmentType));
  if (c.contract.minHoursPerWeek > 0)
    parts.push(
      translate('schedule.teamProposal.draft.minHours', {
        hours: c.contract.minHoursPerWeek,
      }),
    );
  if (c.contract.hourlyRate !== null)
    parts.push(
      translate('schedule.teamProposal.draft.hourlyRate', {
        rate: c.contract.hourlyRate,
      }),
    );
  if (c.contract.annualSalary !== null)
    parts.push(
      translate('schedule.teamProposal.draft.annualSalary', {
        salary: c.contract.annualSalary.toLocaleString(APP_LOCALE),
      }),
    );
  // A premium the brief set for this person is a term they are being hired
  // on, so it is confirmed here with the rest of them.
  parts.push(...describePremiums(c.contract));
  return parts.join(', ');
}
