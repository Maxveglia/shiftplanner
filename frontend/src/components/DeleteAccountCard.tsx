// Ending the account, which is the one thing here that cannot be undone.
//
// Two deliberate frictions, and they are not the same friction twice. The
// dialog asks for the workspace's own NAME typed back, so the last action is
// one nobody performs by reflex; and the server asks for it again, because a
// confirmation only the client enforces is a confirmation a stale tab or a
// curl can skip.
//
// It says what goes, by name, before it goes: staff, contracts, absences,
// rotas published and unpublished, and every login including the employees'.
// A manager who reads that list and still types their own workspace's name
// has decided, and is owed the thing they asked for rather than a soft delete
// that keeps their staff's names in a table somewhere.

import { useState } from 'react';
import { Button } from './Button';
import { Card } from './Card';
import { FIELD_SKIN } from './Input';
import { Modal } from './Modal';
import { deleteOrganization } from '../api/org';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../auth/useAuth';
import { useT } from '../lib/i18n';

export function DeleteAccountCard() {
  const t = useT();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgName = user?.org_name ?? '';
  // Compared the way the server compares it, so the button is enabled exactly
  // when the request would be accepted -- no dialog that lets you press and
  // then tells you no.
  const matches =
    typed.trim().toLocaleLowerCase() === orgName.trim().toLocaleLowerCase();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setTyped('');
    setError(null);
  };

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganization(typed.trim());
      // Out, immediately: the session's token still parses, and every screen
      // behind it now queries an organisation that is gone.
      logout();
    } catch (e) {
      setError(getErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Card title={t('settings.danger.title')} className="mt-6 max-w-2xl">
      <p className="text-sm text-gray-500">
        {t('settings.danger.help', { org: orgName })}
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-500">
        <li>{t('settings.danger.item.people')}</li>
        <li>{t('settings.danger.item.calendars')}</li>
        <li>{t('settings.danger.item.logins')}</li>
      </ul>
      <p className="mt-3 text-sm font-medium text-gray-700">
        {t('settings.danger.final')}
      </p>
      <div className="mt-4">
        <Button variant="danger" onClick={() => setOpen(true)}>
          {t('settings.danger.button')}
        </Button>
      </div>

      <Modal
        open={open}
        onClose={close}
        title={t('settings.danger.modal.title')}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={close} disabled={busy}>
              {t('settings.danger.cancel')}
            </Button>
            <Button variant="danger" onClick={confirm} disabled={!matches || busy}>
              {busy ? t('settings.danger.modal.deleting') : t('settings.danger.modal.confirm')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-700">
          {t('settings.danger.modal.body', { name: orgName })}
        </p>
        <label
          htmlFor="delete-confirm"
          className="mt-4 block text-sm font-medium text-gray-700"
        >
          {t('settings.danger.modal.label', { name: orgName })}
        </label>
        <input
          id="delete-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
          autoComplete="off"
          className={`${FIELD_SKIN} mt-1 w-full rounded-xl border-gray-400 px-3.5 py-2.5 hover:border-gray-500 focus:border-red-400 focus:ring-red-400/25`}
        />
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </Modal>
    </Card>
  );
}
