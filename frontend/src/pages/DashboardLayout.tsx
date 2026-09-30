import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { DraftProvider } from '../lib/schedule/draftStore';
import { useAuth } from '../auth/useAuth';
import { REJILLA_PIECES, type MarkPiece } from '../components/Logo';
import { STOCK_PIECES } from '../components/StockLogo';
import { SHOP_PIECES } from '../components/ShopLogo';
import { Button } from '../components/Button';
import { useT } from '../lib/i18n';
import { UndoBar } from '../components/UndoBar';
import { AnimatedMark } from '../components/motion/AnimatedMark';
import { useRipple } from '../components/motion/useRipple';
import { indicatorBox, staggerDelay } from '../lib/motion/kit';
import { pageEntrance, sectionOf, springEasing, stretchFor } from '../lib/motion/chrome';
import { useReducedMotion } from '../lib/motion/useReducedMotion';
import {
  APP_LOOK,
  APPS,
  appFor,
  appsFor,
  LAUNCHER_PATH,
  clearLauncherArrival,
  launcherArrivalPending,
  type AppKey,
  type LauncherVisit,
} from '../lib/apps';
import { SECTIONS, sidebarFor, type NavItem } from '../lib/nav';
import { barTitleKey } from '../lib/mobileNav';
import { usePermissions } from '../auth/useCan';
import { useWorkspaceApps } from '../auth/useWorkspaceApps';
import { AppStage } from '../components/motion/Stage';
import { MobileNav } from '../components/layout/MobileNav';
import { initialsOf } from '../lib/initials';
import { PowerIcon } from '../components/icons/PowerIcon';
import { OrderAlertProvider } from '../components/inventory/OrderAlert';

/**
 * Receiving a delivery is done on a phone next to a truck, where even the
 * phone's bar (MobileNav) would take room from the scanner. There, and only
 * below `md`, the chrome steps aside altogether and the screen gets the whole
 * phone, with its own way back to the stock; from `md` up it is a page like
 * any other. On every other page, below `md`, the sidebar is the bar and
 * its panel.
 */
const RECEIVE_PATH = '/inventory/receive';

// Each app's mark, in pieces, so the logo can assemble it.
const MARKS: Record<AppKey, MarkPiece[]> = {
  shifts: REJILLA_PIECES,
  inventory: STOCK_PIECES,
  store: SHOP_PIECES,
};


/**
 * An app's icon at the size of a line of text: the launcher's tile, small --
 * its colour's gradient with the mark in white, assembling from its pieces
 * (`m-piece`) and parting a little under the pointer of whatever hosts it.
 */
function MarkTile({ app, className }: { app: AppKey; className: string }) {
  // The launcher's colours for this app (APP_LOOK), and a glow under it.
  const { face, accent } = APP_LOOK[app];
  const glow = `rgb(${accent} / 0.65)`;
  return (
    <span
      aria-hidden="true"
      className={['mc-tile grid shrink-0 place-items-center rounded-[28%]', className].join(' ')}
      style={
        {
          background: `linear-gradient(145deg, ${face[0]}, ${face[1]})`,
          '--tile-glow': glow,
        } as CSSProperties
      }
    >
      <AnimatedMark
        pieces={MARKS[app]}
        pieceClassName="m-piece"
        className="h-[60%] w-[60%] text-white drop-shadow-[0_1px_3px_rgb(0_0_0/0.3)]"
      />
    </span>
  );
}

// The spring the sidebar's pill travels on, sampled once.
const SPRING = springEasing();

/** How long a page takes to arrive after the route changes. */
const PAGE_MS = 420;
/** Links start arriving this long after the sidebar does, the mark first. */
const LINKS_AFTER_MS = 80;

/**
 * Where the ripples of a control are drawn: a clipped layer over the whole
 * control, so the control itself needs no `overflow-hidden` -- which would
 * clip the pieces of the logo's mark as they fly in from outside it. The
 * ripple's own `z-index: -1` still lands under the control's text, because
 * every control that uses this is `isolate`.
 */
function RippleLayer({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {children}
    </span>
  );
}

/** A link's box inside the list that positions it, transforms ignored. */
function layoutBox(el: HTMLElement) {
  return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
}

/**
 * The logo, as the way between apps: it opens the launcher, the apps side by
 * side, as a sign-in does but without the greeting. It carries the page it
 * was clicked on, so that choosing this same app there comes back here.
 */
function AppSwitcher({ current, orgName }: { current: AppKey; orgName: string }) {
  const t = useT();
  const { pathname, search } = useLocation();
  const ripple = useRipple<HTMLAnchorElement>();
  const currentApp = APPS.find((a) => a.key === current)!;

  return (
    <div className="border-b border-white/[0.06] px-3 py-3">
      <Link
        to={LAUNCHER_PATH}
        state={{ from: pathname + search } satisfies LauncherVisit}
        onPointerDown={ripple.onPointerDown}
        className="group m-mark-host mc-ink relative isolate flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
      >
        <RippleLayer>{ripple.ripples}</RippleLayer>
        {/* The open app's own mark: the logo is how you switch, so it shows
            where you are. It assembles from its pieces when the sidebar
            arrives and again when the app changes (the key), and parts a
            little under the pointer. */}
        <MarkTile key={current} app={current} className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{orgName}</p>
          <p key={current} className="mc-rise text-xs text-gray-500" style={{ '--d': '120ms' } as CSSProperties}>
            {t(currentApp.labelKey)}
          </p>
        </div>
        {/* Named after what is written, so the link can be asked for by
            what it says, with where it goes after. */}
        <span className="sr-only">{t('chrome.apps.switch')}</span>
        <AppsGridIcon />
      </Link>
    </div>
  );
}

/** A grid of apps: the switcher opens all of them, not a list. */
function AppsGridIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-gray-700"
    >
      <path d="M3 4.5A1.5 1.5 0 014.5 3h3A1.5 1.5 0 019 4.5v3A1.5 1.5 0 017.5 9h-3A1.5 1.5 0 013 7.5v-3zM11 4.5A1.5 1.5 0 0112.5 3h3A1.5 1.5 0 0117 4.5v3A1.5 1.5 0 0115.5 9h-3A1.5 1.5 0 0111 7.5v-3zM3 12.5A1.5 1.5 0 014.5 11h3A1.5 1.5 0 019 12.5v3A1.5 1.5 0 017.5 17h-3A1.5 1.5 0 013 15.5v-3zM11 12.5a1.5 1.5 0 011.5-1.5h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5v-3z" />
    </svg>
  );
}

/**
 * The same way to the launcher, in the phone's bar: the open app's mark and
 * the grid, at a thumb's size, named by what it does.
 */
function BarSwitcher({ current }: { current: AppKey }) {
  const t = useT();
  const { pathname, search } = useLocation();
  return (
    <Link
      to={LAUNCHER_PATH}
      state={{ from: pathname + search } satisfies LauncherVisit}
      className="group m-mark-host flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-1.5 transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
    >
      <MarkTile key={current} app={current} className="h-8 w-8" />
      <span className="sr-only">{t('chrome.apps.switch')}</span>
      <AppsGridIcon />
    </Link>
  );
}

/** One of the sidebar's destinations. */
function SideLink({
  item,
  order,
  onPointerEnter,
  roomy = false,
}: {
  item: NavItem;
  order: number;
  onPointerEnter: (e: PointerEvent<HTMLAnchorElement>) => void;
  /** A thumb's height (44px), for the phone's panel. */
  roomy?: boolean;
}) {
  const t = useT();
  const { pathname } = useLocation();
  const ripple = useRipple<HTMLAnchorElement>();
  const onDetail = item.details !== undefined && sectionOf(pathname, [item.details]) !== null;
  return (
    <NavLink
      to={item.to}
      end={item.end && !onDetail}
      onPointerDown={ripple.onPointerDown}
      onPointerEnter={onPointerEnter}
      style={{ '--d': `${LINKS_AFTER_MS + staggerDelay(order, 40)}ms` } as CSSProperties}
      className={({ isActive }) =>
        [
          `mc-link mc-link-in mc-ink relative isolate block rounded-xl px-3.5 ${roomy ? 'py-3' : 'py-2'} text-sm font-medium`,
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300',
          isActive ? 'text-brand-800' : 'text-gray-600 hover:text-gray-900',
        ].join(' ')
      }
    >
      <RippleLayer>{ripple.ripples}</RippleLayer>
      {t(item.labelKey)}
    </NavLink>
  );
}

/**
 * The sidebar's links, with a pill under the page you are on that slides to
 * the next one on a spring instead of the colour just jumping, and a softer
 * one that follows the pointer from link to link. Mounted once per app (the
 * key in the layout), so switching apps brings the new list in from scratch.
 */
function SideNav({
  items,
  common,
  roomy = false,
}: {
  items: NavItem[];
  common: NavItem[];
  roomy?: boolean;
}) {
  const t = useT();
  const { pathname } = useLocation();
  const all = [...items, ...common];
  const reduced = useReducedMotion();
  const list = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const face = useRef<HTMLSpanElement>(null);
  const hover = useRef<HTMLSpanElement>(null);
  const at = useRef<{ y: number } | null>(null);

  // The pill arrives with the link it sits under.
  const activeOrder = Math.max(
    0,
    all.findIndex((i) => i.to === sectionOf(pathname, all.map((x) => x.to))),
  );

  // Measured off the DOM, not worked out from the path: NavLink decides which
  // link is active, and the pill follows whatever it decided. Layout offsets,
  // not client rects, so a link still sliding in is measured where it lands.
  const place = useCallback(
    (moving: boolean) => {
      const wrap = list.current;
      const el = pill.current;
      if (!wrap || !el) return;
      const link = wrap.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!link) {
        el.dataset.hidden = '';
        at.current = null;
        return;
      }
      const box = indicatorBox(layoutBox(link), { left: 0, top: 0 });
      const before = at.current;
      at.current = { y: box.y };
      // Where it starts -- or reappears -- it simply is.
      if (!before) el.dataset.still = '';
      delete el.dataset.hidden;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.style.transform = `translate(${box.x}px, ${box.y}px)`;
      if (!before) {
        void el.offsetWidth;
        delete el.dataset.still;
        return;
      }
      const dy = box.y - before.y;
      const f = face.current;
      if (moving && dy !== 0 && !reduced && f && typeof f.animate === 'function') {
        // Stretched along its path, the leading edge ahead, then back.
        const s = stretchFor(dy, box.height);
        f.style.transformOrigin = dy > 0 ? '50% 0%' : '50% 100%';
        f.animate(
          [
            { transform: 'scaleY(1)' },
            { transform: `scaleY(${s})`, offset: 0.3 },
            { transform: 'scaleY(1)' },
          ],
          { duration: 460, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        );
      }
    },
    [reduced],
  );

  useLayoutEffect(() => {
    place(true);
  }, [pathname, place]);

  // Fonts arriving, the window changing size: the links move, the pill with them.
  useEffect(() => {
    const wrap = list.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [place]);

  const onEnter = (e: PointerEvent<HTMLAnchorElement>) => {
    const h = hover.current;
    if (!h || e.pointerType === 'touch') return;
    const box = indicatorBox(layoutBox(e.currentTarget), { left: 0, top: 0 });
    // Coming back into the list it fades in where the pointer is; only
    // between links does it slide.
    const fresh = !('on' in h.dataset);
    if (fresh) h.dataset.still = '';
    h.style.width = `${box.width}px`;
    h.style.height = `${box.height}px`;
    h.style.transform = `translate(${box.x}px, ${box.y}px)`;
    h.dataset.on = '';
    if (fresh) {
      void h.offsetWidth;
      delete h.dataset.still;
    }
  };
  const onLeave = () => {
    if (hover.current) delete hover.current.dataset.on;
  };

  return (
    <div ref={list} className="relative flex flex-col gap-1" onPointerLeave={onLeave}>
      <span ref={hover} aria-hidden="true" className="mc-hover rounded-xl bg-white/[0.05]" />
      <span
        ref={pill}
        aria-hidden="true"
        className="mc-pill"
        style={
          {
            '--mc-spring': SPRING.easing,
            '--mc-spring-ms': `${SPRING.duration}ms`,
          } as CSSProperties
        }
      >
        <span
          ref={face}
          className="mc-pill-face mc-pill-glass relative block h-full w-full rounded-xl"
          style={{ '--d': `${LINKS_AFTER_MS + staggerDelay(activeOrder, 40)}ms` } as CSSProperties}
        >
          {/* A notch of light on the pill's edge: where you are, told by
              shape as well as by the tinted glass. */}
          <span className="mc-notch absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand-400" />
        </span>
      </span>
      {items.map((item, i) => (
        <SideLink key={item.to} item={item} order={i} onPointerEnter={onEnter} roomy={roomy} />
      ))}
      {/* The pages of no app (Access), under a line and a word of their own:
          the same wherever they are opened from. */}
      {common.length > 0 && (
        <p
          className="mc-link-in mt-3 border-t border-white/[0.06] px-3.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-gray-500"
          style={{ '--d': `${LINKS_AFTER_MS + staggerDelay(items.length, 40)}ms` } as CSSProperties}
        >
          {t('chrome.nav.commonLabel')}
        </p>
      )}
      {common.map((item, i) => (
        <SideLink
          key={item.to}
          item={item}
          order={items.length + 1 + i}
          onPointerEnter={onEnter}
          roomy={roomy}
        />
      ))}
    </div>
  );
}

/**
 * What the sidebar holds, top to bottom: the way between apps, the app's
 * links, and who is signed in with the way out. The same on a desk, in the
 * sidebar, and on a phone, in the panel MobileNav opens -- one list, so the
 * two can never offer different pages.
 */
function SidebarBody({
  app,
  items,
  common,
  onLogout,
  roomy = false,
}: {
  app: AppKey | null;
  items: NavItem[];
  common: NavItem[];
  onLogout: () => void;
  roomy?: boolean;
}) {
  const { user } = useAuth();
  const t = useT();
  // The user's block arrives after the last link.
  const userDelay = LINKS_AFTER_MS + staggerDelay(items.length + common.length, 40);
  return (
    <>
      {/* No app at all only for a business with none, on a common page. */}
      <AppSwitcher current={app ?? 'shifts'} orgName={user?.org_name ?? 'ShiftPlanner'} />

      <nav className="flex-1 px-3 py-4">
        <SideNav key={app ?? ''} items={items} common={common} roomy={roomy} />
      </nav>

      <div
        className="mc-rise border-t border-white/[0.06] p-3"
        style={{ '--d': `${userDelay}ms` } as CSSProperties}
      >
        {/* Who is signed in, as a small card of the same glass: a round
            badge of their initials where a photo would go, lit in the
            brand's gradient, then the name, the address and the role. */}
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-brand-deep text-xs font-semibold tracking-wide text-white shadow-[0_6px_16px_-8px_rgb(68_214_180/0.8)] ring-1 ring-inset ring-white/15"
          >
            {initialsOf(user?.full_name, user?.email)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">
              {user?.full_name}
            </p>
            <p className="truncate text-xs text-gray-500">{user?.email}</p>
            {user?.role && (
              <span className="mt-1 inline-block rounded-full bg-brand-400/10 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-400/20">
                {t(`chrome.role.${user.role}`)}
              </span>
            )}
          </div>
        </div>
        <Button variant="secondary" size="sm" className="group w-full" onClick={onLogout}>
          {/* The launcher's sign-out mark, turning the same way on hover. */}
          <PowerIcon className="mc-turn h-3.5 w-3.5 shrink-0 text-gray-500" />
          {t('chrome.logout')}
        </Button>
        {/* Which build is running, so "is the fix live on my screen?" has
            an answer on the screen. */}
        <p className="mt-2 text-center text-[10px] tabular-nums text-gray-500">
          {t('chrome.build', { when: new Date(__BUILD_TIME__).toLocaleString() })}
        </p>
      </div>
    </>
  );
}

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const t = useT();
  const reduced = useReducedMotion();
  const permissions = usePermissions();
  const workspaceApps = useWorkspaceApps();
  // The app a page belongs to; a page of none (Access) stays in the app it
  // was opened from -- its sidebar, its mark -- and, opened by its address,
  // in the first app the account has.
  const pageApp = appFor(pathname);
  const lastApp = useRef<AppKey | null>(null);
  if (pageApp) lastApp.current = pageApp;
  const app: AppKey | null =
    pageApp ?? lastApp.current ?? appsFor(user?.role, workspaceApps, permissions)[0]?.key ?? null;
  const { items, common } = sidebarFor(app, permissions);
  const receiving = pathname === RECEIVE_PATH;
  // Arriving from the launcher, whose reveal ends on this layout's own grey:
  // the screen fades up out of it instead of being there all at once.
  const [fromLauncher] = useState(launcherArrivalPending);
  useEffect(clearLauncherArrival, []);

  // --- The page arrives ------------------------------------------------------
  //
  // On every change of route the content rises out of a short blur, from the
  // side the sidebar says it came from. Web Animations on the wrapper and no
  // `key`: a key would remount the page and throw away whatever the manager
  // had open in it. No fill either, so the transform is gone the moment the
  // animation ends -- a transform held on an ancestor would become the frame
  // of every `position: fixed` inside it. A first load that is already
  // fading up out of the launcher's reveal has had its entrance.
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(fromLauncher ? pathname : null);
  const entering = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const prev = shown.current;
    if (prev === pathname) return;
    shown.current = pathname;
    const el = content.current;
    if (reduced || !el || typeof el.animate !== 'function') return;
    const from = pageEntrance(prev, pathname, SECTIONS);
    if (!from) return;
    entering.current?.cancel();
    entering.current = el.animate(
      [
        { opacity: 0, transform: `translate(${from.x}px, ${from.y}px)`, filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ],
      { duration: PAGE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }, [pathname, reduced]);

  // Signing out, the app fades away before the login takes its place --
  // opacity only, for the same reason as above -- and a second click while
  // it does is ignored.
  const leaving = useRef(false);
  const onLogout = () => {
    if (leaving.current) return;
    leaving.current = true;
    const leave = () => {
      logout();
      navigate('/login', { replace: true });
    };
    const el = root.current;
    if (reduced || !el || typeof el.animate !== 'function') {
      leave();
      return;
    }
    el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 220,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    }).finished.then(leave, leave);
  };

  // What the phone's bar calls the page: its link in the sidebar, or the
  // app's name on a page the sidebar does not list.
  const currentApp = APPS.find((a) => a.key === app);
  const barTitle = t(barTitleKey(pathname, [...items, ...common], currentApp?.labelKey ?? 'chrome.mobileNav.title'));

  return (
    // The low-stock notice hangs here, over every page, for the reason the
    // draft below does: a sale's answer can come back after its page is
    // gone. While the inventory is the app open, it checks once, on
    // entering it, whether to open by itself.
    <OrderAlertProvider watchEntry={app === 'inventory'}>
    {/* A column on a phone -- the bar over the page -- and a row from `md`,
        the sidebar beside it. */}
    <div
      ref={root}
      className={['relative isolate flex min-h-screen flex-col md:flex-row', fromLauncher ? 'launcher-arrive' : ''].join(' ')}
    >
      <AppStage />
      {/* Below `md`, the sidebar as a bar across the top and a panel it
          opens (MobileNav); not while receiving a delivery (RECEIVE_PATH). */}
      <MobileNav
        hidden={receiving}
        title={barTitle}
        subtitle={currentApp ? t(currentApp.labelKey) : user?.org_name ?? 'ShiftPlanner'}
        switcher={<BarSwitcher current={app ?? 'shifts'} />}
      >
        {(close) => (
          <SidebarBody
            app={app}
            items={items}
            common={common}
            roomy
            onLogout={() => {
              close();
              onLogout();
            }}
          />
        )}
      </MobileNav>
      {/* Pinned to the viewport: the page under it can be as long as the
          calendar needs, and the way to the other screens never scrolls
          out of reach. If the sidebar itself ever outgrows the window it
          scrolls on its own instead of stretching the page. From `md` up:
          on a phone it would leave the page a sliver, and MobileNav stands
          in for it. */}
      <aside className="mc-aside sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] md:flex">
        <SidebarBody app={app} items={items} common={common} onLogout={onLogout} />
      </aside>

      {/* The draft calendar hangs here, not inside the page: this layout
          stays mounted across every screen in the sidebar, so stepping into
          Employees and back no longer throws the manager's work away. */}
      <main className="flex-1 overflow-x-hidden">
        {/* 72rem is a reading width, and every screen here is reading -- a
            roster, a form, a list of absences -- except one. The calendar is
            the only page that puts a second column beside its content (the
            hours each person lands on if the draft is published), and on a
            wide monitor 72rem is not enough for both: the year grid's day
            circles are a fixed 28px, so a month squeezed under ~196px stops
            fitting its own week instead of shrinking politely.
            So the dashboard alone is allowed 84rem, and only from the width
            where the second column appears at all. Every other screen keeps
            the reading width it was given. Receiving, on a phone, has the
            whole width to itself and brings its own margins; any other page
            on a phone gets the employee's screen's (16px), not a desk's. */}
        <div
          ref={content}
          className={[
            'mx-auto max-w-6xl',
            receiving ? 'md:px-6 md:py-8' : 'px-4 py-6 md:px-6 md:py-8',
            pathname === '/' ? 'min-[1440px]:max-w-[84rem]' : '',
          ].join(' ')}
        >
          <DraftProvider key={user?.org_id ?? 'anon'} scope={user?.org_id}>
            <Outlet />
          </DraftProvider>
        </div>
      </main>

      {/* Same reason as the draft above it: an offer to undo a removal has to
          outlive the screen the removal happened on. A manager who takes
          somebody off the roster and immediately opens the calendar has not
          changed their mind. */}
      <UndoBar />
    </div>
    </OrderAlertProvider>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
