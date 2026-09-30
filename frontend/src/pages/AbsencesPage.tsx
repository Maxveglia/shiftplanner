import { useMemo, useState, type FormEvent } from 'react';
import {
  useAbsences,
  useAbsenceTypes,
  useSetAbsenceTypeRecoverable,
  useApproveAbsence,
  useCreateAbsence,
} from '../api/absences';
import { useEmployees } from '../api/employees';
import { getErrorMessage } from '../lib/api';
import {
  absenceStatusLabel,
  absenceTypeLabel,
  formatDateTime,
  formatHours,
} from '../lib/format';
import { useT } from '../lib/i18n';
import { plural } from '../lib/i18n/core';
import type { AbsenceApprovedOut, AbsenceCreate, AbsenceStatus } from '../types';
import { PageHeader } from './DashboardLayout';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Spinner, StateMessage } from '../components/StateMessage';
import { Table, TBody, TD, TH, THead, TR } from '../components/Table';

const statusTone: Record<AbsenceStatus, 'amber' | 'green' | 'red' | 'gray'> = {
  requested: 'amber',
  approved: 'green',
  rejected: 'red',
  cancelled: 'gray',
};

function nowLocalInput(offsetHours = 0): string {
  const d = new Date();
  d.setHours(d.getHours() + offsetHours);
  d.setMinutes(0, 0, 0);
  // datetime-local wants YYYY-MM-DDTHH:MM in local time.
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

export function AbsencesPage() {
  const t = useT();
  const absences = useAbsences();
  const absenceTypes = useAbsenceTypes();
  const setRecoverable = useSetAbsenceTypeRecoverable();
  const employees = useEmployees();
  const createAbsence = useCreateAbsence();
  const approveAbsence = useApproveAbsence();
  // The last approval's damage to the rota, kept on screen until the next
  // one. It is not an error and not a toast: it is a piece of work handed to
  // the manager -- hours that had somebody behind them a second ago.
  const [cleared, setCleared] = useState<AbsenceApprovedOut | null>(null);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AbsenceCreate>(() => ({
    employee_id: '',
    absence_type_id: '',
    start_at: nowLocalInput(),
    end_at: nowLocalInput(8),
    note: null,
  }));

  const employeeName = useMemo(() => {
    const map = new Map<string, string>();
    employees.data?.forEach((e) => map.set(e.id, e.full_name));
    return map;
  }, [employees.data]);

  // `t` is in the deps although it is not read here: the names come out of
  // `absenceTypeLabel`, which resolves in the language chosen now, so this map
  // has to be rebuilt when the manager switches languages.
  const typeName = useMemo(() => {
    const map = new Map<string, string>();
    absenceTypes.data?.forEach((type) => map.set(type.id, absenceTypeLabel(type)));
    return map;
  }, [absenceTypes.data, t]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload: AbsenceCreate = {
      ...form,
      start_at: new Date(form.start_at).toISOString(),
      end_at: new Date(form.end_at).toISOString(),
      note: form.note?.trim() ? form.note.trim() : null,
    };
    createAbsence.mutate(payload, {
      onSuccess: () => setOpen(false),
    });
  };

  return (
    <div>
      <PageHeader
        title={t('people.absences.title')}
        description={t('people.absences.description')}
        actions={
          <Button onClick={() => setOpen(true)}>
            {t('people.absences.request')}
          </Button>
        }
      />

      <Card>
        {absences.isLoading ? (
          <Spinner />
        ) : absences.isError ? (
          <StateMessage
            tone="error"
            title={t('people.absences.loadError')}
            description={getErrorMessage(absences.error)}
          />
        ) : (absences.data?.length ?? 0) === 0 ? (
          <StateMessage title={t('people.absences.empty.title')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('people.absences.col.employee')}</TH>
                <TH>{t('people.absences.col.type')}</TH>
                <TH>{t('people.absences.col.from')}</TH>
                <TH>{t('people.absences.col.to')}</TH>
                <TH>{t('people.absences.col.status')}</TH>
                <TH>{t('people.absences.col.action')}</TH>
              </TR>
            </THead>
            <TBody>
              {absences.data!.map((a) => (
                <TR key={a.id}>
                  <TD className="font-medium text-gray-900">
                    {employeeName.get(a.employee_id) ?? a.employee_id}
                  </TD>
                  <TD>{typeName.get(a.absence_type_id) ?? a.absence_type_id}</TD>
                  <TD>{formatDateTime(a.start_at)}</TD>
                  <TD>{formatDateTime(a.end_at)}</TD>
                  <TD>
                    <Badge tone={statusTone[a.status]}>
                      {absenceStatusLabel(a.status)}
                    </Badge>
                  </TD>
                  <TD>
                    {a.status === 'requested' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={approveAbsence.isPending}
                        onClick={() =>
                          approveAbsence.mutate(a.id, {
                            onSuccess: (done) => setCleared(done),
                          })
                        }
                      >
                        {t('people.absences.approve')}
                      </Button>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {cleared !== null &&
          (cleared.shifts_cleared > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-200/60 bg-amber-50 px-4 py-3">
              <p className="text-sm text-amber-900">
                {plural(
                  cleared.shifts_cleared,
                  'people.absences.cleared.one',
                  'people.absences.cleared.other',
                  {
                    name: employeeName.get(cleared.employee_id) ?? '',
                    hours: formatHours(cleared.hours_cleared),
                  },
                )}
              </p>
              {cleared.published_cleared > 0 && (
                <p className="mt-1 text-sm text-amber-800">
                  {t('people.absences.cleared.published', {
                    count: cleared.published_cleared,
                  })}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              {t('people.absences.cleared.none')}
            </p>
          ))}
        {approveAbsence.isError && (
          <p className="mt-3 text-sm text-red-600">
            {getErrorMessage(approveAbsence.error)}
          </p>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('people.absences.form.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('people.action.cancel')}
            </Button>
            <Button
              type="submit"
              form="absence-form"
              disabled={createAbsence.isPending}
            >
              {createAbsence.isPending
                ? t('people.action.saving')
                : t('people.absences.form.submit')}
            </Button>
          </>
        }
      >
        <form id="absence-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <Select
            label={t('people.absences.form.employee')}
            required
            value={form.employee_id}
            onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
          >
            <option value="" disabled>
              {t('people.absences.form.employeePlaceholder')}
            </option>
            {employees.data?.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name}
              </option>
            ))}
          </Select>
          <Select
            label={t('people.absences.form.type')}
            required
            value={form.absence_type_id}
            onChange={(e) =>
              setForm({ ...form, absence_type_id: e.target.value })
            }
          >
            <option value="" disabled>
              {t('people.absences.form.typePlaceholder')}
            </option>
            {absenceTypes.data?.map((type) => (
              <option key={type.id} value={type.id}>
                {absenceTypeLabel(type)}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('people.absences.form.start')}
              type="datetime-local"
              required
              value={form.start_at}
              onChange={(e) => setForm({ ...form, start_at: e.target.value })}
            />
            <Input
              label={t('people.absences.form.end')}
              type="datetime-local"
              required
              value={form.end_at}
              onChange={(e) => setForm({ ...form, end_at: e.target.value })}
            />
          </div>
          <Input
            label={t('people.absences.form.note')}
            value={form.note ?? ''}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          {createAbsence.isError && (
            <p className="text-sm text-red-600">
              {getErrorMessage(createAbsence.error)}
            </p>
          )}
        </form>
      </Modal>

      {/* Absence types -- moved here from the old Settings page, because what a
          leave type means only matters where leave is actually handled. */}
      <div className="m-glass mt-6 rounded-2xl border border-white/[0.08] px-5 py-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
          {t('people.absences.types.title')}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(absenceTypes.data ?? []).map((type) => (
            <span
              key={type.id}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs"
            >
              <span className="font-medium text-gray-900">
                {absenceTypeLabel(type)}
              </span>
              <span className="text-gray-500">{type.code}</span>
              {type.is_paid && (
                <span className="text-green-700">
                  {t('people.absences.types.paid')}
                </span>
              )}
              {type.consumes_balance && (
                <span className="text-sky-300">
                  {t('people.absences.types.usesBalance')}
                </span>
              )}
              {type.is_health_data && (
                <span className="text-violet-300">
                  {t('people.absences.types.healthData')}
                </span>
              )}
              {/* Given, or lent. A checkbox rather than a badge because it is
                  the one property here the manager decides -- the others
                  describe what the leave IS, this one records what was agreed
                  about working it back. */}
              <label className="flex items-center gap-1 border-l border-white/10 pl-2 text-gray-500">
                <input
                  type="checkbox"
                  className="h-3 w-3 rounded"
                  checked={type.is_recoverable ?? false}
                  disabled={setRecoverable.isPending}
                  onChange={(e) =>
                    setRecoverable.mutate({
                      id: type.id,
                      isRecoverable: e.target.checked,
                    })
                  }
                />
                {t('people.absences.types.recoverable')}
              </label>
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {t('people.absences.types.note')}{' '}
          {t('people.absences.types.recoverable.note')}
        </p>
      </div>
    </div>
  );
}
