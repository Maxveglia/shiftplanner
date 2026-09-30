// The one thing on this screen the employee can change: whether a published
// rota reaches them by email.
//
// WHY IT EXISTS AT ALL. The email itself ends with "puedes desactivarlo desde
// tu horario, en Ajustes" (`backend/app/services/rota_email.py`). Without this
// card that sentence points at nothing, which is worse than not offering the
// choice -- a person who wants the emails to stop and cannot find the switch
// stops trusting the rest of the screen too.
//
// OFF IS NOT SILENT. Turning it off does not stop the manager from moving
// somebody's Saturday; it stops us from saying so. The card says that out
// loud rather than letting "off" read as "nothing will change".

import { useSetMyNotifications, useMyNotifications } from '../../api/me';
import { useAuth } from '../../auth/useAuth';
import { getErrorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';

export function NotificationsCard() {
  const t = useT();
  const { user } = useAuth();
  const notifications = useMyNotifications();
  const save = useSetMyNotifications();

  // While a save is in flight the switch shows WHAT WAS ASKED FOR, not what
  // the server last said. A toggle that snaps back for half a second under a
  // thumb reads as a failure, and this one is used on a phone.
  const on = save.isPending
    ? (save.variables ?? false)
    : (notifications.data?.notify_by_email ?? false);

  return (
    <section className="sc-glass rounded-3xl px-5 py-5">
      <h2 className="text-base font-semibold text-gray-900">
        {t('employee.settings.title')}
      </h2>

      {notifications.isError ? (
        <p className="mt-2 text-sm text-amber-800">
          {t('employee.notify.loadError')}
        </p>
      ) : (
        <>
          <label className="mt-3 flex items-start gap-3 text-sm text-gray-800">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
              checked={on}
              disabled={notifications.isLoading || save.isPending}
              onChange={(e) => save.mutate(e.target.checked)}
            />
            <span>{t('employee.notify.label')}</span>
          </label>

          <p className="mt-2 text-sm text-gray-500">
            {on
              ? t('employee.notify.help', { email: user?.email ?? '' })
              : t('employee.notify.off')}
          </p>

          {save.isPending && (
            <p className="mt-2 text-xs text-gray-500">{t('employee.notify.saving')}</p>
          )}
          {save.isError && (
            <p className="mt-2 text-sm text-red-600">
              {t('employee.notify.error')} {getErrorMessage(save.error)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
