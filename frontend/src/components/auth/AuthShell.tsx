import { useEffect, useRef, type ReactNode } from 'react';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';
import { REJILLA_PIECES } from '../Logo';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { AppIcon } from '../motion/AppIcon';
import { LetterTitle, StageBackdrop, useStageParallax } from '../motion/Stage';
import { trackPointerLight } from '../motion/pointerLight';
import { AUTH_ERROR_ID } from './authStyles';
import { APP_LOOK } from '../../lib/apps';

/**
 * The frame both ways in share: signing in and creating an organization.
 *
 * It stands on the launcher's dark stage (StageBackdrop), so signing in and
 * choosing an app read as one scene: the words lift away, the card sinks, and
 * the launcher's greeting rises in the same light. The ShiftPlanner icon
 * assembles from its pieces, the title arrives letter by letter, and the card
 * lights under the pointer and runs a thread of menta round its edge while
 * somebody types in it. A refusal shakes it once.
 *
 * It carries the language control, which is the only place before a session
 * exists to change it. The language is picked from the browser on a first
 * visit, so somebody working in English on a machine set to Spanish met a
 * Spanish sign-in screen and could only fix it after getting in, from
 * Settings -- the one screen they had to read in the wrong language to reach.
 * The welcome screen and the employee's shell already carry the same control
 * for the same reason.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  leaving = false,
  shake = 0,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** A successful sign-in carrying the page away (useAuthFlow). */
  leaving?: boolean;
  /** Changes on each refusal; the card shakes once per change. */
  shake?: number;
}) {
  const onMove = useStageParallax();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const shaken = useRef(shake);

  // On its way out the page takes no more input: a click on "create an
  // organization" in those few hundred milliseconds would unmount it, cancel
  // the exit and land the manager on the dashboard without the launcher.
  useEffect(() => {
    root.current?.toggleAttribute('inert', leaving);
  }, [leaving]);

  useEffect(() => {
    // Once per refusal: not again because the motion preference changed.
    if (shake === shaken.current) return;
    shaken.current = shake;
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
  }, [shake, reduced]);

  return (
    <div
      ref={root}
      className="launcher relative min-h-screen overflow-hidden text-white"
      data-leaving={leaving ? 'auth' : undefined}
      onPointerMove={onMove}
    >
      <StageBackdrop />

      <div className="auth-corner absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <LanguageSwitcher tone="glass" />
      </div>

      {/* Anchored near the top rather than centred: centred, an error line
          appearing under the fields moved the whole block up by its height,
          and back down again on the next try. */}
      <main className="relative z-[1] flex min-h-screen items-start justify-center px-4 pb-8 pt-[max(4.5rem,11vh)]">
        <div className="w-full max-w-md">
          <div className="auth-head mb-8 text-center">
            <AppIcon
              pieces={REJILLA_PIECES}
              face={APP_LOOK.shifts.face}
              className="auth-icon mx-auto mb-6 h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]"
            />
            {/* Keyed by the text so a change of language plays the title in
                again, rather than only the letters that happen to differ. */}
            <LetterTitle
              key={title}
              text={title}
              className="auth-title text-3xl font-semibold tracking-tight sm:text-4xl"
            />
            <p className="auth-sub mt-3 text-sm text-white/70 sm:text-base">{subtitle}</p>
          </div>

          <div className="auth-card-in">
            <div
              ref={card}
              onPointerMove={trackPointerLight}
              className="auth-card relative rounded-[1.75rem] border border-white/10 p-6 shadow-[0_40px_120px_-40px_rgb(20_161_132/0.45)] sm:p-8"
            >
              <span
                aria-hidden="true"
                className="auth-spot pointer-events-none absolute inset-0 rounded-[inherit]"
              />
              <span
                aria-hidden="true"
                className="launcher-ring pointer-events-none absolute inset-0 rounded-[inherit]"
              />
              <div className="relative">{children}</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/** A refusal from the server, read out as it arrives, and named by the fields. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p id={AUTH_ERROR_ID} role="alert" className="m-fade text-sm text-red-300">
      {children}
    </p>
  );
}

/** The line under the card: the way to the other form. */
export function AuthFooter({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-center text-sm text-white/70">{children}</p>;
}
