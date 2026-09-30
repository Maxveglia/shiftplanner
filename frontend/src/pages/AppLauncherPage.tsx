import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useWorkspaceApps, useWorkspaceState } from '../auth/useWorkspaceApps';
import { useT } from '../lib/i18n';
import { REJILLA_PIECES, type MarkPiece } from '../components/Logo';
import { AppIcon } from '../components/motion/AppIcon';
import { LetterTitle, StageBackdrop, useStageParallax } from '../components/motion/Stage';
import { useReducedMotion } from '../lib/motion/useReducedMotion';
import { STOCK_PIECES } from '../components/StockLogo';
import { SHOP_PIECES } from '../components/ShopLogo';
import { usePermissions } from '../auth/useCan';
import {
  appsFor,
  APP_LOOK,
  destinationFor,
  launcherHead,
  launcherVisit,
  markLauncherArrival,
  type AppKey,
  type LauncherVisit,
} from '../lib/apps';
import {
  coverRadius,
  firstName,
  isPlainClick,
  namedLine,
  nextTile,
  tiltFor,
} from '../lib/launcher/motion';
import { PowerIcon } from '../components/icons/PowerIcon';

// Where a manager lands after signing in, and where the logo in the sidebar
// takes them back to: every app in the workspace, each as its mark and its
// name, and nothing else to read -- not even the greeting, unless they have
// just signed in. The screen is meant to be passed through in a second, so it
// spends its effort on how that second feels -- things arrive, answer the
// pointer, and carry you into the app you picked -- rather than on explaining
// anything.
//
// A tile for each app the business has that this account may open, and no
// more: the manager's are all of them; an employee's, their own shifts and
// the business's inventory and shop; a shop account's the same but the shifts
// (`appsFor`, lib/apps.ts). One with none gets the same stage with one
// sentence on it instead, by the business's name: it is being set up. And a
// business whose profile says its workspace is still being set up -- every
// business, the day it signs up, with the shifts app to start on -- sees its
// own name in the greeting's place, every time it comes here, and nothing
// more: its tiles are under it, so there is something to do after all
// (`launcherHead`, lib/apps.ts).
//
// The motion itself is CSS (index.css, `.launcher*`); this file only measures
// and sets custom properties. The arithmetic lives in lib/launcher/motion.ts.

interface Look {
  nameKey: string;
  pieces: MarkPiece[];
  /** RGB channels, read as `rgb(var(--accent) / alpha)` by the CSS. */
  accent: string;
  /** The icon's face, from its top-left corner to its bottom-right. */
  face: [string, string];
}

// Colours from APP_LOOK (lib/apps.ts), the one place every icon reads them.
const LOOKS: Record<AppKey, Look> = {
  shifts: { nameKey: 'launcher.app.shifts', pieces: REJILLA_PIECES, ...APP_LOOK.shifts },
  inventory: { nameKey: 'chrome.apps.inventory', pieces: STOCK_PIECES, ...APP_LOOK.inventory },
  store: { nameKey: 'chrome.apps.store', pieces: SHOP_PIECES, ...APP_LOOK.store },
};

/**
 * How the tiles lie, by how many there are. On a phone they stack, each a row
 * with its mark beside its name. Wider, each becomes a card with the mark over
 * the name, side by side: a lone one in a column of its own width in the
 * middle rather than the left half of a pair, a pair from `sm`, and three from
 * `md` -- a row of three at `sm` would squeeze each card under its mark, and
 * two over one is a pair with a leftover. From `md` there is room for three
 * cards as wide as the pair's. Whole class names, spelled out, so Tailwind
 * finds them in the source.
 */
const LAYOUTS = {
  one: {
    list: 'sm:max-w-[19rem] sm:gap-8',
    tile: 'sm:flex-col sm:gap-7 sm:px-8 sm:py-14',
    icon: 'sm:h-28 sm:w-28',
  },
  pair: {
    list: 'sm:max-w-[40rem] sm:grid-cols-2 sm:gap-8',
    tile: 'sm:flex-col sm:gap-7 sm:px-8 sm:py-14',
    icon: 'sm:h-28 sm:w-28',
  },
  row: {
    list: 'md:max-w-[58rem] md:grid-cols-3 md:gap-8',
    tile: 'md:flex-col md:gap-7 md:px-8 md:py-14',
    icon: 'md:h-28 md:w-28',
  },
} as const;

/** Tilt at the tile's edge, in degrees. Enough to feel, not enough to read as a wobble. */
const MAX_TILT = 9;
/** How long the other tile gets to start falling away before the reveal
 *  starts; it finishes going under the reveal. */
const LEAVE_MS = 100;
const REVEAL_MS = 420;
/** The app opens once the disc has all but covered the screen: the curve's
 *  last tenth of the time adds about a hundredth of the radius, and waiting
 *  it out is time spent looking at a plain screen. */
const ARRIVE_MS = Math.round(REVEAL_MS * 0.9);

type Leaving = AppKey | 'logout' | null;

interface Ripple {
  id: number;
  tile: number;
  x: number;
  y: number;
}

interface Burst {
  id: number;
  x: number;
  y: number;
}

let nextId = 0;

export function AppLauncherPage() {
  const t = useT();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const { state, pathname } = useLocation();
  // The apps this account may open. An employee's shifts are their own
  // screen (EmployeeLayout), which the shifts tile opens for them.
  const workspace = useWorkspaceApps();
  const permissions = usePermissions();
  const { preparing } = useWorkspaceState();
  const apps = appsFor(user?.role, workspace, permissions);
  // How this visit came about, read once, then the sign-in wiped from the
  // history entry: left there, Back from the app or a reload would greet the
  // manager again for no sign-in. Once, too, so the greeting cannot vanish
  // halfway through its own entrance when the entry is rewritten.
  const [visit] = useState(() => launcherVisit(state));
  const greet = visit.signedIn;
  const head = launcherHead(apps.length, preparing, greet);
  const layout = LAYOUTS[apps.length > 2 ? 'row' : apps.length > 1 ? 'pair' : 'one'];
  // The entry rewritten is the one this is on, not LAUNCHER_PATH by name:
  // whatever address it was reached at is the one kept.
  useEffect(() => {
    if (visit.signedIn) {
      navigate(pathname, { replace: true, state: { from: visit.from } satisfies LauncherVisit });
    }
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [leaving, setLeaving] = useState<Leaving>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);

  const reveal = useRef<HTMLDivElement>(null);
  const revealGlow = useRef<HTMLDivElement>(null);
  const tiles = useRef<(HTMLAnchorElement | null)[]>([]);
  // A second click while the first is carrying the manager out must do
  // nothing: two reveals racing each other to two different apps is the
  // one way this screen could actually go wrong.
  const gone = useRef(false);
  const timers = useRef<number[]>([]);
  const revealing = useRef<Animation | null>(null);
  // Whether this screen is still the one on show. The browser's Back button
  // can take it away mid-reveal, and an animation finishing after that must
  // not drag the manager into the app they just backed out of.
  const alive = useRef(true);

  useEffect(() => {
    // Set here and not only in the initial value: StrictMode unmounts and
    // mounts again once in development, and the cleanup below has run by then.
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach((id) => window.clearTimeout(id));
      revealing.current?.cancel();
    };
  }, []);

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  // The greeting and the being-set-up line each carry a name when there is
  // one -- the manager's first name, the business's -- in the brand's colour.
  // A shop account is greeted by the business's: its own name ("Tablet
  // barra") is what the manager called the device, not somebody to greet.
  const business = user?.org_name?.trim() ?? '';
  const name = user?.role === 'store' ? business : firstName(user?.full_name);
  const greeting = name
    ? namedLine(t('launcher.greeting'), name)
    : { text: t('launcher.greeting.anonymous') };
  const emptyTitle = business
    ? namedLine(t('launcher.empty.titleNamed'), business)
    : { text: t('launcher.empty.title') };
  // The business's name alone, all of it in the brand's colour.
  const title =
    head === 'preparing'
      ? business
        ? { text: business, highlight: { at: 0, length: Array.from(business).length } }
        : { text: t('launcher.empty.title') }
      : greeting;

  // --- The page follows the pointer ---------------------------------------

  const onPageMove = useStageParallax();

  // A ring wherever a click lands off the tiles; a tile answers with its own
  // ripple instead.
  const onPageDown = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    if ((e.target as Element).closest('.launcher-tile')) return;
    const burst = { id: nextId++, x: e.clientX, y: e.clientY };
    setBursts((all) => [...all, burst]);
  };

  // --- Tiles lean towards the pointer ---------------------------------------

  const onTileMove = (e: PointerEvent<HTMLAnchorElement>) => {
    if (reduced || e.pointerType === 'touch' || gone.current) return;
    const el = e.currentTarget;
    // Measured on the untilted wrapper: the tile's own box changes shape as
    // it leans, and measuring it would feed the tilt back into itself.
    const box = (el.parentElement ?? el).getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const { rx, ry } = tiltFor(x, y, box.width, box.height, MAX_TILT);
    el.dataset.tracking = '';
    el.style.setProperty('--rx', `${rx}deg`);
    el.style.setProperty('--ry', `${ry}deg`);
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
  };

  const onTileLeave = (e: PointerEvent<HTMLAnchorElement>) => {
    const el = e.currentTarget;
    delete el.dataset.tracking;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  const onTileKey = (e: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const to = nextTile(index, e.key, apps.length);
    if (to === null) return;
    e.preventDefault();
    tiles.current[to]?.focus();
  };

  // --- Choosing an app ------------------------------------------------------

  const open = (e: MouseEvent<HTMLAnchorElement>, index: number, to: string, key: AppKey) => {
    // A new tab or window is the browser's business: the tile is a real
    // link so that those keep working.
    if (!isPlainClick(e)) return;
    e.preventDefault();
    if (gone.current) return;
    gone.current = true;

    if (reduced) {
      navigate(to);
      return;
    }

    const tile = e.currentTarget;
    const box = tile.getBoundingClientRect();
    // A click from the keyboard has no position; it ripples from the middle.
    const fromKeyboard = e.detail === 0;
    setRipples((all) => [
      ...all,
      {
        id: nextId++,
        tile: index,
        x: fromKeyboard ? box.width / 2 : e.clientX - box.left,
        y: fromKeyboard ? box.height / 2 : e.clientY - box.top,
      },
    ]);
    setLeaving(key);

    // The reveal grows from the icon, the thing the eye is already on.
    const icon = (tile.querySelector('[data-icon]') ?? tile).getBoundingClientRect();
    const cx = icon.left + icon.width / 2;
    const cy = icon.top + icon.height / 2;

    let arrived = false;
    const arrive = () => {
      if (arrived || !alive.current) return;
      arrived = true;
      markLauncherArrival();
      navigate(to);
    };

    later(LEAVE_MS, () => {
      const el = reveal.current;
      if (!el || typeof el.animate !== 'function') {
        arrive();
        return;
      }
      const r = coverRadius(cx, cy, window.innerWidth, window.innerHeight);
      el.style.visibility = 'visible';
      // The chosen app's colour glowing where the icon was, dimming as the
      // disc covers the screen, so it ends on the app's own dark ground and
      // the app fades up out of that rather than out of a flash.
      const glow = revealGlow.current;
      if (glow && typeof glow.animate === 'function') {
        const accent = LOOKS[key].accent;
        glow.style.background = `radial-gradient(circle at ${cx}px ${cy}px, rgb(${accent} / 0.5) 0, rgb(${accent} / 0.16) ${Math.round(r * 0.3)}px, transparent ${Math.round(r * 0.75)}px)`;
        glow.animate([{ opacity: 1 }, { opacity: 0.85, offset: 0.45 }, { opacity: 0 }], {
          // Out by the time the app opens, which is before the disc is done.
          duration: ARRIVE_MS,
          easing: 'ease-in',
          fill: 'forwards',
        });
      }
      revealing.current = el.animate(
        [
          { clipPath: `circle(0px at ${cx}px ${cy}px)` },
          { clipPath: `circle(${r}px at ${cx}px ${cy}px)` },
        ],
        // Quick off the mark: the disc is on screen from the first frames
        // rather than gathering itself while the click seems to do nothing.
        { duration: REVEAL_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
      );
      // On the clock, not on `finished`: the same moment, and an animation
      // that never ends cannot hold the manager here.
      later(ARRIVE_MS, arrive);
    });
  };

  const onLogout = () => {
    if (gone.current) return;
    gone.current = true;
    const leave = () => {
      logout();
      navigate('/login', { replace: true });
    };
    if (reduced) {
      leave();
      return;
    }
    setLeaving('logout');
    later(420, leave);
  };

  return (
    <div
      className="launcher launcher-home relative min-h-screen overflow-hidden text-white"
      data-leaving={leaving ?? undefined}
      data-quiet={greet || head === 'preparing' ? undefined : ''}
      onPointerMove={onPageMove}
      onPointerDown={onPageDown}
    >
      {/* Backdrop: colour, and the grid the brand comes from. */}
      <StageBackdrop />

      <main className="relative z-[1] mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-4 py-20">
        {head === 'empty' ? (
          // Being set up, and nothing to open. Two lines, read by somebody who
          // cannot do anything about it, so they say only what is happening;
          // they and the way out in the corner are the screen.
          <div className="text-center">
            <LetterTitle
              text={emptyTitle.text}
              highlight={emptyTitle.highlight}
              className="launcher-title text-3xl font-semibold tracking-tight sm:text-5xl"
            />
            <p
              className="launcher-title m-rise mt-4 text-base text-white/60 sm:text-lg"
              style={{ '--d': '700ms' } as CSSProperties}
            >
              {t('launcher.empty.body')}
            </p>
          </div>
        ) : head === 'greeting' || head === 'preparing' ? (
          <LetterTitle
            text={title.text}
            highlight={title.highlight}
            className="launcher-title mb-10 text-center text-4xl font-semibold tracking-tight sm:mb-16 sm:text-6xl"
          />
        ) : (
          <h1 id="launcher-apps" className="sr-only">
            {t('launcher.apps')}
          </h1>
        )}

        {/* Named by the heading when that is what the heading says, so it is
            not read out twice. Laid out by how many there are (LAYOUTS). */}
        {apps.length > 0 && (
          <ul
            aria-label={head === 'quiet' ? undefined : t('launcher.apps')}
            aria-labelledby={head === 'quiet' ? 'launcher-apps' : undefined}
            className={['grid w-full max-w-[22rem] grid-cols-1 gap-5', layout.list].join(' ')}
          >
            {apps.map((app, i) => {
              const look = LOOKS[app.key];
              const to = destinationFor(app, visit.from);
              return (
                <li
                  key={app.key}
                  className="launcher-tile-in"
                  data-chosen={leaving === app.key ? '' : undefined}
                  style={{ '--i': i } as CSSProperties}
                >
                  <div className="launcher-float" style={{ '--i': i } as CSSProperties}>
                    <Link
                      ref={(el) => {
                        tiles.current[i] = el;
                      }}
                      to={to}
                      onClick={(e) => open(e, i, to, app.key)}
                      onPointerMove={onTileMove}
                      onPointerLeave={onTileLeave}
                      onKeyDown={(e) => onTileKey(e, i)}
                      className={[
                        'launcher-tile relative flex items-center gap-5 rounded-[2rem] border border-white/10 bg-white/[0.04] px-6 py-6 outline-none',
                        layout.tile,
                      ].join(' ')}
                      style={{ '--accent': look.accent } as CSSProperties}
                    >
                      <span
                        aria-hidden="true"
                        className="launcher-spot pointer-events-none absolute inset-0 rounded-[inherit]"
                      />
                      <span
                        aria-hidden="true"
                        className="launcher-ring pointer-events-none absolute inset-0 rounded-[inherit]"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
                      >
                        {ripples
                          .filter((r) => r.tile === i)
                          .map((r) => (
                            <span
                              key={r.id}
                              className="launcher-ripple"
                              style={{ left: r.x, top: r.y }}
                              onAnimationEnd={() =>
                                setRipples((all) => all.filter((x) => x.id !== r.id))
                              }
                            />
                          ))}
                      </span>

                      <AppIcon
                        pieces={look.pieces}
                        face={look.face}
                        order={i}
                        className={['h-20 w-20', layout.icon].join(' ')}
                      />

                      <span className="launcher-name text-xl font-semibold tracking-tight">
                        {t(look.nameKey)}
                      </span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {/* After the apps in the tab order, though it sits in the corner. */}
      <button
        type="button"
        onClick={onLogout}
        aria-label={t('chrome.logout')}
        className="group absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 transition duration-300 hover:scale-110 hover:border-white/25 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 sm:right-6 sm:top-6"
      >
        <PowerIcon className="h-5 w-5 transition-transform duration-500 group-hover:rotate-90 motion-reduce:transition-none motion-reduce:group-hover:rotate-0" />
      </button>

      {bursts.map((b) => (
        <span
          key={b.id}
          aria-hidden="true"
          className="launcher-burst"
          style={{ left: b.x, top: b.y }}
          onAnimationEnd={() => setBursts((all) => all.filter((x) => x.id !== b.id))}
        />
      ))}

      {/* The reveal: the app's own dark ground, grown from the chosen icon
          with the app's colour glowing at its heart, until it covers the
          screen, which is when the app takes over. */}
      <div
        ref={reveal}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-50 bg-ground"
        style={{ clipPath: 'circle(0px at 50% 50%)', visibility: 'hidden' }}
      >
        <div ref={revealGlow} className="absolute inset-0" />
      </div>
    </div>
  );
}
