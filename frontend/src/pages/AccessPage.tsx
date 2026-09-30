// The access window: who can sign in to the business, and as what. The
// manager's (`access.manage`), a page of no app (lib/apps.ts, COMMON_PATHS),
// reached from the sidebar of every one.
//
// In the order Max asked for it: the manager, with everything; the team, each
// with a login or without, given and taken here exactly as on their own page
// (components/access); the shop accounts -- the till's tablets, which are not
// people and have no shifts; what each of the three can do, read from the
// server's own table so that it cannot say one thing while the server does
// another; and last, only when there are any, the old logins of people no
// longer on the team, to delete.
//
// Nothing that takes a way in away is done at one press: revoking an
// employee's login, deleting a tablet or an old account each asks first.

import { useId, useState, type FormEvent } from 'react';
import {
  useAccessOverview,
  useCreateStoreAccount,
  useDeleteOrphanAccount,
  useDeleteStoreAccount,
  useSetStorePassword,
  type AccessEmployee,
  type AccessManager,
  type AccessOverview,
  type OrphanAccount,
  type StoreAccount,
} from '../api/access';
import { useAuth } from '../auth/useAuth';
import { useWorkspaceApps } from '../auth/useWorkspaceApps';
import { AccessScope } from '../components/access/AccessScope';
import { CredentialsHandover, type Credentials } from '../components/access/CredentialsHandover';
import { GrantAccessModal } from '../components/access/GrantAccessModal';
import { PasswordField } from '../components/access/PasswordField';
import { RevokeAccessDialog } from '../components/access/RevokeAccessDialog';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Spinner, StateMessage } from '../components/StateMessage';
import { looksLikeEmail, permissionTable, ROLES } from '../lib/access';
import { errorCode, getErrorMessage } from '../lib/api';
import { hasApp } from '../lib/apps';
import { formatDate } from '../lib/format';
import { useT } from '../lib/i18n';
import { suggestPassword } from '../lib/password';
import { PageHeader } from './DashboardLayout';

/** A row of one of the lists: who, then what they have, then what can be done. */
const ROW = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3';

export function AccessPage() {
  const t = useT();
  const { user } = useAuth();
  const apps = useWorkspaceApps();
  const overview = useAccessOverview();
  const data = overview.data;

  return (
    <div>
      <PageHeader title={t('access.title')} description={t('access.description', { org: user?.org_name ?? '' })} />
      {overview.isLoading ? (
        <Spinner />
      ) : !data ? (
        <StateMessage tone="error" title={t('access.loadError')} description={getErrorMessage(overview.error)} />
      ) : (
        <div className="space-y-6">
          <ManagersCard managers={data.managers} me={user?.id} />
          {/* Employees are the shifts app's roster: without it there is
              nobody to list. */}
          {hasApp(apps, 'shifts') && <EmployeesCard employees={data.employees} apps={apps} />}
          {/* A tablet has the inventory and the shop to use, or nothing. */}
          {(hasApp(apps, 'inventory') || hasApp(apps, 'store')) && <StoresCard stores={data.stores} apps={apps} />}
          <PermissionsCard roles={data.roles} apps={apps} />
          {data.orphans.length > 0 && <OrphansCard orphans={data.orphans} />}
        </div>
      )}
    </div>
  );
}

function ManagersCard({ managers, me }: { managers: AccessManager[]; me?: string }) {
  const t = useT();
  return (
    <Card title={t('access.managers.title')}>
      <ul className="-my-3 divide-y divide-white/[0.06]">
        {managers.map((m) => (
          <li key={m.id} className={ROW}>
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-gray-900">
                {m.full_name}
                {m.id === me && <span className="ml-2 text-xs font-normal text-gray-500">({t('access.managers.you')})</span>}
              </p>
              <p className="break-all text-xs text-gray-500">{m.email}</p>
            </div>
            <Badge tone="green">{t('access.managers.full')}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EmployeesCard({ employees, apps }: { employees: AccessEmployee[]; apps: readonly string[] }) {
  const t = useT();
  return (
    <Card title={t('access.employees.title')}>
      <p className="text-sm text-gray-600">{t('access.employees.help')}</p>
      <AccessScope role="employee" apps={apps} className="mt-2" />
      {employees.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">{t('access.employees.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.06] border-t border-white/[0.06]">
          {employees.map((e) => (
            <EmployeeRow key={e.employee_id} employee={e} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One person on the team: whether they can sign in, and the way to change that (TeamAccessCard's). */
function EmployeeRow({ employee }: { employee: AccessEmployee }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [handover, setHandover] = useState<Credentials | null>(null);
  const account = employee.account;
  const firstName = employee.name.split(' ')[0];

  return (
    <li className="py-3">
      <div className={ROW.replace('py-3', '')}>
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-gray-900">{employee.name}</p>
          <p className="break-all text-xs text-gray-500">
            {account?.email ?? employee.email ?? t('access.employees.noEmail')}
          </p>
          {account && (
            <p className="text-xs text-gray-500">
              {account.last_seen_at
                ? t('access.lastSeen', { date: formatDate(account.last_seen_at) })
                : t('access.neverSeen')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{t('chrome.role.employee')}</span>
          {/* The state in words, never the colour alone. */}
          {account ? (
            <Badge tone={account.is_active ? 'green' : 'gray'}>
              {account.is_active ? t('people.access.canSignIn') : t('people.access.disabled')}
            </Badge>
          ) : (
            <Badge tone="gray">{t('people.access.noLogin')}</Badge>
          )}
          {account ? (
            <Button variant="secondary" size="sm" className="min-h-9" onClick={() => setRevoking(true)}>
              {t('people.access.revoke')}
              <span className="sr-only"> · {employee.name}</span>
            </Button>
          ) : (
            <Button size="sm" className="min-h-9" onClick={() => setOpen(true)}>
              {t('people.access.give')}
              <span className="sr-only"> · {employee.name}</span>
            </Button>
          )}
        </div>
      </div>
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
        employeeId={employee.employee_id}
        name={employee.name}
      />
      <GrantAccessModal
        open={open}
        onClose={() => setOpen(false)}
        employeeId={employee.employee_id}
        defaultEmail={employee.email}
        onGranted={(credentials) => {
          setHandover(credentials);
          setOpen(false);
        }}
      />
    </li>
  );
}

function StoresCard({ stores, apps }: { stores: StoreAccount[]; apps: readonly string[] }) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  /** The new account's credentials, shown once. */
  const [handover, setHandover] = useState<{ name: string; credentials: Credentials } | null>(null);

  return (
    <Card
      title={t('access.stores.title')}
      actions={
        <Button size="sm" className="min-h-9" onClick={() => setCreating(true)}>
          {t('access.stores.new')}
        </Button>
      }
    >
      <p className="text-sm text-gray-600">{t('access.stores.help')}</p>
      <AccessScope role="store" apps={apps} className="mt-2" />
      {handover && (
        <CredentialsHandover
          title={t('access.stores.handover.title', { name: handover.name })}
          credentials={handover.credentials}
          onDone={() => setHandover(null)}
        />
      )}
      {stores.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">{t('access.stores.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.06] border-t border-white/[0.06]">
          {stores.map((store) => (
            <StoreRow key={store.id} store={store} />
          ))}
        </ul>
      )}
      <NewStoreModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(name, credentials) => {
          setHandover({ name, credentials });
          setCreating(false);
        }}
      />
    </Card>
  );
}

function NewStoreModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string, credentials: Credentials) => void;
}) {
  const t = useT();
  const create = useCreateStoreAccount();
  const formId = useId();
  const nameHelpId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
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
      // The server keeps the address in lower case and without spaces, and
      // compares it so at the sign-in: sent the same way, what is handed
      // over is what it keeps.
      { name: name.trim(), email: email.trim().toLowerCase(), password },
      {
        onSuccess: (created) => {
          onCreated(created.name, { email: created.email, password });
          setName('');
          setEmail('');
          setPassword(suggestPassword());
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('access.stores.form.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('access.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={create.isPending}>
            {create.isPending ? t('access.stores.form.creating') : t('access.stores.form.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs text-gray-600">
          {t('access.stores.help')}
        </p>
        <div>
          <Input
            // Input ties its label to the field by id: without one, the
            // label names nothing.
            id={`${formId}-name`}
            label={t('access.stores.form.name')}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('access.stores.form.namePlaceholder')}
            aria-describedby={nameHelpId}
          />
          <p id={nameHelpId} className="mt-1 text-xs text-gray-500">
            {t('access.stores.form.nameHelp')}
          </p>
        </div>
        <Input
          id={`${formId}-email`}
          label={t('access.stores.form.email')}
          // Text with the e-mail keyboard, not type="email": the browser's
          // own bubble would refuse a typo in the browser's language before
          // ours could say it (looksLikeEmail, below).
          type="text"
          inputMode="email"
          required
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setBadEmail(false);
          }}
          error={badEmail ? t('errors.email_invalid') : undefined}
          placeholder={t('access.stores.form.emailPlaceholder')}
        />
        <PasswordField label={t('access.stores.form.password')} value={password} onChange={setPassword} />
        {create.isError && <p className="text-sm text-red-300">{getErrorMessage(create.error)}</p>}
      </form>
    </Modal>
  );
}

/** One tablet: its name and address, when it was last in, and its password or its end. */
function StoreRow({ store }: { store: StoreAccount }) {
  const t = useT();
  const setPasswordOf = useSetStorePassword();
  const remove = useDeleteStoreAccount();
  const formId = useId();
  const [changing, setChanging] = useState(false);
  const [password, setPassword] = useState(suggestPassword);
  const [deleting, setDeleting] = useState(false);
  const [handover, setHandover] = useState<Credentials | null>(null);

  const onChangePassword = (e: FormEvent) => {
    e.preventDefault();
    setPasswordOf.mutate(
      { id: store.id, password },
      {
        onSuccess: () => {
          setHandover({ email: store.email, password });
          setChanging(false);
          setPassword(suggestPassword());
        },
      },
    );
  };

  return (
    <li className="py-3">
      <div className={ROW.replace('py-3', '')}>
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-gray-900">{store.name}</p>
          <p className="break-all text-xs text-gray-500">{store.email}</p>
          <p className="text-xs text-gray-500">
            {store.last_seen_at
              ? t('access.lastSeen', { date: formatDate(store.last_seen_at) })
              : t('access.neverSeen')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{t('chrome.role.store')}</span>
          {/* Named after what they say, then whose (WCAG 2.5.3). */}
          <Button variant="secondary" size="sm" className="min-h-9" onClick={() => setChanging(true)}>
            {t('access.stores.password.button')}
            <span className="sr-only"> · {store.name}</span>
          </Button>
          <Button variant="ghost" size="sm" className="min-h-9" onClick={() => setDeleting(true)}>
            {t('access.stores.delete.button')}
            <span className="sr-only"> · {store.name}</span>
          </Button>
        </div>
      </div>
      {handover && (
        <CredentialsHandover
          title={t('access.stores.password.handover', { name: store.name })}
          credentials={handover}
          onDone={() => setHandover(null)}
        />
      )}

      <Modal
        open={changing}
        onClose={() => setChanging(false)}
        title={t('access.stores.password.title', { name: store.name })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setChanging(false)}>
              {t('access.cancel')}
            </Button>
            <Button type="submit" form={formId} disabled={setPasswordOf.isPending}>
              {setPasswordOf.isPending ? t('access.stores.password.saving') : t('access.stores.password.submit')}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onChangePassword} className="flex flex-col gap-4">
          <p className="rounded-xl border border-amber-400/30 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t('access.stores.password.note')}
          </p>
          <PasswordField label={t('access.stores.form.password')} value={password} onChange={setPassword} />
          {setPasswordOf.isError && <p className="text-sm text-red-300">{getErrorMessage(setPasswordOf.error)}</p>}
        </form>
      </Modal>

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t('access.stores.delete.title', { name: store.name })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              {t('access.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(store.id, { onSuccess: () => setDeleting(false) })}
            >
              {remove.isPending ? t('access.stores.delete.deleting') : t('access.stores.delete.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700">{t('access.stores.delete.body')}</p>
        {remove.isError && <p className="mt-3 text-sm text-red-300">{getErrorMessage(remove.error)}</p>}
      </Modal>
    </li>
  );
}

/** Yes or no in words, with a mark beside it: never the colour alone. */
function YesNo({ yes }: { yes: boolean }) {
  const t = useT();
  return (
    <span className={['inline-flex items-center gap-1.5', yes ? 'font-medium text-brand-700' : 'text-gray-500'].join(' ')}>
      <span aria-hidden="true">{yes ? '✓' : '—'}</span>
      {t(yes ? 'access.table.yes' : 'access.table.no')}
    </span>
  );
}

function PermissionsCard({ roles, apps }: { roles: AccessOverview['roles']; apps: readonly string[] }) {
  const t = useT();
  const groups = permissionTable(roles, apps);
  const cell = 'px-3 py-2 text-left align-top';
  const groupRow = (label: string) => (
    <tr>
      <th
        scope="rowgroup"
        colSpan={ROLES.length + 1}
        className="bg-white/[0.03] px-3 pb-1.5 pt-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500"
      >
        {label}
      </th>
    </tr>
  );
  return (
    <Card title={t('access.table.title')}>
      {/* Its own scroll at a phone's width: the page never scrolls sideways. */}
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">{t('access.table.caption')}</caption>
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th scope="col" className={`${cell} font-medium text-gray-500`}>
                {t('access.table.permission')}
              </th>
              {ROLES.map((role) => (
                <th key={role} scope="col" className={`${cell} whitespace-nowrap font-semibold text-gray-900`}>
                  {t(`chrome.role.${role}`)}
                </th>
              ))}
            </tr>
          </thead>
          {/* The shifts are not a permission: the manager sees everybody's,
              an employee their own, a shop account none. */}
          {hasApp(apps, 'shifts') && (
            <tbody className="divide-y divide-white/[0.06]">
              {groupRow(t('access.table.group.shifts'))}
              <tr>
                <th scope="row" className={`${cell} font-normal text-gray-800`}>
                  {t('access.table.shifts.row')}
                </th>
                <td className={cell}>
                  <span className="font-medium text-brand-700">{t('access.table.shifts.all')}</span>
                </td>
                <td className={cell}>
                  <span className="font-medium text-brand-700">{t('access.table.shifts.own')}</span>
                </td>
                <td className={cell}>
                  <YesNo yes={false} />
                </td>
              </tr>
            </tbody>
          )}
          {groups.map(({ group, rows }) => (
            <tbody key={group} className="divide-y divide-white/[0.06]">
              {groupRow(t(`access.table.group.${group}`))}
              {rows.map(({ label, byRole }) => (
                <tr key={label}>
                  <th scope="row" className={`${cell} font-normal text-gray-800`}>
                    {t(`access.perm.${label}`)}
                  </th>
                  {ROLES.map((role) => (
                    <td key={role} className={cell}>
                      <YesNo yes={byRole[role]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Card>
  );
}

/**
 * The logins of people no longer on the team: they cannot sign in (the
 * server finds nobody behind them), and are here only to be deleted.
 */
function OrphansCard({ orphans }: { orphans: OrphanAccount[] }) {
  const t = useT();
  return (
    <Card title={t('access.orphans.title')}>
      <p className="text-sm text-gray-600">{t('access.orphans.help')}</p>
      <ul className="mt-3 divide-y divide-white/[0.06] border-t border-white/[0.06]">
        {orphans.map((orphan) => (
          <OrphanRow key={orphan.id} orphan={orphan} />
        ))}
      </ul>
    </Card>
  );
}

function OrphanRow({ orphan }: { orphan: OrphanAccount }) {
  const t = useT();
  const remove = useDeleteOrphanAccount();
  const [deleting, setDeleting] = useState(false);
  const close = () => {
    remove.reset();
    setDeleting(false);
  };

  return (
    <li className={ROW}>
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-gray-900">{orphan.full_name}</p>
        <p className="break-all text-xs text-gray-500">{orphan.email}</p>
        <p className="text-xs text-gray-500">
          {orphan.last_seen_at
            ? t('access.lastSeen', { date: formatDate(orphan.last_seen_at) })
            : t('access.neverSeen')}
        </p>
      </div>
      <Button variant="ghost" size="sm" className="min-h-9" onClick={() => setDeleting(true)}>
        {t('access.orphans.delete.button')}
        <span className="sr-only"> · {orphan.full_name}</span>
      </Button>

      <Modal
        open={deleting}
        onClose={close}
        title={t('access.orphans.delete.title', { name: orphan.full_name })}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t('access.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(orphan.id, {
                  onSuccess: close,
                  // Deleted by somebody else first: what was asked is done,
                  // and the list, asked again, no longer has it.
                  onError: (e) => {
                    if (errorCode(e) === 'account_not_found') close();
                  },
                })
              }
            >
              {remove.isPending ? t('access.orphans.delete.deleting') : t('access.orphans.delete.confirm')}
            </Button>
          </>
        }
      >
        <p className="break-words text-sm text-gray-700">{t('access.orphans.delete.body', { email: orphan.email })}</p>
        {remove.isError && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {getErrorMessage(remove.error)}
          </p>
        )}
      </Modal>
    </li>
  );
}
