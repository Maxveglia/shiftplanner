// The first screen a new account sees, and the only thing on it.
//
// Before this page the interview was a card on the dashboard, and the
// dashboard is a busy place: a calendar with nothing in it, a brief box, a
// sidebar with four destinations. A manager who has just signed up does not
// need any of that yet -- they need to be asked what their business is like,
// once, with nothing competing for the screen. So this is a page of its own,
// outside the dashboard layout, and `FirstRunGate` sends every new account
// here before it can reach anything else.
//
// What it produces goes two ways: kept on the business profile, so every
// brief after this one is read by a planner that knows the business, and
// handed to the dashboard as the first brief, so the manager lands on a
// calendar rather than on an empty one.

import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  useCompleteInterview,
  useInterviewStatus,
  useResearchBusiness,
} from '../api/interview';
import { useBusinessProfile } from '../api/profile';
import { REJILLA_PIECES } from '../components/Logo';
import { AppIcon } from '../components/motion/AppIcon';
import { trackPointerLight } from '../components/motion/pointerLight';
import { InterviewChat } from '../components/onboarding/InterviewChat';
import { WelcomeProgress, type WelcomePhase } from '../components/onboarding/WelcomeProgress';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useAuth } from '../auth/useAuth';
import { useLanguage, useT } from '../lib/i18n';
import { toPayload, type WeekHours } from '../lib/onboarding/weekHours';
import type { FirstMonthPick } from '../lib/onboarding/firstMonth';
import { AppStage } from '../components/motion/Stage';
import { APP_LOOK } from '../lib/apps';

/** The brief the interview ended in, handed to the dashboard through router state. */
export interface WelcomeHandoff {
  brief: string;
  /**
   * The month the manager picked for the first calendar. Beside
   * the brief rather than in it: the brief is kept for good, and the month is
   * for this one calendar. Planned from today when it is the current month.
   */
  month?: FirstMonthPick | null;
}

export function WelcomePage() {
  const t = useT();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const status = useInterviewStatus();
  const complete = useCompleteInterview();
  const research = useResearchBusiness();
  // The wait after "build the calendar", held here and not read off the two
  // mutations: between the save settling and the search starting, react-query
  // reports neither as pending for a frame, and the buttons came back live in
  // it -- a second press would save twice. It is never cleared: the wait only
  // ever ends by leaving the page.
  const [waiting, setWaiting] = useState<{ phase: WelcomePhase; startedAt: number } | null>(
    null,
  );

  // Nothing to ask an account that has already been asked. Checked in an
  // effect and not with a bare Navigate so the redirect after `complete`
  // (which flips first_run_pending) does not race the one we do ourselves.
  const alreadyDone = profile.data?.first_run_pending === false;
  useEffect(() => {
    if (alreadyDone && !complete.isPending && !complete.isSuccess) {
      navigate('/', { replace: true });
    }
  }, [alreadyDone, complete.isPending, complete.isSuccess, navigate]);

  // No interview to give without a key on the server: the dashboard's short
  // first-run questions take over, as they did before this page existed.
  if (status.data && !status.data.available) {
    return <Navigate to="/" replace />;
  }

  const finish = async (brief: string, week: WeekHours | null, month: FirstMonthPick | null) => {
    setWaiting({ phase: 'save', startedAt: Date.now() });
    // Kept first, then built: the save is what makes the next brief start
    // from a known business, and it must not be lost to a fast redirect.
    try {
      await complete.mutateAsync({
        notes: brief,
        open_hours: week ? toPayload(week) : undefined,
      });
      // Then looked up: with the paragraph kept, the server can search for
      // how a business like this runs where it is, and the first calendar
      // is built with that in hand. Waited for, because the first brief is
      // sent the moment the dashboard opens; not required, because a failed
      // search must not cost the manager the calendar they were promised.
      if (brief.trim()) {
        try {
          setWaiting((w) => w && { ...w, phase: 'research' });
          await research.mutateAsync(language);
        } catch {
          // Settings offers "look again"; nothing to say here.
        }
      }
    } finally {
      const state: WelcomeHandoff = { brief, month };
      navigate('/', { replace: true, state });
    }
  };

  const skip = async () => {
    try {
      await complete.mutateAsync({ notes: '' });
    } finally {
      navigate('/', { replace: true });
    }
  };

  // The page is exactly the window and never scrolls: a manager who scrolls
  // the first screen they are shown has lost the header and the question, and
  // Max did not like that it could be done at all. What does not fit scrolls
  // inside the conversation's well instead (InterviewChat), so every box from
  // here down to it is a flex column that may shrink (`min-h-0`) -- sized to
  // its content when that fits, stopped at the window when it does not.
  //
  // `dvh` so a phone's browser bars are not counted as room, with `100vh` for
  // a browser that does not know it; `overflow: clip` so the card's entrance
  // (it rises from 28px lower) cannot make the page scroll for a moment.
  //
  // Short windows tighten the spacing, in two steps set by height alone:
  // up to 760px (a laptop with the browser's bars -- Max's is 1000×565) and
  // 761-920px. The whole week of opening hours has to fit in both, and above
  // 920px the page is as it was. The same two steps are in InterviewChat and
  // OpeningHoursGrid.
  return (
    <div className="relative isolate flex h-screen flex-col overflow-hidden supports-[height:100dvh]:h-dvh supports-[overflow:clip]:overflow-clip">
      <AppStage />
      <header className="auth-corner flex shrink-0 items-center justify-between gap-3 px-4 py-4 sm:px-6 [@media(max-height:760px)]:py-1.5 [@media(min-height:761px)_and_(max-height:920px)]:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <AppIcon
            pieces={REJILLA_PIECES}
            face={APP_LOOK.shifts.face}
            className="h-9 w-9 [@media(max-height:760px)]:h-8 [@media(max-height:760px)]:w-8"
          />
          <p className="truncate text-sm font-semibold text-gray-900">
            {user?.org_name ?? 'ShiftPlanner'}
          </p>
        </div>
        <LanguageSwitcher tone="glass" />
      </header>
      <main className="flex min-h-0 flex-1 flex-col items-center px-4 pb-12 pt-4 sm:pt-10 [@media(max-height:760px)]:pb-3 [@media(max-height:760px)]:pt-1 [@media(min-height:761px)_and_(max-height:920px)]:pb-5 [@media(min-height:761px)_and_(max-height:920px)]:pt-3">
        {/* The sign-in's card, at the size of a conversation: the same glass,
            the light under the pointer, and the thread of menta round the
            edge while the manager is typing into it (motion-auth.css).
            Wider in a short window: a wide line is a line less of the
            question, and height is what such a window lacks. */}
        <div className="auth-card-in flex min-h-0 w-full max-w-2xl flex-col [@media(max-height:760px)]:max-w-3xl">
          <div
            onPointerMove={trackPointerLight}
            className="auth-card relative flex min-h-0 w-full flex-col rounded-[1.75rem] border border-white/10 p-5 shadow-[0_40px_120px_-40px_rgb(20_161_132/0.45)] sm:p-8 [@media(max-height:760px)]:p-4"
          >
            <span
              aria-hidden="true"
              className="auth-spot pointer-events-none absolute inset-0 rounded-[inherit]"
            />
            <span
              aria-hidden="true"
              className="launcher-ring pointer-events-none absolute inset-0 rounded-[inherit]"
            />
            <div className="relative flex min-h-0 flex-col">
              <InterviewChat
                fullPage
                onFinish={(brief, week, month) => void finish(brief, week, month)}
                onCancel={() => void skip()}
                isBuilding={waiting !== null || complete.isPending}
                buildingLabel={research.isPending ? t('interview.brief.researching') : undefined}
                buildingPanel={
                  waiting ? (
                    <WelcomeProgress
                      phase={waiting.phase}
                      location={profile.data?.location}
                      startedAt={waiting.startedAt}
                    />
                  ) : undefined
                }
                cancelLabel={t('interview.skip')}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
