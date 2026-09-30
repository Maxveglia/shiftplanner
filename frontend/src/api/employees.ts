import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type {
  EmployeeCreate,
  EmployeeOut,
  EmployeeUpdate,
} from '../types';

export function useEmployees() {
  return useQuery({
    queryKey: queryKeys.employees,
    queryFn: async () => {
      const { data } = await api.get<EmployeeOut[]>('/employees');
      return data;
    },
  });
}

export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.employee(id) : ['employees', 'undefined'],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await api.get<EmployeeOut>(`/employees/${id}`);
      return data;
    },
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeCreate) => {
      const { data } = await api.post<EmployeeOut>('/employees', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.employees });
    },
  });
}

export function useUpdateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeUpdate) => {
      const { data } = await api.patch<EmployeeOut>(`/employees/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.employees });
      qc.invalidateQueries({ queryKey: queryKeys.employee(id) });
    },
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/employees/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.employees });
    },
  });
}

/**
 * Put back somebody who was just removed.
 *
 * The server marks the row rather than destroying it, which is what makes this
 * endpoint possible at all — and it is idempotent there, so a click that races
 * the notice disappearing cannot fail in the manager's face.
 *
 * Both keys are invalidated because the roster is not the only thing that
 * changes: the person's own file is reachable again, and every OTHER employee's
 * display number has just shifted back down by one.
 */
export function useRestoreEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<EmployeeOut>(`/employees/${id}/restore`);
      return data;
    },
    onSuccess: (employee) => {
      qc.invalidateQueries({ queryKey: queryKeys.employees });
      qc.invalidateQueries({ queryKey: queryKeys.employee(employee.id) });
    },
  });
}

/**
 * Change one person's weekly hours on their open contract, in place.
 *
 * The manual lever beside the calendar's: a brief can say "four on 40 and
 * two on 20", and this is how one of them becomes 30 without a new contract
 * being drawn up. The whole roster is refetched because the calendar reads
 * hours from it.
 */
export function useSetBaseHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, hours }: { employeeId: string; hours: number }) => {
      const { data } = await api.patch(`/employees/${employeeId}/contracts/current/hours`, {
        hours_per_week: hours,
      });
      return data;
    },
    onSuccess: (_data, { employeeId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.employees });
      qc.invalidateQueries({ queryKey: queryKeys.employee(employeeId) });
    },
  });
}
