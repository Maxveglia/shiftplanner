import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../lib/adminApi';
import { queryKeys } from './keys';
import { useAdminAuth } from '../backoffice/useAdminAuth';
import type {
  Customer,
  CustomerDetail,
  CustomerList,
  PlatformAuthResponse,
  PlatformLoginPayload,
  PlatformMetrics,
  SubscriptionUpdate,
  CustomerDeleted,
} from '../types';

export function usePlatformLogin() {
  const { setSession } = useAdminAuth();
  return useMutation({
    mutationFn: async (payload: PlatformLoginPayload) => {
      const { data } = await adminApi.post<PlatformAuthResponse>(
        '/backoffice/login',
        payload,
      );
      return data;
    },
    onSuccess: (data) => setSession(data),
  });
}

export function usePlatformMetrics() {
  return useQuery({
    queryKey: queryKeys.platformMetrics,
    queryFn: async () => {
      const { data } = await adminApi.get<PlatformMetrics>('/backoffice/metrics');
      return data;
    },
  });
}

export interface CustomerQuery {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export function useCustomers(params: CustomerQuery) {
  const { status, q, limit = 25, offset = 0 } = params;
  return useQuery({
    queryKey: queryKeys.platformCustomers({ status, q, offset }),
    queryFn: async () => {
      const { data } = await adminApi.get<CustomerList>('/backoffice/customers', {
        params: {
          status: status || undefined,
          q: q?.trim() || undefined,
          limit,
          offset,
        },
      });
      return data;
    },
    // Keeps the table on screen while a new page or search lands, instead of
    // flashing the empty state on every keystroke.
    placeholderData: (previous) => previous,
  });
}

export function useCustomer(orgId: string) {
  return useQuery({
    queryKey: queryKeys.platformCustomer(orgId),
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data } = await adminApi.get<CustomerDetail>(
        `/backoffice/customers/${orgId}`,
      );
      return data;
    },
  });
}

/**
 * Remove a customer and everything that belonged to them.
 *
 * The company name is sent back as confirmation and checked on the server, so
 * a mis-click cannot erase a tenant even if the UI guard is bypassed.
 */
export function useDeleteCustomer(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (confirmName: string) => {
      const { data } = await adminApi.delete<CustomerDeleted>(
        `/backoffice/customers/${orgId}`,
        { data: { confirm_name: confirmName } },
      );
      return data;
    },
    onSuccess: () => {
      // One fewer account: every count on the overview and the list moves.
      queryClient.removeQueries({ queryKey: queryKeys.platformCustomer(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.platformMetrics });
      queryClient.invalidateQueries({ queryKey: ['backoffice', 'customers'] });
    },
  });
}

export function useUpdateSubscription(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SubscriptionUpdate) => {
      const { data } = await adminApi.patch<Customer>(
        `/backoffice/customers/${orgId}/subscription`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      // A plan change moves the headline count, so the overview is stale too.
      queryClient.invalidateQueries({
        queryKey: queryKeys.platformCustomer(orgId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.platformMetrics });
      queryClient.invalidateQueries({ queryKey: ['backoffice', 'customers'] });
    },
  });
}
