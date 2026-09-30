import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { usePlatformLogin } from '../../api/backoffice';
import { useAdminAuth } from '../../backoffice/useAdminAuth';
import { getErrorMessage } from '../../lib/api';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { REJILLA_PIECES } from '../../components/Logo';
import { AuthError, AuthFooter } from '../../components/auth/AuthShell';
import { AUTH_ERROR_ID, AUTH_LINK, AUTH_SUBMIT } from '../../components/auth/authStyles';
import { useAuthFlow } from '../../components/auth/useAuthFlow';
import { AppIcon } from '../../components/motion/AppIcon';
import { LetterTitle, StageBackdrop, useStageParallax } from '../../components/motion/Stage';
import { trackPointerLight } from '../../components/motion/pointerLight';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';
import { useT } from '../../lib/i18n';
import { OPERATOR_FACE } from '../../lib/apps';

/**
 * The operator's door, on the same dark stage as the customers' sign-in --
 * but in slate, not menta, and with no "create an account" link under it,
 * because there is no such route. Back-office accounts are created from the
 * deployment with `make backend-bootstrap-admin`; a signup form here would be
 * a public button that hands over every customer.
 *
 * Its own frame rather than AuthShell's, for the one thing that has to differ:
 * the icon, and the light round the card, are slate. The motion is the
 * sign-in's (motion-auth.css): the icon assembles, the title arrives letter by
 * letter, a refusal shakes the card, and getting in lifts it all away.
 */
export function BackOfficeLoginPage() {
  const { isAuthenticated } = useAdminAuth();
  const login = usePlatformLogin();
  const flow = useAuthFlow(isAuthenticated);
  const t = useT();
  const onMove = useStageParallax();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const shaken = useRef(flow.refusals);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // On its way out the page takes no more input.
  useEffect(() => {
    root.current?.toggleAttribute('inert', flow.leaving);
  }, [flow.leaving]);

  useEffect(() => {
    if (flow.refusals === shaken.current) return;
    shaken.current = flow.refusals;
    const el = card.current;
    if (reduced || !el || typeof el.animate !== 'function') return;
    el.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-10px)' },
        { transform: 'translateX(8px)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 420, easing: 'ease-in-out' },
    );
  }, [flow.refusals, reduced]);

  if (flow.alreadyIn) {
    return <Navigate to="/backoffice" replace />;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    flow.sent();
    login.mutate(
      { email, password },
      { onSuccess: () => flow.leaveTo('/backoffice'), onError: flow.refused },
    );
  };

  const invalid = flow.lastError
    ? { 'aria-invalid': true, 'aria-describedby': AUTH_ERROR_ID }
    : {};

  return (
    <div
      ref={root}
      className="launcher relative min-h-screen overflow-hidden text-white"
      data-leaving={flow.leaving ? 'auth' : undefined}
      onPointerMove={onMove}
    >
      <StageBackdrop />

      <div className="auth-corner absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <LanguageSwitcher tone="glass" />
      </div>

      <main className="relative z-[1] flex min-h-screen items-start justify-center px-4 pb-8 pt-[max(4.5rem,11vh)]">
        <div className="w-full max-w-md">
          <div className="auth-head mb-8 text-center">
            <AppIcon
              pieces={REJILLA_PIECES}
              face={OPERATOR_FACE}
              className="auth-icon mx-auto mb-6 h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]"
            />
            <LetterTitle
              text="Back office"
              className="auth-title text-3xl font-semibold tracking-tight sm:text-4xl"
            />
            <p className="auth-sub mt-3 text-sm text-white/70 sm:text-base">
              {t('backoffice.login.subtitle')}
            </p>
          </div>

          <div className="auth-card-in">
            <div
              ref={card}
              onPointerMove={trackPointerLight}
              className="auth-card relative rounded-[1.75rem] border border-white/10 p-6 shadow-[0_40px_120px_-40px_rgb(100_116_139/0.5)] sm:p-8"
              style={{ '--accent': '148 163 184' } as CSSProperties}
            >
              <span
                aria-hidden="true"
                className="auth-spot pointer-events-none absolute inset-0 rounded-[inherit]"
              />
              <span
                aria-hidden="true"
                className="launcher-ring pointer-events-none absolute inset-0 rounded-[inherit]"
              />
              <form onSubmit={onSubmit} className="relative flex flex-col gap-4">
                <Input
                  tone="dark"
                  label={t('backoffice.login.email')}
                  type="email"
                  name="admin-email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  {...invalid}
                />
                <Input
                  tone="dark"
                  label={t('backoffice.login.password')}
                  type="password"
                  name="admin-password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  {...invalid}
                />
                {flow.lastError != null && (
                  <AuthError>{getErrorMessage(flow.lastError)}</AuthError>
                )}
                <Button
                  type="submit"
                  disabled={login.isPending || flow.leaving}
                  className={AUTH_SUBMIT}
                >
                  {login.isPending
                    ? t('backoffice.login.submitting')
                    : t('backoffice.login.submit')}
                </Button>
              </form>
            </div>
          </div>

          <AuthFooter>
            {t('backoffice.login.employee')}{' '}
            <a href="/login" className={AUTH_LINK}>
              {t('backoffice.login.employeeLink')}
            </a>
          </AuthFooter>
        </div>
      </main>
    </div>
  );
}
