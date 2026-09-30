import { describe, expect, it } from 'vitest';
import {
  MIN_SPAN_MIN,
  STEP_MIN,
  TRACK_END_MIN,
  closesNextDay,
  copyToAll,
  defaultWeek,
  dragTo,
  isAllClosed,
  minutesAtFraction,
  nudge,
  snap,
  toDaySchedules,
  toPayload,
  type DragState,
} from './weekHours';

const H = 60;

describe('the track', () => {
  it('snaps to the half hour and stays on the track', () => {
    expect(snap(9 * H + 10)).toBe(9 * H);
    expect(snap(9 * H + 20)).toBe(9 * H + 30);
    expect(snap(-40)).toBe(0);
    expect(snap(TRACK_END_MIN + 500)).toBe(TRACK_END_MIN);
  });

  it('runs from midnight to six the next morning', () => {
    expect(minutesAtFraction(0)).toBe(0);
    expect(minutesAtFraction(1)).toBe(30 * H);
    expect(minutesAtFraction(0.5)).toBe(15 * H);
    expect(minutesAtFraction(2)).toBe(TRACK_END_MIN);
  });
});

describe('dragging', () => {
  const create = (anchorMin: number): DragState => ({
    kind: 'create',
    weekday: 1,
    anchorMin,
    origin: null,
  });
  const on = (kind: DragState['kind'], openMin: number, closeMin: number, anchorMin = openMin) =>
    ({ kind, weekday: 1, anchorMin, origin: { openMin, closeMin } }) as DragState;

  it('draws a new bar either way from the press', () => {
    expect(dragTo(create(9 * H), 20 * H)).toEqual({ openMin: 9 * H, closeMin: 20 * H });
    expect(dragTo(create(20 * H), 9 * H)).toEqual({ openMin: 9 * H, closeMin: 20 * H });
  });

  it('a tap on an empty day opens it for an hour rather than nothing', () => {
    expect(dragTo(create(9 * H), 9 * H)).toEqual({ openMin: 9 * H, closeMin: 9 * H + MIN_SPAN_MIN });
    // At the far end the hour is pushed back rather than off the track.
    expect(dragTo(create(TRACK_END_MIN), TRACK_END_MIN)).toEqual({
      openMin: TRACK_END_MIN - MIN_SPAN_MIN,
      closeMin: TRACK_END_MIN,
    });
  });

  it('slides a whole bar and keeps it on the track', () => {
    expect(dragTo(on('move', 9 * H, 20 * H, 12 * H), 14 * H)).toEqual({
      openMin: 11 * H,
      closeMin: 22 * H,
    });
    expect(dragTo(on('move', 9 * H, 20 * H, 12 * H), 0)).toEqual({ openMin: 0, closeMin: 11 * H });
    expect(dragTo(on('move', 9 * H, 20 * H, 12 * H), 40 * H)).toEqual({
      openMin: TRACK_END_MIN - 11 * H,
      closeMin: TRACK_END_MIN,
    });
  });

  it('pulls an end without letting the bar collapse', () => {
    expect(dragTo(on('start', 9 * H, 20 * H), 11 * H)).toEqual({ openMin: 11 * H, closeMin: 20 * H });
    expect(dragTo(on('start', 9 * H, 20 * H), 23 * H)).toEqual({
      openMin: 20 * H - MIN_SPAN_MIN,
      closeMin: 20 * H,
    });
    expect(dragTo(on('end', 9 * H, 20 * H), 27 * H)).toEqual({ openMin: 9 * H, closeMin: 27 * H });
    expect(dragTo(on('end', 9 * H, 20 * H), 2 * H)).toEqual({
      openMin: 9 * H,
      closeMin: 9 * H + MIN_SPAN_MIN,
    });
  });

  it('nudges an end one step by keyboard with the same bounds', () => {
    expect(nudge({ openMin: 9 * H, closeMin: 20 * H }, 'end', 1)).toEqual({
      openMin: 9 * H,
      closeMin: 20 * H + STEP_MIN,
    });
    expect(nudge({ openMin: 9 * H, closeMin: 20 * H }, 'start', -2)).toEqual({
      openMin: 8 * H,
      closeMin: 20 * H,
    });
    expect(nudge(null, 'start', 1)).toBeNull();
  });
});

describe('writing the week down', () => {
  it('starts every day nine to eight', () => {
    const week = defaultWeek();
    expect(Object.keys(week)).toHaveLength(7);
    expect(week[0]).toEqual({ openMin: 9 * H, closeMin: 20 * H });
    expect(isAllClosed(week)).toBe(false);
  });

  it('sends the server minutes per weekday and null for a closed day', () => {
    const week = defaultWeek();
    week[0] = null;
    week[5] = { openMin: 18 * H, closeMin: 27 * H };
    const payload = toPayload(week);
    expect(payload['0']).toBeNull();
    expect(payload['5']).toEqual([18 * H, 27 * H]);
    expect(payload['1']).toEqual([9 * H, 20 * H]);
    expect(Object.keys(payload)).toHaveLength(7);
  });

  it('reads as the same seven rows the brief composer already understands', () => {
    const week = defaultWeek();
    week[0] = null;
    const rows = toDaySchedules(week);
    expect(rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(rows[6]).toEqual({ weekday: 0, openMin: 0, closeMin: 0, closed: true });
    expect(rows[0]).toEqual({ weekday: 1, openMin: 9 * H, closeMin: 20 * H, closed: false });
  });

  it('copies one day to the rest, closed included', () => {
    const week = defaultWeek();
    week[5] = { openMin: 18 * H, closeMin: 27 * H };
    const all = copyToAll(week, 5);
    expect(all[0]).toEqual({ openMin: 18 * H, closeMin: 27 * H });
    expect(all[0]).not.toBe(all[1]);
    week[5] = null;
    expect(isAllClosed(copyToAll(week, 5))).toBe(true);
  });

  it('knows when a close is the next morning', () => {
    expect(closesNextDay({ openMin: 18 * H, closeMin: 27 * H })).toBe(true);
    expect(closesNextDay({ openMin: 9 * H, closeMin: 24 * H })).toBe(false);
    expect(closesNextDay(null)).toBe(false);
  });
});
