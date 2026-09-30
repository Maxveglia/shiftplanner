import { useContext } from 'react';
import type { AppKey } from '../lib/apps';
import { WorkspaceContext, type WorkspaceState } from './WorkspaceContext';

/**
 * The whole reading, including "not known yet" and whether the workspace is
 * still being set up -- for the router, the gate and the launcher.
 */
export function useWorkspaceState(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspaceState must be used within a <WorkspaceProvider>');
  }
  return ctx;
}

/**
 * The apps this business has on, in the order of APPS. Behind WorkspaceGate
 * the list is always known; anywhere else, not known reads as none.
 */
export function useWorkspaceApps(): AppKey[] {
  return useWorkspaceState().apps ?? NONE;
}

// One empty list, so a caller's memo does not see a new one every render.
const NONE: AppKey[] = [];
