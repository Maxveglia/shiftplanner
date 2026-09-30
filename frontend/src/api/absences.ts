import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type {
  AbsenceApprovedOut,
  AbsenceCreate,
  AbsenceOut,
  AbsenceTypeOut,
} from '../types';

export function useAbsenceTypes() {
  return useQuery({
    queryKey: queryKeys.absenceTypes,
    queryFn: async () => {
      const { data } = await api.get<AbsenceTypeOut[]>('/absence-types');
      return data;
    },
  });
}

/**
 * Say whether a kind of leave is worked back later.
 *
 * Whether a day off is given or lent is something the business agreed with the
 * person; nothing in the data can infer it. Once set, the working year stops
 * counting those hours as overtime when they come back (art. 34 ET).
 */
export function useSetAbsenceTypeRecoverable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; isRecoverable: boolean }) => {
      const { data } = await api.put<AbsenceTypeOut>(
        `/absence-types/${vars.id}`,
        { is_recoverable: vars.isRecoverable },
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.absenceTypes });
      // The working year is computed from these; a day off that just became
      // recoverable changes what counts as overtime.
      void qc.invalidateQueries({ queryKey: ['workday'] });
    },
  });
}

export function useAbsences() {
  return useQuery({
    queryKey: queryKeys.absences,
    queryFn: async () => {
      const { data } = await api.get<AbsenceOut[]>('/absences');
      return data;
    },
  });
}

export function useCreateAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AbsenceCreate) => {
      const { data } = await api.post<AbsenceOut>('/absences', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.absences });
    },
  });
}

export function useApproveAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<AbsenceApprovedOut>(
        `/absences/${id}/approve`,
      );
      return data;
    },
    onSuccess: (absence) => {
      qc.invalidateQueries({ queryKey: queryKeys.absences });
      // Approving may consume vacation balance -> refresh that employee.
      qc.invalidateQueries({
        queryKey: queryKeys.vacationBalance(absence.employee_id),
      });
      // AND THE ROTA, which approving has just changed. The shifts this
      // person was on for those days are gone from the server; a cached
      // calendar would go on showing the team a shift nobody is working, and
      // the draft on the dashboard would hand the conflict back at publish
      // time. The hours moved too, so the working year goes with them.
      qc.invalidateQueries({ queryKey: ['schedule', 'published'] });
      qc.invalidateQueries({ queryKey: ['schedule', 'draft'] });
      qc.invalidateQueries({ queryKey: ['workday'] });
    },
  });
}
