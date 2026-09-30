// The employee shell: one bar, one column.
//
// No sidebar: an employee opens this on a phone between other things, so the
// layout is a single narrow column and the header is the only chrome. Under
// it, two tabs -- their shifts and the venue's menu -- which are the only two
// places there are to go, each there when the business has its app: the
// shifts app, and the shop the manager writes the menu in. They are links
// (each a page with its own address, so Back and a shared link work), marked
// as the current page for a screen reader and underlined for the eye, not
// only coloured.
//
// The business's inventory and shop are theirs too, in the manager's layout
// (lib/access.ts says what they may do there): with more than one app, the
// logo in the bar opens the launcher, as the manager's does.

import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useT } from '../../lib/i18n';
import { AppStage } from '../../components/motion/Stage';
import { AppIcon } from '../../components/motion/AppIcon';
import { REJILLA_PIECES } from '../../components/Logo';
import { PowerIcon } from '../../components/icons/PowerIcon';
import {
  APP_LOOK,
  appsFor,
  clearLauncherArrival,
  hasApp,
  LAUNCHER_PATH,
  type AppKey,
  type LauncherVisit,
} from '../../lib/apps';
import { useWorkspaceApps } from '../../auth/useWorkspaceApps';
import { usePermissions } from '../../auth/useCan';

const EMPLOYEE_TABS: { to: string; labelKey: string; end: boolean; app: AppKey }[] = [
  { to: '/', labelKey: 'chrome.nav.myShifts', end: true, app: 'shifts' },
  { to: '/menu', labelKey: 'chrome.nav.menu', end: false, app: 'store' },
];

export function EmployeeLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const apps = useWorkspaceApps();
  const permissions = usePermissions();
  const { pathname } = useLocation();
  const tabs = EMPLOYEE_TABS.filter((tab) => hasApp(apps, tab.app));
  // The launcher's reveal ends here when the shifts tile was chosen: nothing
  // to fade up from in this layout, so the note is cleared, not left for the
  // next time the manager's layout mounts.
  useEffect(clearLauncherArrival, []);
  const switcher = appsFor(user?.role, apps, permissions).length > 1;
  const icon = <AppIcon pieces={REJILLA_PIECES} face={APP_LOOK.shifts.face} className="h-9 w-9" />;

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="relative isolate min-h-screen">
      <AppStage />
      {/* The same dark glass as every other panel, not a white strip: on
          the stage a light bar was the one bright thing on the screen, and
          the name in it -- near-white ink now -- could not be read on it. */}
      <header className="sc-bar sticky top-0 z-10">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {switcher ? (
              // Named by what it does; the mark is the shifts app's, where
              // this screen is.
              <Link
                to={LAUNCHER_PATH}
                state={{ from: pathname } satisfies LauncherVisit}
                className="shrink-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
              >
                {icon}
                <span className="sr-only">{t('chrome.apps.switch')}</span>
              </Link>
            ) : (
              icon
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">
                {user?.full_name}
              </p>
              <p className="truncate text-xs text-gray-500">{user?.org_name}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={onLogout}
              className="group inline-flex min-h-[2rem] items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-white/25 hover:bg-white/10 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
            >
              <PowerIcon className="h-3.5 w-3.5 transition-transform duration-500 group-hover:rotate-90 motion-reduce:transition-none motion-reduce:group-hover:rotate-0" />
              <span className="hidden sm:inline">{t('chrome.logout')}</span>
              <span className="sr-only sm:hidden">{t('chrome.logout')}</span>
            </button>
          </div>
        </div>
        {tabs.length > 1 && (
          <nav aria-label={t('chrome.nav.employeeLabel')} className="mx-auto flex max-w-2xl px-4">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  [
                    'relative flex min-h-11 flex-1 items-center justify-center px-3 text-sm transition-colors motion-reduce:transition-none',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300',
                    // The current one: brighter, heavier, and a bar under it.
                    isActive
                      ? 'font-semibold text-gray-900 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand-400'
                      : 'font-medium text-gray-500 hover:text-gray-900',
                  ].join(' ')
                }
              >
                {t(tab.labelKey)}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
