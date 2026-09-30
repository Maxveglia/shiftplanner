import { Button } from '../Button';
import { useT } from '../../lib/i18n';

export interface Credentials {
  email: string;
  password: string;
}

/**
 * What to pass on, shown once: the password is hashed the moment it is saved
 * and cannot be read back, so this is the only time anybody sees it. Kept by
 * whoever shows it only until the manager says done.
 */
export function CredentialsHandover({
  title,
  credentials,
  onDone,
}: {
  title: string;
  credentials: Credentials;
  onDone: () => void;
}) {
  const t = useT();
  return (
    <div
      role="status"
      className="mt-4 rounded-xl border border-brand-400/30 bg-brand-50 p-4 shadow-[0_12px_32px_-20px_rgb(68_214_180/0.6)]"
    >
      <p className="text-sm font-medium text-brand-900">{title}</p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex flex-wrap justify-between gap-x-4">
          <dt className="text-brand-700">{t('people.access.handover.email')}</dt>
          <dd className="break-all font-mono text-brand-900">{credentials.email}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4">
          <dt className="text-brand-700">{t('people.access.handover.password')}</dt>
          <dd className="break-all font-mono text-brand-900">{credentials.password}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-brand-700">{t('people.access.handover.onceOnly')}</p>
      <Button variant="secondary" size="sm" className="mt-3 min-h-9" onClick={onDone}>
        {t('people.access.handover.done')}
      </Button>
    </div>
  );
}
