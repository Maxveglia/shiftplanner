import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useSignup } from '../api/auth';
import { useAuth } from '../auth/useAuth';
import { getErrorMessage } from '../lib/api';
import { useT } from '../lib/i18n';
import { homeFor, LAUNCHER_PATH } from '../lib/apps';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { AuthError, AuthFooter, AuthShell } from '../components/auth/AuthShell';
import { AUTH_ERROR_ID, AUTH_LINK, AUTH_SUBMIT } from '../components/auth/authStyles';
import { useAuthFlow } from '../components/auth/useAuthFlow';

export function SignupPage() {
  const t = useT();
  const { isAuthenticated } = useAuth();
  const signup = useSignup();
  const flow = useAuthFlow(isAuthenticated);

  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (flow.alreadyIn) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    flow.sent();
    signup.mutate(
      { org_name: orgName, full_name: fullName, email, password },
      // A new account is a manager's: warm up what the gates wait for. A
      // workspace still being prepared -- every new one, which starts from the
      // template -- lands on the launcher, which says so above its apps; the
      // shifts app's first run is met on opening it from there. Otherwise it
      // goes where `/` would take it, without a redirect on the way.
      {
        onSuccess: (data) =>
          flow.leaveTo(data.user.preparing ? LAUNCHER_PATH : homeFor(data.user.apps), {
            warmGate: true,
            apps: data.user.apps,
          }),
        onError: flow.refused,
      },
    );
  };

  return (
    <AuthShell
      title={t('common.signup.title')}
      subtitle={t('common.signup.subtitle')}
      leaving={flow.leaving}
      shake={flow.refusals}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          tone="dark"
          label={t('common.signup.orgName')}
          name="org_name"
          required
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
        />
        <Input
          tone="dark"
          label={t('common.signup.fullName')}
          name="full_name"
          autoComplete="name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <Input
          tone="dark"
          label={t('common.field.email')}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={flow.lastError ? true : undefined}
          aria-describedby={flow.lastError ? AUTH_ERROR_ID : undefined}
        />
        <Input
          tone="dark"
          label={t('common.field.password')}
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {flow.lastError != null && <AuthError>{getErrorMessage(flow.lastError)}</AuthError>}
        <Button type="submit" disabled={signup.isPending || flow.leaving} className={AUTH_SUBMIT}>
          {signup.isPending ? t('common.signup.submitting') : t('common.signup.submit')}
        </Button>
      </form>
      <AuthFooter>
        {t('common.signup.haveAccount')}{' '}
        <Link to="/login" className={AUTH_LINK}>
          {t('common.signup.signIn')}
        </Link>
      </AuthFooter>
    </AuthShell>
  );
}
