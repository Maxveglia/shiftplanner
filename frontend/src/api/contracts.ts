import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { ContractCreate, ContractOut } from '../types';

export function useEmployeeContracts(employeeId: string | undefined) {
  return useQuery({
    queryKey: employeeId
      ? queryKeys.employeeContracts(employeeId)
      : ['employees', 'undefined', 'contracts'],
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const { data } = await api.get<ContractOut[]>(
        `/employees/${employeeId}/contracts`,
      );
      return data;
    },
  });
}

export function useCreateContract(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ContractCreate) => {
      const { data } = await api.post<ContractOut>(
        `/employees/${employeeId}/contracts`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.employeeContracts(employeeId) });
      qc.invalidateQueries({ queryKey: queryKeys.employee(employeeId) });
      qc.invalidateQueries({ queryKey: queryKeys.employees });
    },
  });
}
