import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { businessProfileQuery } from '../../api/profile';
import { interviewStatusQuery } from '../../api/interview';
import { workspaceQuery } from '../../api/workspace';
import { hasApp } from '../../lib/apps';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';

/** How long a successful sign-in takes to leave: the longest of the
 *  `[data-leaving='auth']` transitions in styles/motion-auth.css. */
export const AUTH_LEAVE_MS = 420;

export interface AuthFlow {
  /** A session was already there when the page opened -- not one this page
   *  just made, whose exit must be allowed to finish. */
  alreadyIn: boolean;
  /** Carrying the page away after it worked. */
  leaving: boolean;
  /** One more per refusal: the card shakes once per. */
  refusals: number;
  /** The last refusal, kept on screen while the next try is on its way, so
   *  the form does not close up under the pointer and open again. */
  lastError: unknown;
  /** Call as the form is sent. */
  sent: () => void;
  /** Call when the server says no. */
  refused: (error: unknown) => void;
  /** Call when it worked: leave, then go to `to`, with `state` as the
   *  router's. `warmGate` fetches what the gates wait for during the exit
   *  (managers only -- an employee's screen has no first run, and the profile
   *  is not theirs to read); `apps` is the list the sign-in returned, which
   *  says whether there is a first run to warm at all. */
  leaveTo: (
    to: string,
    opts?: { warmGate?: boolean; apps?: readonly string[]; state?: unknown },
  ) => void;
}

/**
 * The sign-in and sign-up forms' side of getting in: what to show while
 * trying, and how to leave once in.
 *
 * Leaving takes AUTH_LEAVE_MS: the words lift away and the card sinks on the
 * dark stage, then the launcher rises on the same stage. The gate in front of
 * the launcher waits for the business profile and the interview status, and
 * while it waits it would show the page's light grey between two dark
 * screens -- so both are fetched during the exit, which is time spent anyway.
 * Only for a business with the shifts app, whose first run it is: without the
 * app the gate waits for neither, and the server would refuse both. The
 * workspace is asked for too, to check the list the sign-in carried; the
 * launcher does not wait for that answer, it opens on the sign-in's list.
 */
export function useAuthFlow(isAuthenticated: boolean): AuthFlow {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const [attempted, setAttempted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const [lastError, setLastError] = useState<unknown>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    alreadyIn: isAuthenticated && !attempted,
    leaving,
    refusals,
    lastError,
    sent: () => setAttempted(true),
    refused: (error) => {
      setAttempted(false);
      setLastError(error);
      setRefusals((n) => n + 1);
    },
    leaveTo: (to, { warmGate = false, apps, state } = {}) => {
      if (warmGate) {
        void queryClient.prefetchQuery(workspaceQuery);
        if (hasApp(apps, 'shifts')) {
          void queryClient.prefetchQuery(businessProfileQuery);
          void queryClient.prefetchQuery(interviewStatusQuery);
        }
      }
      if (reduced) {
        navigate(to, { replace: true, state });
        return;
      }
      setLeaving(true);
      timer.current = window.setTimeout(() => navigate(to, { replace: true, state }), AUTH_LEAVE_MS);
    },
  };
}
