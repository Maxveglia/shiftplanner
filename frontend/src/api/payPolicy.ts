import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PAY_POLICY } from '../lib/schedule/payroll';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { PayPolicyOut } from '../types';
import type { PayPolicy } from '../lib/schedule/payroll';

/** Server shape -> the shape the payroll module works in. */
export function toPayPolicy(policy: PayPolicyOut): PayPolicy {
  return {
    nightDifferentialPct: Number(policy.night_differential_pct),
    weekendPremiumPct: Number(policy.weekend_premium_pct),
    overtimeMultiplier: Number(policy.overtime_multiplier),
  };
}

/**
 * The org's pay policy. Read by both roles: the manager prices the roster with
 * it and the employee estimates their own pay with it, so it has to be one
 * stored fact rather than a setting in whoever's browser.
 */
export function usePayPolicy() {
  return useQuery({
    queryKey: queryKeys.payPolicy,
    queryFn: async () => {
      const { data } = await api.get<PayPolicyOut>('/org/pay-policy');
      return data;
    },
  });
}

export function useUpdatePayPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (policy: PayPolicy) => {
      const { data } = await api.put<PayPolicyOut>('/org/pay-policy', {
        night_differential_pct: policy.nightDifferentialPct,
        weekend_premium_pct: policy.weekendPremiumPct,
        overtime_multiplier: policy.overtimeMultiplier,
      });
      return data;
    },
    onSuccess: (data) => qc.setQueryData(queryKeys.payPolicy, data),
  });
}

/**
 * The pay policy as something a screen can edit.
 *
 * Edits are held locally for responsiveness and saved once the manager stops
 * typing. Two screens edit it (Settings owns the form; the dashboard prices
 * the roster with it), so the debounce lives here rather than in either.
 *
 * IT HANDS BACK THE FAILURE TOO. Typing into a debounced field and getting no
 * answer is indistinguishable from typing into one that saved -- the number
 * stays on screen either way. That is how a whole market went a fortnight
 * unable to change its night premium and never saw a single error: the server
 * refused every save (`PayPolicyUpdate`), the mutation's error went nowhere,
 * and the field kept showing what had been typed. A screen that cannot fail
 * out loud is a screen that lies quietly.
 */
export function usePayPolicyEditor(): [
  PayPolicy,
  (next: PayPolicy) => void,
  unknown,
] {
  const query = usePayPolicy();
  const update = useUpdatePayPolicy();
  // From the cache when it is already there -- coming back to the dashboard
  // it always is -- so the first paint shows the business's own policy and
  // not the default, and the effect below has nothing left to correct: that
  // correction was a second render of the whole dashboard as it mounted.
  const [policy, setLocal] = useState<PayPolicy>(() =>
    query.data ? toPayPolicy(query.data) : DEFAULT_PAY_POLICY,
  );
  const applied = useRef(query.data);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (query.data && query.data !== applied.current) {
      applied.current = query.data;
      setLocal(toPayPolicy(query.data));
    }
  }, [query.data]);

  const setPolicy = useCallback(
    (next: PayPolicy) => {
      setLocal(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => update.mutate(next), 600);
    },
    [update],
  );

  return [policy, setPolicy, update.isError ? update.error : null];
}
