import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { LaborProfileOut } from '../types';

export function useLaborProfiles() {
  return useQuery({
    queryKey: queryKeys.laborProfiles,
    queryFn: async () => {
      const { data } = await api.get<LaborProfileOut[]>('/labor-profiles');
      return data;
    },
  });
}
