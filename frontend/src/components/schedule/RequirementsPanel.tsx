// Everything the AI needs to build a schedule: the shift catalogue it may
// choose from, the pay premiums that price an hour, and the labour rules it
// must respect.
//
// This lived under the brief on the dashboard, folded into a strip that named
// every template with a colour swatch. The manager asked for the strip to go
// -- the calendar is one colour now, so a swatch per template explained
// nothing -- and the panel moved to Settings, where configuration the
// scheduler consumes but a manager rarely revisits belongs.

import { useState, type FormEvent } from 'react';
import { useShiftTemplates, useCreateShiftTemplate } from '../../api/shiftTemplates';
import { useLaborProfiles } from '../../api/laborProfiles';
import { Button } from '../Button';
import { getErrorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';
import {
  jurisdictionLabel,
  laborNote,
  ruleTypeLabel,
  ruleUnitLabel,
  shiftTemplateLabel,
} from '../../lib/format';
import { APP_LOCALE } from '../../lib/locale';
import { Modal } from '../Modal';
import { Input } from '../Input';
import type { ShiftTemplateCreate } from '../../types';
import type { PayPolicy } from '../../lib/schedule/payroll';
import { applicableProfiles } from '../../lib/schedule/jurisdiction';

const emptyForm: ShiftTemplateCreate = {
  name: '',
  start_time: '09:00',
  end_time: '17:00',
  unpaid_break_minutes: 30,
  color: '#3B82F6',
  is_night: false,
  is_weekend_premium: false,
};

/**
 * "09:00" -> "9:00 AM" in English, "9:00" in Spanish.
 *
 * The 12-hour clock is a convention of the locale, not of the product, so it
 * comes from the formatter rather than from a hand-built "AM"/"PM" suffix --
 * the same rule spec.ts and DayGrid follow.
 */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString(APP_LOCALE, { hour: 'numeric', minute: '2-digit' });
}

interface RequirementsPanelProps {
  policy: PayPolicy;
  onPolicyChange: (p: PayPolicy) => void;
  jurisdiction: string;
  onJurisdictionChange: (code: string) => void;
  /** Wage floor the manager entered, or null while it is unset. */
  minimumWage: number | null;
  onMinimumWageChange: (v: number | null) => void;
  /** What the last save of the policy answered, when it refused. */
  policyError?: unknown;
}

export function RequirementsPanel({
  policy,
  onPolicyChange,
  jurisdiction,
  onJurisdictionChange,
  minimumWage,
  onMinimumWageChange,
  policyError,
}: RequirementsPanelProps) {
  const t = useT();
  const templates = useShiftTemplates();
  const profiles = useLaborProfiles();
  const createTemplate = useCreateShiftTemplate();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ShiftTemplateCreate>(emptyForm);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    createTemplate.mutate(form, {
      onSuccess: () => {
        setOpen(false);
        setForm(emptyForm);
      },
    });
  };

  const list = templates.data ?? [];
  // The rules the scheduler actually enforces, summarised in one line.
  // Only the rules that actually apply where this business operates, walking
  // the chain (e.g. Arizona then federal). Showing California rules to a
  // Phoenix manager would be worse than showing none.
  const chain = applicableProfiles(profiles.data ?? [], jurisdiction);
  const hardRules = chain.flatMap((p) =>
    p.rules
      .filter((r) => r.hardness === 'hard')
      .map((r) => ({ jurisdiction: p.jurisdiction_code, rule: r })),
  );

  return (
    <div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="pb-2 font-medium">
                    {t('schedule.requirements.table.shift')}
                  </th>
                  <th className="pb-2 font-medium">
                    {t('schedule.requirements.table.hours')}
                  </th>
                  <th className="pb-2 font-medium">
                    {t('schedule.requirements.table.break')}
                  </th>
                  <th className="pb-2 font-medium">
                    {t('schedule.requirements.table.flags')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {list.map((tpl) => (
                  <tr key={tpl.id}>
                    <td className="py-2">
                      <span className="font-medium text-gray-900">
                        {shiftTemplateLabel(tpl)}
                      </span>
                    </td>
                    <td className="py-2 text-gray-600">
                      {clock(tpl.start_time)} – {clock(tpl.end_time)}
                    </td>
                    <td className="py-2 text-gray-600">
                      {t('schedule.requirements.breakMinutes', {
                        n: tpl.unpaid_break_minutes,
                      })}
                    </td>
                    <td className="py-2">
                      <span className="flex flex-wrap gap-1">
                        {tpl.is_night && (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 ring-1 ring-inset ring-brand-200/50">
                            {t('schedule.requirements.flag.night')}
                          </span>
                        )}
                        {tpl.is_weekend_premium && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                            {t('schedule.requirements.flag.weekend')}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              {t('schedule.requirements.addTemplate')}
            </Button>
          </div>

          {/* Pay premiums: what an hour actually costs, by when it is worked. */}
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              {t('schedule.requirements.premiums.title')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                {t('schedule.requirements.premiums.night')}
                <span className="inline-flex items-center">
                  +
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={policy.nightDifferentialPct}
                    onChange={(e) =>
                      onPolicyChange({
                        ...policy,
                        nightDifferentialPct: Number(e.target.value) || 0,
                      })
                    }
                    className="mx-1 w-14 rounded-lg border border-gray-400 px-2 py-1 text-sm tabular-nums hover:border-gray-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
                  />
                  %
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                {t('schedule.requirements.premiums.weekend')}
                <span className="inline-flex items-center">
                  +
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={policy.weekendPremiumPct}
                    onChange={(e) =>
                      onPolicyChange({
                        ...policy,
                        weekendPremiumPct: Number(e.target.value) || 0,
                      })
                    }
                    className="mx-1 w-14 rounded-lg border border-gray-400 px-2 py-1 text-sm tabular-nums hover:border-gray-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
                  />
                  %
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                {t('schedule.requirements.premiums.minimumWage')}
                <span className="inline-flex items-center">
                  $
                  <input
                    type="number"
                    min={0}
                    step="0.05"
                    placeholder={t(
                      'schedule.requirements.premiums.minimumWagePlaceholder',
                    )}
                    value={minimumWage ?? ''}
                    onChange={(e) =>
                      onMinimumWageChange(
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                    className="ml-1 w-20 rounded-lg border border-gray-400 px-2 py-1 text-sm tabular-nums placeholder:text-gray-500 hover:border-gray-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
                  />
                  /h
                </span>
              </label>
              <span className="text-xs text-gray-500">
                {t('schedule.requirements.premiums.note')}
              </span>
            </div>
            {/* A refused save used to leave the typed number sitting there as
                if it had been stored. Say so, in the one place the numbers
                are. */}
            {policyError != null && (
              <p className="mt-2 text-sm text-red-600">
                {t('schedule.requirements.premiums.notSaved')}{' '}
                {getErrorMessage(policyError)}
              </p>
            )}
          </div>

          {/* Labour rules: context the AI must respect, not a settings page. */}
          {hardRules.length > 0 && (
            <div className="mt-4 border-t border-white/[0.06] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {t('schedule.requirements.rules.title')}
                </p>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  {t('schedule.requirements.rules.where')}
                  <select
                    value={jurisdiction}
                    onChange={(e) => onJurisdictionChange(e.target.value)}
                    className="rounded-lg border border-gray-400 px-2 py-1 text-sm hover:border-gray-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
                  >
                    {(profiles.data ?? []).map((p) => (
                      <option key={p.id} value={p.jurisdiction_code}>
                        {jurisdictionLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {hardRules.map(({ jurisdiction: code, rule }) => {
                  // A rule with no threshold states an ABSENCE ("no daily
                  // overtime in Arizona"). Those matter just as much: they stop
                  // a manager assuming California rules apply.
                  const isAbsence = rule.threshold == null;
                  return (
                    <span
                      key={rule.id}
                      title={laborNote(code, rule) ?? undefined}
                      className={[
                        'rounded-full px-2.5 py-1 text-xs',
                        // A rule the calendar is built to, not an error:
                        // menta, the product's own voice, never red.
                        isAbsence
                          ? 'bg-white/[0.05] text-gray-600 ring-1 ring-inset ring-white/10'
                          : 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200/60',
                      ].join(' ')}
                    >
                      {code} · {ruleTypeLabel(rule.rule_type)}
                      {rule.threshold != null &&
                        ` ${rule.threshold} ${ruleUnitLabel(rule.unit)}`.trimEnd()}
                      {rule.premium_multiplier ? ` → ${rule.premium_multiplier}x` : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('schedule.requirements.addTemplate')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('schedule.requirements.form.cancel')}
            </Button>
            <Button type="submit" form="shift-form" disabled={createTemplate.isPending}>
              {createTemplate.isPending
                ? t('schedule.requirements.form.creating')
                : t('schedule.requirements.form.create')}
            </Button>
          </>
        }
      >
        <form id="shift-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input
            label={t('schedule.requirements.form.name')}
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('schedule.requirements.form.start')}
              type="time"
              required
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
            <Input
              label={t('schedule.requirements.form.end')}
              type="time"
              required
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
          </div>
          <Input
            label={t('schedule.requirements.form.break')}
            type="number"
            min={0}
            value={String(form.unpaid_break_minutes)}
            onChange={(e) =>
              setForm({
                ...form,
                unpaid_break_minutes: Number(e.target.value) || 0,
              })
            }
          />
          <Input
            label={t('schedule.requirements.form.colour')}
            type="color"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
          />
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_night}
                onChange={(e) => setForm({ ...form, is_night: e.target.checked })}
              />
              {t('schedule.requirements.form.night')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_weekend_premium}
                onChange={(e) =>
                  setForm({ ...form, is_weekend_premium: e.target.checked })
                }
              />
              {t('schedule.requirements.form.weekend')}
            </label>
          </div>
        </form>
      </Modal>
    </div>
  );
}
