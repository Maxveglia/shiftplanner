import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useLogin } from '../api/auth';
import { useAuth } from '../auth/useAuth';
import { clearSessionEnded, getErrorMessage, sessionEnded } from '../lib/api';
import { useT } from '../lib/i18n';
import { landingAfterLogin, type LauncherVisit } from '../lib/apps';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { AuthError, AuthFooter, AuthShell } from '../components/auth/AuthShell';
import { AUTH_ERROR_ID, AUTH_LINK, AUTH_SUBMIT } from '../components/auth/authStyles';
import { useAuthFlow } from '../components/auth/useAuthFlow';

export function LoginPage() {
  const t = useT();
  const { isAuthenticated } = useAuth();
  const login = useLogin();
  const flow = useAuthFlow(isAuthenticated);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // The server closed the session this tab had open -- a tablet whose
  // password the manager changed, an access taken away (lib/api.ts): said
  // once, here, and forgotten as soon as it is shown. Read while rendering
  // and cleared after, so a render done twice still finds it.
  const [ended] = useState(sessionEnded);
  useEffect(() => {
    if (ended) clearSessionEnded();
  }, [ended]);

  if (flow.alreadyIn) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    flow.sent();
    login.mutate(
      // Without the spaces a phone's keyboard leaves around it: the server
      // reads the address the same way, capitals or none.
      { email: email.trim(), password },
      {
        // A manager picks an app first, greeted by name; so does anybody with
        // more than one app, and with just one they go straight into it.
        onSuccess: (data) =>
          flow.leaveTo(landingAfterLogin(data.user.role, data.user.apps, data.user.permissions), {
            warmGate: data.user.role === 'manager',
            apps: data.user.apps,
            state: { signedIn: true } satisfies LauncherVisit,
          }),
        onError: flow.refused,
      },
    );
  };

  // Both fields, because the refusal does not say which one was wrong.
  const invalid = flow.lastError
    ? { 'aria-invalid': true, 'aria-describedby': AUTH_ERROR_ID }
    : {};

  return (
    <AuthShell
      title={t('common.login.title')}
      subtitle={t('common.login.subtitle')}
      leaving={flow.leaving}
      shake={flow.refusals}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {/* Until the next try: then whatever it answers is the news. */}
        {ended && flow.lastError == null && !login.isPending && (
          <p role="status" className="m-fade rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white/85">
            {t('common.login.sessionEnded')}
          </p>
        )}
        <Input
          tone="dark"
          label={t('common.field.email')}
          type="email"
          name="email"
          autoComplete="email"
          // A tablet's keyboard would start the address with a capital and
          // "correct" it; neither is wanted in an email.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...invalid}
        />
        <Input
          tone="dark"
          label={t('common.field.password')}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          {...invalid}
        />
        {flow.lastError != null && <AuthError>{getErrorMessage(flow.lastError)}</AuthError>}
        <Button type="submit" disabled={login.isPending || flow.leaving} className={AUTH_SUBMIT}>
          {login.isPending ? t('common.login.submitting') : t('common.login.submit')}
        </Button>
      </form>
      <AuthFooter>
        {t('common.login.noAccount')}{' '}
        <Link to="/signup" className={AUTH_LINK}>
          {t('common.login.createOrg')}
        </Link>
      </AuthFooter>
    </AuthShell>
  );
}
