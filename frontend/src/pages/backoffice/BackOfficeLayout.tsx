import { REJILLA_PIECES } from '../../components/Logo';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAuth } from '../../backoffice/useAdminAuth';
import { Button } from '../../components/Button';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useT } from '../../lib/i18n';
import { AppStage } from '../../components/motion/Stage';
import { AppIcon } from '../../components/motion/AppIcon';
import { PowerIcon } from '../../components/icons/PowerIcon';
import { OPERATOR_FACE } from '../../lib/apps';

const navItems = [
  { to: '/backoffice', labelKey: 'chrome.backoffice.nav.overview', end: true },
  { to: '/backoffice/customers', labelKey: 'chrome.backoffice.nav.customers' },
];

/**
 * Slate chrome, not the product's menta.
 *
 * This is the one screen where you are looking at other people's companies, and
 * mistaking it for a customer workspace is the mistake worth designing against.
 * A different shell answers "where am I?" before you read a word. On the dark
 * stage that shell is the app's own glass cooled towards slate (`sc-ops-rail`),
 * with the rejilla on a slate tile where a customer sees it in menta.
 *
 * Below `md` the rail becomes a bar across the top: at 375 px a 256 px rail
 * left a column of 119 px for tables of other people's companies.
 */
export function BackOfficeLayout() {
  const { admin, logout } = useAdminAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const t = useT();

  const onLogout = () => {
    logout();
    // Drop only the operator's cached data; a manager session open in the same
    // browser keeps its own.
    queryClient.removeQueries({ queryKey: ['backoffice'] });
    navigate('/backoffice/login', { replace: true });
  };

  return (
    <div className="relative isolate flex min-h-screen flex-col md:flex-row">
      <AppStage />
      <aside className="sc-ops-rail z-10 flex shrink-0 flex-col border-b md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-4 py-3 md:border-b md:border-white/[0.06] md:px-5 md:py-4">
          <AppIcon pieces={REJILLA_PIECES} face={OPERATOR_FACE} className="h-9 w-9" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">
              {t('chrome.backoffice.title')}
            </p>
            <p className="truncate text-xs text-slate-400">
              {t('chrome.backoffice.subtitle')}
            </p>
          </div>
          {/* On a phone the rail's foot is not there: the two things in it
              that cannot wait -- the language and the way out -- sit here. */}
          <div className="ml-auto flex shrink-0 items-center gap-2 md:hidden">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={onLogout}
              aria-label={t('chrome.logout')}
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-gray-700 transition hover:border-white/25 hover:bg-white/10 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300 motion-reduce:transition-none"
            >
              <PowerIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav
          aria-label={t('chrome.backoffice.title')}
          className="flex gap-1 px-3 pb-3 md:flex-1 md:flex-col md:py-4"
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'relative block rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300 motion-reduce:transition-none',
                  // The current page is told by weight and a slate bar, not
                  // only by its fill.
                  isActive
                    ? 'bg-slate-400/[0.14] font-semibold text-gray-900 ring-1 ring-inset ring-slate-300/20 md:before:absolute md:before:left-0 md:before:top-1/2 md:before:h-4 md:before:w-[3px] md:before:-translate-y-1/2 md:before:rounded-full md:before:bg-slate-300'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-gray-900',
                ].join(' ')
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>

        <div className="hidden border-t border-white/[0.06] p-4 md:block">
          <div className="mb-3">
            <p className="truncate text-sm font-medium text-gray-900">
              {admin?.full_name}
            </p>
            <p className="truncate text-xs text-slate-400">{admin?.email}</p>
          </div>
          <div className="mb-3">
            <LanguageSwitcher />
          </div>
          <Button variant="secondary" size="sm" className="w-full" onClick={onLogout}>
            <PowerIcon className="h-3.5 w-3.5" />
            {t('chrome.logout')}
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}



export function BackOfficeHeader({
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
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
