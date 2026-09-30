// The organisation itself, as opposed to what is inside it.
//
// One call today, and it is the irreversible one: ending the account. The pay
// policy lives in ./payPolicy, which is the same endpoint prefix and a very
// different kind of act.

import { api } from '../lib/api';

/**
 * Delete this workspace and everything in it. There is no undo.
 *
 * `confirm` is the workspace's own name, which the server checks again: the
 * dialog's own check stops the accident, and the server's stops everything
 * that never went through the dialog.
 */
export async function deleteOrganization(confirm: string): Promise<void> {
  await api.delete('/org', { data: { confirm } });
}
