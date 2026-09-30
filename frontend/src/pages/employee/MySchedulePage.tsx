// The employee's whole product, on one screen.
//
// Three questions, in the order they get asked: when am I next in, what does my
// period look like, and what will I be paid for it. Everything below is derived
// from shifts the manager PUBLISHED and from the employee's own contract --
// nothing here is entered twice, so nothing here can disagree with the roster.
//
// NO PAY FIGURES. This screen used to estimate what the person would earn,
// from the same `computePayroll` the manager's table uses. That is gone --
// with the tab, with the org pay policy it needed (now manager-only on the
// server) and with the components that drew it. What is left is the two
// questions a rota answers: when do I work, and who am I on with.
//
// Historic note, kept because the reasoning still applies to the hours:
// the figures run through the same `priceAssignments`
// pair the manager's payroll table uses, over the same days and the same org
// pay policy. That is deliberate: an estimate the manager cannot reproduce is
// worse than no estimate at all.

import { DayNotesCard } from '../../components/employee/DayNotesCard';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMyProfile } from '../../api/me';
import { useMyBusinessShape } from '../../api/profile';
import { usePublishedSchedule } from '../../api/schedule';
import { useShiftTemplates } from '../../api/shiftTemplates';
import { useAuth } from '../../auth/useAuth';
import { NextShiftCard } from '../../components/employee/NextShiftCard';
import { NotificationsCard } from '../../components/employee/NotificationsCard';
import { ShiftList } from '../../components/employee/ShiftList';
import { TeamDay } from '../../components/employee/TeamDay';
import { TimeOffCard } from '../../components/employee/TimeOffCard';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { getErrorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { formatHours } from '../../lib/format';
import { priceAssignments, startOfWeek } from '../../lib/schedule/generate';
import {
  payPeriodCadence,
  payPeriodDays,
  periodBounds,
  periodLabel,
  shiftPayPeriod,
  spanDays,
} from '../../lib/schedule/payPeriod';
import { fromAssignmentOutList } from '../../lib/schedule/persist';
import {
  latestAnnouncement,
  newSince,
  readLastSeen,
  rememberSeen,
} from '../../lib/schedule/announced';
import { DEFAULT_WEEKEND_DAYS, workingDayKey } from '../../lib/schedule/demand';
import type { PayPeriod } from '../../types';

/** How far ahead the "next shift" card looks, regardless of the period shown. */
const LOOKAHEAD_DAYS = 15;

/** The period arrows: round glass buttons, as on the launcher. */
const ROUND_BUTTON =
  'grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-gray-700 transition hover:border-white/25 hover:bg-white/10 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100';

function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path d={back ? 'M12 5l-5 5 5 5' : 'M8 5l5 5-5 5'} />
    </svg>
  );
}

function Stat({ label, value, tone = 'default' }: {
  label: string;
  value: string;
  tone?: 'default' | 'warn';
}) {
  return (
    <div className="sc-glass rounded-2xl px-3 py-3 sm:px-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={[
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'warn' ? 'text-amber-600' : 'text-gray-900',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
}

export function MySchedulePage() {
  const t = useT();
  const { user } = useAuth();
  const profile = useMyProfile();
  const business = useMyBusinessShape();
  const templates = useShiftTemplates();

  // The day whose team is open, or null. Only ever a day this person
  // works: it is set from one of their own shifts.
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(() => new Date());
  // Ticks so "starts in 3 h" stays true on a tab left open. The query windows
  // below deliberately do NOT depend on it, or every tick would refetch.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const payPeriod: PayPeriod = profile.data?.current_contract?.pay_period ?? 'monthly';

  const days = useMemo(
    () => payPeriodDays(payPeriod, anchor),
    [payPeriod, anchor],
  );
  const bounds = useMemo(() => periodBounds(days), [days]);

  // Fixed at mount: the lookahead is about "soon", not about the period being
  // browsed, and a stable window keeps this query cached.
  const lookahead = useMemo(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return periodBounds(spanDays(start, LOOKAHEAD_DAYS));
  }, []);

  const period = usePublishedSchedule(bounds.from, bounds.to);
  const upcoming = usePublishedSchedule(lookahead.from, lookahead.to);

  const templateList = useMemo(() => templates.data ?? [], [templates.data]);
  const weekendDays = business.data?.weekend_days ?? DEFAULT_WEEKEND_DAYS;
  const me = profile.data;

  /** Period shifts, priced by the same rule the manager's payroll uses. */
  const priced = useMemo(() => {
    if (!me) return [];
    const shifts = fromAssignmentOutList(period.data ?? [], templateList);
    return priceAssignments(shifts, [me]).assignments;
  }, [period.data, templateList, me]);

  const upcomingShifts = useMemo(
    () => fromAssignmentOutList(upcoming.data ?? [], templateList),
    [upcoming.data, templateList],
  );

  // What is new to this reader since they last looked.
  //
  // The watermark is read ONCE, when the screen opens, and kept in state:
  // moving it forward is the next thing that happens, and a badge computed
  // against the moved watermark would vanish on the very next render. So the
  // comparison is always against where the reader was when they arrived.
  // `undefined` means "not read yet" and is not the same as `null`, which is a
  // genuine first visit.
  const [seenOnArrival, setSeenOnArrival] = useState<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!me || seenOnArrival !== undefined) return;
    setSeenOnArrival(readLastSeen(me.id));
  }, [me, seenOnArrival]);

  const announced = useMemo(
    () => [...priced, ...upcomingShifts],
    [priced, upcomingShifts],
  );

  const fresh = useMemo(
    () =>
      seenOnArrival === undefined
        ? new Set<string>()
        : newSince(announced, seenOnArrival),
    [announced, seenOnArrival],
  );

  // Marked as read as soon as it is on screen. The alternative -- waiting for
  // a scroll or a timer -- buys precision nobody asked for and risks the
  // opposite failure, a badge that never clears.
  useEffect(() => {
    if (!me || seenOnArrival === undefined) return;
    rememberSeen(me.id, latestAnnouncement(announced));
  }, [me, seenOnArrival, announced]);

  /**
   * Hours in the period. Counted here rather than taken from a payroll run.
   *
   * This screen used to price the period -- the same `computePayroll` the
   * manager's table uses -- because it estimated what the person would earn.
   * That estimate is gone, and pricing a rota to show a total of HOURS would
   * be reaching for the pay policy to answer a question that never needed it.
   */
  const periodHours = useMemo(
    () => priced.reduce((sum, a) => sum + a.paidHours, 0),
    [priced],
  );

  // Hours in the current calendar week, so someone paid monthly can still see
  // what this week asks of them without changing anything.
  const weekHours = useMemo(() => {
    const keys = new Set(spanDays(startOfWeek(now), 7).map((d) => d.date));
    return priced
      .filter((a) => keys.has(a.date))
      .reduce((sum, a) => sum + a.paidHours, 0);
  }, [priced, now]);

  // Which working day it is right now, not which calendar day. For a bar that
  // closes at four, somebody looking at their phone at two in the morning is
  // still working tonight's shift, and "Today" has to sit on it.
  const todayKey = workingDayKey(now, business.data?.day_boundary_min ?? 0);
  const label = periodLabel(payPeriod, days);

  if (profile.isLoading) return <Spinner label={t('employee.loading')} />;

  // An account with no employee record behind it cannot be shown anything;
  // say so plainly instead of rendering a page full of zeroes.
  if (profile.isError || !me) {
    return (
      <StateMessage
        tone="error"
        title={t('employee.error.title')}
        description={
          user?.employee_id
            ? getErrorMessage(profile.error)
            : t('employee.error.unlinked')
        }
      />
    );
  }


  return (
    <div className="space-y-5">
      <div className="sc-rise">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
          {t('employee.greeting', { name: me.full_name.split(' ')[0] })}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {me.external_id} · {payPeriodCadence(payPeriod)}
        </p>
      </div>

      <NextShiftCard assignments={upcomingShifts} now={now} fresh={fresh} />

      {/* Period switcher: one window, the one they are paid on. */}
      <div className="sc-rise flex items-center justify-between gap-2" style={{ '--i': 2 } as CSSProperties}>
        <button
          type="button"
          onClick={() => setAnchor(shiftPayPeriod(payPeriod, anchor, -1))}
          aria-label={t('employee.period.prev')}
          className={ROUND_BUTTON}
        >
          <Chevron back />
        </button>
        <p className="flex-1 text-center text-base font-semibold text-gray-900 first-letter:uppercase">
          {label}
        </p>
        <button
          type="button"
          onClick={() => setAnchor(shiftPayPeriod(payPeriod, anchor, 1))}
          aria-label={t('employee.period.next')}
          className={ROUND_BUTTON}
        >
          <Chevron />
        </button>
      </div>


      {period.isError && (
        <StateMessage
          tone="error"
          title={t('employee.shifts.loadError')}
          description={getErrorMessage(period.error)}
        />
      )}

      {period.isLoading && <Spinner />}

      {!period.isLoading && !period.isError && (
        <>
          <div className="sc-rise grid grid-cols-3 gap-2" style={{ '--i': 3 } as CSSProperties}>
            <Stat label={t('employee.stat.shifts')} value={String(priced.length)} />
            <Stat label={t('employee.stat.week')} value={formatHours(weekHours)} />
            <Stat
              label={t('employee.stat.period')}
              value={formatHours(periodHours)}
            />
          </div>

          <ShiftList
            days={days}
            assignments={priced}
            todayKey={todayKey}
            weekendDays={weekendDays}
            fresh={fresh}
            onOpenDay={setOpenDay}
          />

          <TimeOffCard employeeId={me.id} />

          {/* Only for the people the manager shared the day notes with. */}
          <DayNotesCard />

          {/* Last, and deliberately: the rota is what this screen is for, and
              the switch that decides whether it reaches you by email is a
              thing you set once. The email points here by name. */}
          <NotificationsCard />
        </>
      )}

      {/* Who else is on, for a day this person works. Opened from one of
          their own shifts, which is also what entitles them to it -- the
          server checks that rather than trusting the screen. */}
      {openDay && (
        <TeamDay date={openDay} onClose={() => setOpenDay(null)} />
      )}
    </div>
  );
}
