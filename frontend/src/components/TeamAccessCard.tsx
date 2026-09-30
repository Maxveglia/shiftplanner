// Giving one person on the roster a way in: their own shifts, and the
// business's inventory and shop as far as an employee may use them
// (lib/access.ts).
//
// Employees never sign up: they exist because a manager added them, and they
// get in when that manager says so -- here, on their page, or in the access
// window (/access), with the same form (components/access). The credentials
// are shown once, here, for the manager to pass on -- the password is hashed
// the moment it is saved and cannot be read back. Taking it away is asked
// first (RevokeAccessDialog).

import { useState } from 'react';
import { useEmployeeAccount } from '../api/accounts';
import { useWorkspaceApps } from '../auth/useWorkspaceApps';
import { formatDate } from '../lib/format';
import { useT } from '../lib/i18n';
import type { EmployeeOut } from '../types';
import { AccessScope } from './access/AccessScope';
import { CredentialsHandover, type Credentials } from './access/CredentialsHandover';
import { GrantAccessModal } from './access/GrantAccessModal';
import { RevokeAccessDialog } from './access/RevokeAccessDialog';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './StateMessage';

export function TeamAccessCard({ employee }: { employee: EmployeeOut }) {
  const t = useT();
  const apps = useWorkspaceApps();
  const account = useEmployeeAccount(employee.id);
  const firstName = employee.full_name.split(' ')[0];

  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  /** Kept only until the manager closes the panel -- never fetched again. */
  const [handover, setHandover] = useState<Credentials | null>(null);

  return (
    <Card
      title={t('people.access.title')}
      actions={
        account.data ? (
          <Badge tone={account.data.is_active ? 'green' : 'gray'}>
            {account.data.is_active
              ? t('people.access.canSignIn')
              : t('people.access.disabled')}
          </Badge>
        ) : (
          <Badge tone="gray">{t('people.access.noLogin')}</Badge>
        )
      }
    >
      {account.isLoading ? (
        <Spinner />
      ) : account.data ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-900">{account.data.email}</p>
            <p className="text-xs text-gray-500">
              {t('people.access.granted', {
                date: formatDate(account.data.created_at),
              })}
            </p>
            <AccessScope role="employee" apps={apps} className="mt-2" />
          </div>
          <Button variant="secondary" size="sm" className="min-h-9" onClick={() => setRevoking(true)}>
            {t('people.access.revoke')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            {/* "So they do not see the shifts you publish" only where there
                are shifts to publish. */}
            {t(apps.includes('shifts') ? 'people.access.noAccess' : 'people.access.noAccessPlain', {
              name: firstName,
            })}
          </p>
          <Button size="sm" onClick={() => setOpen(true)}>
            {t('people.access.give')}
          </Button>
        </div>
      )}

      {handover && (
        <CredentialsHandover
          title={t('people.access.handover.title', { name: firstName })}
          credentials={handover}
          onDone={() => setHandover(null)}
        />
      )}

      <RevokeAccessDialog
        open={revoking}
        onClose={() => setRevoking(false)}
        employeeId={employee.id}
        name={employee.full_name}
      />

      <GrantAccessModal
        open={open}
        onClose={() => setOpen(false)}
        employeeId={employee.id}
        defaultEmail={employee.email ?? null}
        onGranted={(credentials) => {
          setHandover(credentials);
          setOpen(false);
        }}
      />
    </Card>
  );
}
