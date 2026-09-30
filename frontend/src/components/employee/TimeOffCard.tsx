// Time off, from the employee's side: what is left, what they have asked for,
// and one button to ask for more.
//
// Requests land as `requested`, never `approved` -- the manager decides. The
// scheduler already treats a pending request as a soft signal and plans around
// it where it can, so asking early genuinely helps.

import { useMemo, useState, type FormEvent } from 'react';
import { useAbsences, useAbsenceTypes, useCreateAbsence } from '../../api/absences';
import { useVacationBalance } from '../../api/vacation';
import { getErrorMessage } from '../../lib/api';
import { absenceStatusLabel, absenceTypeLabel, formatDate } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Input } from '../Input';
import { Modal } from '../Modal';
import { Select } from '../Select';

const today = () => new Date().toISOString().slice(0, 10);

/** A calendar day, as the half-open instant range the API stores. */
function dayRange(from: string, to: string): { start: string; end: string } {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return {
    start: new Date(fy, fm - 1, fd).toISOString(),
    // Exclusive end: asking off for a single day means that whole day.
    end: new Date(ty, tm - 1, td + 1).toISOString(),
  };
}

export function TimeOffCard({ employeeId }: { employeeId: string }) {
  const t = useT();
  const balance = useVacationBalance(employeeId);
  const absences = useAbsences();
  const types = useAbsenceTypes();
  const create = useCreateAbsence();

  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [note, setNote] = useState('');

  const typeName = useMemo(() => {
    const map = new Map(
      (types.data ?? []).map((type) => [type.id, absenceTypeLabel(type)]),
    );
    return (id: string) => map.get(id) ?? t('employee.timeOff.defaultType');
  }, [types.data, t]);

  // The server already scopes this to the signed-in employee; ordering here is
  // just so the soonest request is the one you see first.
  const mine = useMemo(
    () =>
      [...(absences.data ?? [])]
        .filter((a) => a.status !== 'cancelled')
        .sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [absences.data],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const chosen = typeId || types.data?.[0]?.id;
    if (!chosen) return;
    const { start, end } = dayRange(from, to);
    create.mutate(
      {
        employee_id: employeeId,
        absence_type_id: chosen,
        start_at: start,
        end_at: end,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setNote('');
        },
      },
    );
  };

  return (
    <section className="sc-glass rounded-3xl">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {t('employee.timeOff.title')}
          </h2>
          {balance.data && (
            <p className="mt-0.5 text-sm text-gray-500">
              {t(
                balance.data.balance_days === 1
                  ? 'employee.timeOff.balance.one'
                  : 'employee.timeOff.balance.other',
                { days: balance.data.balance_days },
              )}
            </p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t('employee.timeOff.request')}
        </Button>
      </header>

      <div className="px-5 py-4">
        {mine.length === 0 ? (
          <p className="text-sm text-gray-500">{t('employee.timeOff.empty')}</p>
        ) : (
          <ul className="space-y-2.5">
            {mine.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {typeName(a.absence_type_id)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDate(a.start_at)} → {formatDate(a.end_at)}
                  </p>
                </div>
                <Badge
                  tone={
                    a.status === 'approved'
                      ? 'green'
                      : a.status === 'rejected'
                        ? 'red'
                        : 'amber'
                  }
                >
                  {absenceStatusLabel(a.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('employee.timeOff.modal.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('employee.timeOff.cancel')}
            </Button>
            <Button type="submit" form="time-off-form" disabled={create.isPending}>
              {create.isPending
                ? t('employee.timeOff.sending')
                : t('employee.timeOff.send')}
            </Button>
          </>
        }
      >
        <form id="time-off-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="rounded-xl bg-brand-50 px-3 py-2.5 text-xs text-brand-800 ring-1 ring-inset ring-brand-300/20">
            {t('employee.timeOff.modal.note')}
          </p>
          <Select
            label={t('employee.timeOff.field.type')}
            value={typeId || types.data?.[0]?.id || ''}
            onChange={(e) => setTypeId(e.target.value)}
          >
            {(types.data ?? []).map((type) => (
              <option key={type.id} value={type.id}>
                {absenceTypeLabel(type)}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('employee.timeOff.field.from')}
              type="date"
              required
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (e.target.value > to) setTo(e.target.value);
              }}
            />
            <Input
              label={t('employee.timeOff.field.to')}
              type="date"
              required
              min={from}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Input
            label={t('employee.timeOff.field.note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('employee.timeOff.field.notePlaceholder')}
          />
          {create.isError && (
            <p className="text-sm text-red-600">{getErrorMessage(create.error)}</p>
          )}
        </form>
      </Modal>
    </section>
  );
}
