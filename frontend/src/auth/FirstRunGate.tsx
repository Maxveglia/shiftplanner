// Sends a brand-new account to the welcome screen before it sees anything
// else. Sits between ProtectedRoute and the dashboard layout, so it applies
// to every manager page and to none of the employee or back-office ones.
//
// Renders nothing until it knows: painting the dashboard for a moment and
// then whisking it away is worse than a blank beat. Two things are waited on
// -- whether the first run is still owed, and whether the server can give an
// interview at all -- and an account is sent along only when both say yes.
// Without a Gemini key the dashboard's own first-run questions are still the
// onboarding, as before.
//
// The first run is the shifts app's: its questions are about the rota, and
// both things it waits for are behind that app's door on the server. A
// business without the app owes no first run and is not asked -- asking would
// only earn two 403s -- so the gate lets it straight through.
//
// A business whose workspace is still being prepared is told so on the
// launcher, and that comes first: it is what Max wants a new account to read
// on arrival. So the launcher is let through for it, first run or not, and
// the welcome is met on opening the shifts app from there.
//
// And only the shifts app's own pages are held: the welcome asks about the
// rota, so a manager opening the inventory or the shop is let into it. Held
// there, a business that had not answered yet could not reach the shop it
// was set up with.

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useInterviewStatus } from '../api/interview';
import { useBusinessProfile } from '../api/profile';
import { StageBackdrop } from '../components/motion/Stage';
import { appFor, LAUNCHER_PATH } from '../lib/apps';
import { useWorkspaceState } from './useWorkspaceApps';

export const WELCOME_PATH = '/welcome';

/**
 * What a gate in front of the manager's screens shows while it waits. The
 * launcher is reached from the sign-in, both on the dark stage; a blank here
 * would flash the page's light grey between the two. The empty stage is what
 * the launcher then rises on. Anywhere else, a blank beat.
 */
export function GateWait() {
  const location = useLocation();
  return location.pathname === LAUNCHER_PATH ? (
    <div className="launcher relative min-h-screen overflow-hidden">
      <StageBackdrop />
    </div>
  ) : null;
}

export function FirstRunGate() {
  const { apps, preparing } = useWorkspaceState();
  const shifts = apps?.includes('shifts') ?? false;
  const profile = useBusinessProfile(shifts);
  const status = useInterviewStatus(shifts);
  const location = useLocation();

  if (!shifts || location.pathname === WELCOME_PATH) return <Outlet />;
  if (preparing && location.pathname === LAUNCHER_PATH) return <Outlet />;
  if (appFor(location.pathname) !== 'shifts') return <Outlet />;
  if (profile.isPending || status.isPending) return <GateWait />;

  const owed = profile.data?.first_run_pending === true;
  const offered = status.data?.available === true;
  if (owed && offered) return <Navigate to={WELCOME_PATH} replace />;

  return <Outlet />;
}
