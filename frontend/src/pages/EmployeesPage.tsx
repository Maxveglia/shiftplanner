import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCreateEmployee,
  useEmployees,
  useDeleteEmployee,
  useUpdateEmployee,
} from '../api/employees';
import { useBalances, type EmployeeBalances } from '../api/workday';
import { getErrorMessage } from '../lib/api';
import {
  employmentStatusKeys,
  employmentStatusLabel,
  employmentTypeLabel,
  formatDate,
  formatHours,
} from '../lib/format';
import { useT } from '../lib/i18n';
import { isDrag, isHorizontal, offsetFor, settle } from '../lib/roster/swipe';
import { renameTo } from '../lib/roster/rename';
import { offerUndo } from '../lib/roster/undo';
import type { EmployeeCreate, EmploymentStatus } from '../types';
import { PageHeader } from './DashboardLayout';
import { Button } from '../components/Button';
import { FIELD_CLASS, fieldTone, Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Spinner, StateMessage } from '../components/StateMessage';
import { Table, TBody, TD, TH, THead, TR } from '../components/Table';

/** A person's situation as a badge; the file (EmployeeDetailPage) reads it too. */
export const statusTone: Record<EmploymentStatus, 'green' | 'blue' | 'amber' | 'gray'> = {
  active: 'green',
  onboarding: 'blue',
  on_leave: 'amber',
  resigned: 'gray',
};

/** Height of the open drawer, in px. One button, comfortably tappable. */
const DRAWER_PX = 48;

/**
 * How much of the finger's travel the ROW itself takes, while dragging.
 *
 * The drawer opens under the row, so a row that followed the finger one-for-one
 * would sit on top of the thing it is uncovering. A fraction is enough for the
 * row to feel attached to the finger — which is the whole reason the gesture is
 * "drag the row" and not "tap a chevron" — while leaving the red panel visible
 * underneath it. It goes back to zero the moment the gesture settles.
 */
const ROW_FOLLOW = 0.35;

interface Drag {
  employeeId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
}

const emptyForm: EmployeeCreate = {
  external_id: null,
  full_name: '',
  email: '',
  employment_status: 'onboarding',
  hire_date: new Date().toISOString().slice(0, 10),
};

/** A new Set with one more member. React needs a new identity to re-render. */
function add(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  next.add(id);
  return next;
}

export function EmployeesPage() {
  const t = useT();
  const navigate = useNavigate();
  const employees = useEmployees();
  // One request for the whole roster: the server reads the year once to
  // answer it, and asking per row would read the same year for every name.
  const balances = useBalances();
  const balanceOf = useMemo(
    () =>
      new Map(
        (balances.data?.employees ?? []).map((b) => [b.employee_id, b]),
      ),
    [balances.data],
  );
  const createEmployee = useCreateEmployee();
  const deleteEmployee = useDeleteEmployee();
  // Blank means "let the system assign the next code"; typing overrides it.
  const [manualId, setManualId] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EmployeeCreate>(emptyForm);

  // The row being pulled right now, and the row whose drawer is left open.
  // Two pieces of state, not one: a drag that does not travel far enough closes
  // again, and an open drawer outlives the finger that opened it.
  const [drag, setDrag] = useState<Drag | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  // Rows a mouse has swept over, and whether a sweep is in progress.
  //
  // A finger opens ONE drawer; a mouse marks MANY rows. The same downward drag
  // means different things because the devices do: on a phone the row under the
  // thumb is the only one reachable without letting go, and on a desktop the
  // whole list is one motion away. Branching on `pointerType` rather than on a
  // screen width, because it is the input that differs and a laptop with a
  // touchscreen has both.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const sweeping = useRef(false);
  // A row is also a link to the person's file. When the gesture moved, the
  // click it produces has to be swallowed — a ref and not state, because the
  // click arrives in the same tick as the pointerup that sets it.
  const swallowClick = useRef(false);

  const travel = (employeeId: string): number => {
    if (drag?.employeeId === employeeId) return offsetFor(drag.dy);
    return revealed === employeeId ? DRAWER_PX : 0;
  };

  const onPointerDown = (employeeId: string) => (e: ReactPointerEvent) => {
    // Secondary buttons open context menus; leave them alone.
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // Every sequence starts as a click until it proves otherwise. Without this
    // a drag that never produced a click would leave the flag set and swallow
    // the NEXT tap, on a row the manager did mean to open.
    swallowClick.current = false;
    if (e.pointerType === 'mouse') {
      // No pointer capture for the mouse: capture routes every move back to
      // the row it started on, and a sweep needs to hear the rows it passes
      // OVER. The gesture ends on a window listener instead, so releasing
      // outside the table still finishes it rather than leaving a sweep armed.
      setDrag({
        employeeId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        dx: 0,
        dy: 0,
      });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      employeeId,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
    });
  };

  const onPointerMove = (employeeId: string) => (e: ReactPointerEvent) => {
    if (drag?.employeeId !== employeeId || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (e.pointerType === 'mouse') {
      // Until it has travelled, a press is still a click on somebody's file.
      if (!sweeping.current && !isDrag(dx, dy)) return;
      sweeping.current = true;
      swallowClick.current = true;
      setSelected((prev) => (prev.has(employeeId) ? prev : add(prev, employeeId)));
      return;
    }
    if (isHorizontal(dx, dy)) {
      // The table scrolls sideways on a narrow screen. Once the finger commits
      // to that axis it is not opening a drawer, so hand the gesture back --
      // and still swallow the click, because somebody panning a table is not
      // asking to open anybody's file.
      swallowClick.current = true;
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDrag(null);
      return;
    }
    setDrag({ ...drag, dx, dy });
  };

  /** A row the sweep passed over. Only ever called while one is in progress. */
  const onPointerEnter = (employeeId: string) => () => {
    if (!sweeping.current) return;
    setSelected((prev) => (prev.has(employeeId) ? prev : add(prev, employeeId)));
  };

  // Escape lets go of a sweep that grabbed too much. Without it the only way
  // out is the Clear button, which is at the bottom of a list the manager may
  // have just scrolled past.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The sweep ends wherever the button comes up, including outside the table.
  useEffect(() => {
    const end = () => {
      if (!sweeping.current) return;
      sweeping.current = false;
      setDrag(null);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  const endDrag = (employeeId: string) => (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') {
      sweeping.current = false;
      setDrag(null);
      return;
    }
    if (drag?.employeeId !== employeeId || drag.pointerId !== e.pointerId) return;
    swallowClick.current = isDrag(drag.dx, drag.dy);
    if (e.type === 'pointerup' && settle(drag.dy)) {
      setRevealed(employeeId);
    } else if (revealed === employeeId) {
      setRevealed(null);
    }
    setDrag(null);
  };

  const openFile = (employeeId: string) => () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    navigate(`/employees/${employeeId}`);
  };

  const remove = (id: string, name: string) => {
    setRevealed(null);
    // Removed first, undone after. The server marks the row instead of
    // destroying it, so the offer below is a real one and not a delay dressed
    // up as one — nothing is waiting on a timer to finish the job.
    deleteEmployee.mutate(id, { onSuccess: () => offerUndo(id, name) });
  };

  /**
   * Remove everyone the sweep marked.
   *
   * One request each, and one undo offer each, because that is what the store
   * already models -- three removals are three offers, oldest first, so a
   * manager who swept one row too many takes back exactly that one instead of
   * the whole gesture. A single bulk undo would be tidier on screen and worse
   * to use.
   */
  const removeSelected = () => {
    const byId = new Map((employees.data ?? []).map((e) => [e.id, e.full_name]));
    for (const id of selected) {
      const name = byId.get(id);
      if (name === undefined) continue;
      deleteEmployee.mutate(id, { onSuccess: () => offerUndo(id, name) });
    }
    setSelected(new Set());
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload: EmployeeCreate = {
      ...form,
      external_id: manualId && form.external_id?.trim() ? form.external_id.trim() : null,
      email: form.email?.trim() ? form.email.trim() : null,
    };
    createEmployee.mutate(payload, {
      onSuccess: () => {
        setOpen(false);
        setForm(emptyForm);
        setManualId(false);
      },
    });
  };

  return (
    <div>
      <PageHeader
        title={t('people.employees.title')}
        description={t('people.employees.description')}
        actions={
          <Button onClick={() => setOpen(true)}>
            {t('people.employees.add')}
          </Button>
        }
      />

      <Card>
        {employees.isLoading ? (
          <Spinner />
        ) : employees.isError ? (
          <StateMessage
            tone="error"
            title={t('people.employees.loadError')}
            description={getErrorMessage(employees.error)}
          />
        ) : (employees.data?.length ?? 0) === 0 ? (
          <StateMessage
            title={t('people.employees.empty.title')}
            description={t('people.employees.empty.description')}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>{t('people.employees.col.number')}</TH>
                  <TH>{t('people.employees.col.name')}</TH>
                  <TH>{t('people.employees.col.id')}</TH>
                  <TH>{t('people.employees.col.status')}</TH>
                  <TH>{t('people.employees.col.contract')}</TH>
                  <TH>{t('people.employees.col.hours')}</TH>
                  <TH>{t('people.employees.col.balance')}</TH>
                  <TH>{t('people.employees.col.hireDate')}</TH>
                </TR>
              </THead>
              <TBody>
                {employees.data!.map((emp, i) => {
                  const opened = travel(emp.id);
                  const dragging = drag?.employeeId === emp.id;
                  return (
                    <Fragment key={emp.id}>
                      <TR
                        onClick={openFile(emp.id)}
                        onPointerDown={onPointerDown(emp.id)}
                        onPointerMove={onPointerMove(emp.id)}
                        onPointerEnter={onPointerEnter(emp.id)}
                        onPointerUp={endDrag(emp.id)}
                        onPointerCancel={endDrag(emp.id)}
                        className={[
                          dragging ? 'select-none bg-red-50/60' : '',
                          // A bar on the row's edge as well as the tint: which
                          // rows are marked is told by a shape too.
                          selected.has(emp.id)
                            ? 'select-none bg-red-50 shadow-[inset_3px_0_0_#f87171]'
                            : '',
                        ].join(' ')}
                        style={{
                          // The row has to own the DOWNWARD gesture or the
                          // page scroller takes it and we get a pointercancel
                          // one frame in — which is the whole feature, on
                          // touch. `pan-x pinch-zoom` gives back the two the
                          // browser should keep: the table still pans sideways
                          // on a narrow screen, and the page can still be
                          // pinched to zoom, which somebody may need in order
                          // to read it at all. What is genuinely lost is
                          // scrolling the page with a finger that starts on a
                          // row; anywhere else still scrolls. Discarded: `none`
                          // (costs zoom for nothing), and a sideways swipe,
                          // which does not fight the scroller at all but is not
                          // the gesture that was asked for.
                          touchAction: 'pan-x pinch-zoom',
                          transform: dragging
                            ? `translateY(${opened * ROW_FOLLOW}px)`
                            : undefined,
                        }}
                      >
                        {/* Always 1..N with no gaps: remove someone and the
                            rest close ranks. The stable identity is the row's
                            UUID, and it is what survives the removal now. */}
                        <TD className="tabular-nums text-gray-500">
                          {emp.display_number || i + 1}
                        </TD>
                        <TD className="font-medium text-gray-900">
                          <NameCell employeeId={emp.id} name={emp.full_name} />
                        </TD>
                        <TD className="text-gray-500">{emp.external_id}</TD>
                        <TD>
                          <Badge tone={statusTone[emp.employment_status]}>
                            {employmentStatusLabel(emp.employment_status)}
                          </Badge>
                        </TD>
                        <TD>
                          {emp.current_contract
                            ? employmentTypeLabel(emp.current_contract.employment_type)
                            : t('people.employees.noContract')}
                        </TD>
                        {/* Read-only here, on purpose. The row is a link to
                            the person's file, so a box inside it competed with
                            the click that opens them -- typing a new number
                            navigated away instead of saving it. The lever
                            lives on the file now, where nothing else wants
                            the same click. */}
                        <TD className="tabular-nums text-gray-700">
                          {emp.current_contract ? (
                            emp.current_contract.min_hours_per_week
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </TD>
                        {/* Where this person stands against their contract.
                            Three stretches in one cell rather than three
                            columns: the table already carries seven, and the
                            month is the figure a manager acts on -- the
                            quarter and the year are there to say whether this
                            month is a blip or a pattern. */}
                        <TD>
                          <HoursBalance balances={balanceOf.get(emp.id) ?? null} />
                        </TD>
                        <TD>{formatDate(emp.hire_date)}</TD>
                      </TR>

                      {/* The drawer. It is ALWAYS in the document, and the
                          button inside it is always in the tab order: a
                          removal you can only reach by dragging is a removal
                          that does not exist for anyone using a keyboard, a
                          switch or a screen reader. Closed, it is clipped to
                          zero height rather than hidden — `display: none` and
                          `visibility: hidden` both take it out of the tab
                          order, and `disabled` would take it out of the
                          accessibility tree. Focus opens it, so what is
                          focused is always what is visible. */}
                      <TR
                        // Inline, both of them, because they have to beat
                        // Tailwind and not merely be listed after it: `p-0`
                        // loses to the TD's own `px-4 py-3`, and the tbody's
                        // `divide-y` puts a border on every child, which would
                        // draw a second hairline under every single row.
                        style={{ borderTopWidth: 0 }}
                      >
                        <TD colSpan={8} style={{ padding: 0 }}>
                          <div
                            className="overflow-hidden transition-[height] duration-150"
                            style={{ height: opened }}
                          >
                            <button
                              type="button"
                              onFocus={() => setRevealed(emp.id)}
                              onBlur={() =>
                                setRevealed((cur) => (cur === emp.id ? null : cur))
                              }
                              onClick={() => remove(emp.id, emp.full_name)}
                              aria-label={t('people.employees.removeNamed', {
                                name: emp.full_name,
                              })}
                              className="flex w-full items-center justify-center rounded-lg bg-danger text-sm font-semibold text-white hover:bg-danger-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
                              style={{ height: DRAWER_PX }}
                            >
                              {t('people.employees.remove')}
                            </button>
                          </div>
                        </TD>
                      </TR>
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>

            {selected.size > 0 && (
              // Sits under the table rather than floating over it: the sweep
              // ends with the pointer somewhere in the list, and a bar that
              // covers the last rows swept would hide what was just marked.
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-50 px-4 py-3">
                <p className="text-sm font-medium text-red-900">
                  {selected.size === 1
                    ? t('people.employees.selected.one')
                    : t('people.employees.selected.other', { count: selected.size })}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white/[0.06] hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
                  >
                    {t('people.employees.selected.clear')}
                  </button>
                  <button
                    type="button"
                    onClick={removeSelected}
                    className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:bg-danger-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
                  >
                    {t('people.employees.selected.remove')}
                  </button>
                </div>
              </div>
            )}

            <p className="mt-4 text-xs text-gray-500">
              {t('people.employees.removeHint')}
            </p>
            {deleteEmployee.isError && (
              <p className="mt-2 text-sm text-red-600">
                {getErrorMessage(deleteEmployee.error)}
              </p>
            )}
          </>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('people.employees.form.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('people.action.cancel')}
            </Button>
            <Button
              type="submit"
              form="employee-form"
              disabled={createEmployee.isPending}
            >
              {createEmployee.isPending
                ? t('people.action.saving')
                : t('people.action.create')}
            </Button>
          </>
        }
      >
        <form id="employee-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                {t('people.employees.form.employeeId')}
              </label>
              <button
                type="button"
                onClick={() => setManualId((v) => !v)}
                className="rounded text-xs font-medium text-brand-300 hover:text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
              >
                {manualId
                  ? t('people.employees.form.assignAuto')
                  : t('people.employees.form.setManually')}
              </button>
            </div>
            {manualId ? (
              <input
                className={`${FIELD_CLASS} ${fieldTone(false)} mt-1 w-full`}
                placeholder={t('people.employees.form.idPlaceholder')}
                value={form.external_id ?? ''}
                onChange={(e) =>
                  setForm({ ...form, external_id: e.target.value })
                }
              />
            ) : (
              <p className="mt-1 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3.5 py-2.5 text-sm text-gray-500">
                {t('people.employees.form.autoAssigned')}
              </p>
            )}
          </div>
          <Input
            label={t('people.employees.form.fullName')}
            required
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <Input
            label={t('people.employees.form.email')}
            type="email"
            value={form.email ?? ''}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Select
            label={t('people.employees.form.status')}
            value={form.employment_status}
            onChange={(e) =>
              setForm({
                ...form,
                employment_status: e.target.value as EmploymentStatus,
              })
            }
          >
            {(Object.keys(employmentStatusKeys) as EmploymentStatus[]).map(
              (s) => (
                <option key={s} value={s}>
                  {employmentStatusLabel(s)}
                </option>
              ),
            )}
          </Select>
          <Input
            label={t('people.employees.form.hireDate')}
            type="date"
            required
            value={form.hire_date}
            onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
          />
          {createEmployee.isError && (
            <p className="text-sm text-red-600">
              {getErrorMessage(createEmployee.error)}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}

/**
 * A person's name, corrected where it is read.
 *
 * Sibling of the hours box below, and deliberately quieter than it: the name
 * is what every row is identified by, and a bordered field on each one would
 * turn the roster into a form. It reads as text until the pointer is over it.
 *
 * Only the name is sent. The same endpoint carries status, email and hire
 * date, and a PATCH that repeated them would overwrite anything changed on
 * the person's file in another tab since this list was fetched.
 */
function NameCell({ employeeId, name }: { employeeId: string; name: string }) {
  const t = useT();
  const update = useUpdateEmployee(employeeId);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? name;

  const commit = () => {
    if (draft === null) return;
    const next = renameTo(draft, name);
    setDraft(null);
    if (next === null) return;
    update.mutate({ full_name: next });
  };

  return (
    <input
      type="text"
      value={shown}
      aria-label={t('people.employees.name.label', { name })}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      // The row is a link to the person's file and a swipe handle. Typing in
      // the box is neither, and the click has to be stopped as well as the
      // pointerdown -- a click that only bubbles opens the file under the box
      // being typed into, taking the edit with it.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      disabled={update.isPending}
      className={[
        'm-field w-full min-w-[10rem] rounded-lg border bg-transparent px-2 py-1 text-sm font-medium text-gray-900 focus:bg-white/[0.06] focus:outline-none focus:ring-[3px]',
        update.isError
          ? 'border-red-400/80 focus:border-red-400 focus:ring-red-400/25'
          : 'border-transparent hover:border-gray-400 focus:border-brand-400 focus:ring-brand-400/25',
      ].join(' ')}
    />
  );
}


/**
 * How far somebody is from the hours their contract asks for.
 *
 * WHAT THE COLOURS DO NOT SAY. Ahead is not good and behind is not bad --
 * under an annual average (art. 34.1 ET) a long month is answered by a short
 * one, and a manager who reads amber as an alarm will "fix" a rota that was
 * working exactly as intended. So the two directions get two different
 * colours rather than one good and one bad, and the sentence names a
 * position: ahead, behind, on track.
 *
 * Three stretches because one is not enough to act on. The month is what can
 * still be changed; the quarter says whether this month is a blip; the year
 * is the one the law actually measures (see backend services/workday).
 */
function HoursBalance({ balances }: { balances: EmployeeBalances | null }) {
  const t = useT();
  if (!balances) return <span className="text-gray-500">—</span>;

  // Under a quarter of an hour either way is on track. Without a dead band the
  // column flickers between "ahead" and "behind" on rounding alone, which
  // reads as instability in the rota rather than in the arithmetic.
  const line = (label: string, value: number) => {
    const level = Math.abs(value) < 0.25;
    // Light shades for the dark card: amber-700 is the palette's pale amber,
    // and sky-300 (not in the palette) the blue it stands beside -- sky-700
    // was 2.8:1 here.
    const tone = level
      ? 'text-gray-500'
      : value > 0
        ? 'text-amber-700'
        : 'text-sky-300';
    const text = level
      ? t('people.employees.balance.level')
      : t(
          value > 0
            ? 'people.employees.balance.ahead'
            : 'people.employees.balance.behind',
          { hours: formatHours(Math.abs(value)) },
        );
    return { label, tone, text };
  };

  const month = line(t('people.employees.balance.month'), balances.month.deviation);
  const rest = [
    line(t('people.employees.balance.quarter'), balances.quarter.deviation),
    line(t('people.employees.balance.year'), balances.year.deviation),
  ];

  return (
    <div className="tabular-nums">
      <span className={`text-sm font-medium ${month.tone}`}>{month.text}</span>
      <span className="ml-1 text-xs text-gray-500">{month.label}</span>
      <div className="mt-0.5 flex gap-2 text-[11px]">
        {rest.map((r) => (
          <span key={r.label} className={r.tone}>
            {r.text}
            <span className="ml-0.5 text-gray-500">{r.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
