// Holds every screen of the customer app -- manager's and employee's alike --
// until it is known which apps this business has: the routes below it are
// mounted from that list (App.tsx), and a screen built before it was known
// would be built for the wrong business.
//
// Almost never waits. The list comes with the user at sign-in and is kept with
// the saved session (WorkspaceContext), so after a sign-in or a reload it is
// already here on the first render and this is a plain <Outlet />. Only a
// session saved before the server sent the list waits, once, for
// `GET /workspace` -- and it waits the way FirstRunGate waits, on the same
// stage, so it looks like the wait that was already there.
//
// So does a session saved before the server sent what each account may do
// (`permissions`), of anybody but a manager: built for "may do nothing", an
// employee's link to /inventory would be sent to `/` before the answer came
// to say they may open it (lib/access.ts, permissionsPending).
//
// If that request fails with nothing to go on, it says so and offers to try
// again. It never falls back to "no apps": a dropped connection would show a
// business that has everything the screen of a business that has nothing.

import { Outlet } from 'react-router-dom';
import { Button } from '../components/Button';
import { StateMessage } from '../components/StateMessage';
import { StageBackdrop } from '../components/motion/Stage';
import { getErrorMessage } from '../lib/api';
import { useT } from '../lib/i18n';
import { GateWait } from './FirstRunGate';
import { useWorkspaceState } from './useWorkspaceApps';

export function WorkspaceGate() {
  const t = useT();
  const { apps, permissionsPending, failed, error, retry, retrying } = useWorkspaceState();

  if (apps && !permissionsPending) return <Outlet />;
  if (!failed) return <GateWait />;

  return (
    <div className="launcher relative min-h-screen overflow-hidden text-white">
      <StageBackdrop />
      <main className="relative z-[1] mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4">
        <div className="w-full">
          <StateMessage
            tone="error"
            title={t('workspace.loadError')}
            description={getErrorMessage(error)}
          />
        </div>
        <Button variant="secondary" onClick={retry} disabled={retrying}>
          {t('workspace.retry')}
        </Button>
      </main>
    </div>
  );
}
