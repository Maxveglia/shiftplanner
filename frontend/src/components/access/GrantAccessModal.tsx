// Giving one person on the roster a login: the form, as the employee's page
// has always had it (TeamAccessCard), and as the access window uses it for
// every row of its list. The credentials go back to whoever opened it, to be
// shown once (CredentialsHandover).

import { useId, useState, type FormEvent } from 'react';
import { useCreateEmployeeAccount } from '../../api/accounts';
import { useWorkspaceApps } from '../../auth/useWorkspaceApps';
import { looksLikeEmail } from '../../lib/access';
import { getErrorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { suggestPassword } from '../../lib/password';
import { Button } from '../Button';
import { Input } from '../Input';
import { Modal } from '../Modal';
import { AccessScope } from './AccessScope';
import type { Credentials } from './CredentialsHandover';
import { PasswordField } from './PasswordField';

export function GrantAccessModal({
  open,
  onClose,
  employeeId,
  defaultEmail,
  onGranted,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  /** The address on their record, offered to start with. */
  defaultEmail: string | null;
  onGranted: (credentials: Credentials) => void;
}) {
  const t = useT();
  const apps = useWorkspaceApps();
  const create = useCreateEmployeeAccount(employeeId);
  const formId = useId();
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [password, setPassword] = useState(suggestPassword);

  const [badEmail, setBadEmail] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      setBadEmail(true);
      return;
    }
    setBadEmail(false);
    create.mutate(
      { email: email.trim() || null, password },
      { onSuccess: (created) => onGranted({ email: created.email, password }) },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('people.access.form.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('people.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={create.isPending}>
            {create.isPending ? t('people.access.form.creating') : t('people.access.form.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
        <AccessScope
          role="employee"
          apps={apps}
          className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2"
        />
        <Input
          // Input ties its label to the field by id: without one, the label
          // names nothing (and a tap on it focuses nothing).
          id={`${formId}-email`}
          label={t('people.access.form.email')}
          // Text with the e-mail keyboard, not type="email": the browser's
          // own bubble would refuse a typo in the browser's language before
          // ours could say it (looksLikeEmail, below).
          type="text"
          inputMode="email"
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setBadEmail(false);
          }}
          error={badEmail ? t('errors.email_invalid') : undefined}
          placeholder={t('people.access.form.emailPlaceholder')}
        />
        <PasswordField label={t('people.access.form.password')} value={password} onChange={setPassword} />
        {create.isError && <p className="text-sm text-red-300">{getErrorMessage(create.error)}</p>}
      </form>
    </Modal>
  );
}
