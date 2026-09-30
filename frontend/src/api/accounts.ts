import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { EmployeeAccountCreate, EmployeeAccountOut } from '../types';

/**
 * Whether this employee can log in. A 404 is the normal "not yet" answer, so
 * it resolves to null instead of surfacing as an error state.
 */
export function useEmployeeAccount(employeeId: string | undefined) {
  return useQuery({
    queryKey: employeeId
      ? queryKeys.employeeAccount(employeeId)
      : ['employees', 'undefined', 'account'],
    enabled: Boolean(employeeId),
    retry: false,
    queryFn: async (): Promise<EmployeeAccountOut | null> => {
      try {
        const { data } = await api.get<EmployeeAccountOut>(
          `/employees/${employeeId}/account`,
        );
        return data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
}

export function useCreateEmployeeAccount(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeAccountCreate) => {
      const { data } = await api.post<EmployeeAccountOut>(
        `/employees/${employeeId}/account`,
        payload,
      );
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.employeeAccount(employeeId), data);
      // The login email is written back onto the roster record.
      qc.invalidateQueries({ queryKey: queryKeys.employee(employeeId) });
      // And the access window lists who can sign in.
      qc.invalidateQueries({ queryKey: queryKeys.access });
    },
  });
}

export function useDeleteEmployeeAccount(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete(`/employees/${employeeId}/account`);
    },
    onSuccess: () => {
      qc.setQueryData(queryKeys.employeeAccount(employeeId), null);
      qc.invalidateQueries({ queryKey: queryKeys.access });
    },
  });
}
