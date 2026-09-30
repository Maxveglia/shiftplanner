import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { ShiftTemplateCreate, ShiftTemplateOut } from '../types';

export function useShiftTemplates() {
  return useQuery({
    queryKey: queryKeys.shiftTemplates,
    queryFn: async () => {
      const { data } = await api.get<ShiftTemplateOut[]>('/shift-templates');
      return data;
    },
  });
}

export function useCreateShiftTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ShiftTemplateCreate) => {
      const { data } = await api.post<ShiftTemplateOut>(
        '/shift-templates',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.shiftTemplates });
    },
  });
}
