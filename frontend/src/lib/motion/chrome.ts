// The arithmetic of the chrome's motion: the sidebar's sliding pill and the
// way a page enters when the route changes. Pure, like kit.ts, so it is tested
// without a DOM; DashboardLayout measures and calls these.

/**
 * A spring, written as a CSS `linear()` easing, and how long it takes to
 * settle.
 *
 * A cubic-bezier can overshoot once and come straight back; a spring swings
 * past, comes back a little short and settles, which is what makes the
 * sidebar's pill feel like it has weight rather than like it was tweened.
 * `linear()` is a list of points the browser joins with straight lines, so the
 * curve is sampled here from the damped oscillator, from rest at 0 to rest at
 * 1. Callers keep a cubic-bezier fallback for browsers without `linear()`.
 *
 * `stiffness`, `damping` and `mass` are the usual spring constants; the
 * defaults overshoot by a few percent and settle in under half a second.
 */
export function springEasing({
  stiffness = 380,
  damping = 28,
  mass = 1,
  points = 36,
  precision = 0.001,
}: {
  stiffness?: number;
  damping?: number;
  mass?: number;
  points?: number;
  precision?: number;
} = {}): { easing: string; duration: number } {
  const at = springCurve(stiffness, damping, mass);
  // Settled = the last moment the curve is still further than `precision`
  // from 1, found on a 1 ms grid. Capped at 2 s so a spring with almost no
  // damping cannot turn into an animation that never ends.
  let settled = 0;
  for (let ms = 0; ms <= 2000; ms++) {
    if (Math.abs(1 - at(ms / 1000)) >= precision) settled = ms;
  }
  const duration = Math.max(1, settled + 1);
  const n = Math.max(2, Math.floor(points));
  const values: string[] = [];
  for (let i = 0; i <= n; i++) {
    const v = i === 0 ? 0 : i === n ? 1 : at(((i / n) * duration) / 1000);
    values.push(String(Math.round(v * 1000) / 1000));
  }
  return { easing: `linear(${values.join(', ')})`, duration };
}

/** Position over time (s) of a spring released from 0 towards 1, at rest. */
function springCurve(k: number, c: number, m: number): (t: number) => number {
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (t) =>
      1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  return (t) => 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/**
 * How far the pill stretches along its path while it travels `distance`
 * pixels, as a vertical scale: the leading edge runs ahead and the rest
 * catches up, like something liquid. Nothing for a pill that stays put, and
 * never more than a quarter of its height however far it goes -- past three
 * links the stretch stops growing.
 */
export function stretchFor(distance: number, height: number): number {
  if (!(height > 0) || !Number.isFinite(distance) || distance === 0) return 1;
  const links = Math.min(Math.abs(distance) / height, 3);
  return Math.round((1 + links * (0.25 / 3)) * 1000) / 1000;
}

/**
 * The sidebar destination a path belongs to: the longest link that matches
 * it, with NavLink's rules (`/` only matches itself, anything else matches
 * itself and what hangs below it). `null` for a path under no link.
 */
export function sectionOf(path: string, sections: readonly string[]): string | null {
  const p = trimSlash(path);
  let best: string | null = null;
  for (const raw of sections) {
    const s = trimSlash(raw);
    const hit = s === '/' ? p === '/' : p === s || p.startsWith(`${s}/`);
    if (hit && (best === null || s.length > best.length)) best = s;
  }
  return best;
}

/**
 * Where a page comes in from when the route changes from `prev` to `next`,
 * as an offset in pixels it travels back from; `null` when there is nothing
 * to animate.
 *
 * - Into a detail of the same section (a person, a count): from the right,
 *   the way a list opens onto one of its rows. Back out of it: from the left.
 * - To another destination: from below when it sits further down the sidebar
 *   than where you were, from above when it sits higher -- the page moves the
 *   same way as the pill beside it.
 * - First load, or a path the sidebar does not know: rising from below.
 */
export function pageEntrance(
  prev: string | null,
  next: string,
  sections: readonly string[],
  distance = 10,
): { x: number; y: number } | null {
  if (prev !== null && trimSlash(prev) === trimSlash(next)) return null;
  const rise = { x: 0, y: distance };
  if (prev === null) return rise;
  const from = sectionOf(prev, sections);
  const to = sectionOf(next, sections);
  if (from === null || to === null) return rise;
  if (from === to) {
    const wasDetail = trimSlash(prev) !== from;
    const isDetail = trimSlash(next) !== to;
    if (!wasDetail && isDetail) return { x: distance * 1.5, y: 0 };
    if (wasDetail && !isDetail) return { x: -distance * 1.5, y: 0 };
    return rise;
  }
  const order = sections.map(trimSlash);
  return order.indexOf(to) < order.indexOf(from) ? { x: 0, y: -distance } : rise;
}

function trimSlash(path: string): string {
  const p = path.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}
