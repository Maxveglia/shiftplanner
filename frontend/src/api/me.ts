import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { EmployeeOut } from '../types';

/**
 * The signed-in employee's own record, contract included.
 *
 * Deliberately id-free: the server reads the employee from the token, so this
 * is the one profile call that cannot be pointed at somebody else.
 */
export function useMyProfile(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myProfile,
    enabled,
    queryFn: async () => {
      const { data } = await api.get<EmployeeOut>('/me/profile');
      return data;
    },
  });
}

/** Whether the rota email is on for the signed-in person. */
export interface MyNotifications {
  notify_by_email: boolean;
}

/**
 * The one setting an employee has, read from the token like everything here.
 *
 * It is asked for separately from the profile rather than added to it because
 * it is the only thing on this screen the employee can CHANGE: a write that
 * answers with the new value can seed this cache directly, and it has no
 * business invalidating a record the person cannot edit.
 */
export function useMyNotifications(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myNotifications,
    enabled,
    queryFn: async () => {
      const { data } = await api.get<MyNotifications>('/me/notifications');
      return data;
    },
  });
}

/**
 * Turn the rota email on or off, for oneself.
 *
 * The server's answer is written straight into the cache instead of asking
 * again: this switch is read on a phone, often on a bad connection, and a
 * second round trip is a second chance for it to flick back under the thumb
 * that just moved it.
 */
export function useSetMyNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notifyByEmail: boolean) => {
      const { data } = await api.patch<MyNotifications>('/me/notifications', {
        notify_by_email: notifyByEmail,
      });
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.myNotifications, data);
    },
  });
}
