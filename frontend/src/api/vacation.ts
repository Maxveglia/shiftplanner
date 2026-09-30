import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { VacationBalanceOut } from '../types';

export function useVacationBalance(employeeId: string | undefined) {
  return useQuery({
    queryKey: employeeId
      ? queryKeys.vacationBalance(employeeId)
      : ['employees', 'undefined', 'vacation-balance'],
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const { data } = await api.get<VacationBalanceOut>(
        `/employees/${employeeId}/vacation-balance`,
      );
      return data;
    },
  });
}
