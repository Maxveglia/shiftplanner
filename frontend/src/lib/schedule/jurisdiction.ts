// Which labour rules apply, and what they mean for pay.
//
// Rules live as DATA (labor_profile / compliance_rule), so this module only
// reads them. Nothing here hardcodes a threshold — change the seed and the app
// follows.

import type { LaborProfileOut } from '../../types';
import type { SchedulingSpec } from './types';

/** Profiles that apply to a jurisdiction, most specific first (AZ then FED). */
export function applicableProfiles(
  profiles: LaborProfileOut[],
  code: string,
): LaborProfileOut[] {
  const chain: LaborProfileOut[] = [];
  let current = profiles.find((p) => p.jurisdiction_code === code);
  const guard = new Set<string>();
  while (current && !guard.has(current.jurisdiction_code)) {
    guard.add(current.jurisdiction_code);
    chain.push(current);
    current = current.parent_code
      ? profiles.find((p) => p.jurisdiction_code === current!.parent_code)
      : undefined;
  }
  return chain;
}

/** The wage floor for a jurisdiction, or null when none is recorded. */
export function minimumWage(
  profiles: LaborProfileOut[],
  code: string,
): number | null {
  for (const p of applicableProfiles(profiles, code)) {
    const rule = p.rules.find((r) => r.rule_type === 'minimum_wage');
    if (rule?.threshold != null) return Number(rule.threshold);
  }
  return null;
}

/**
 * The agreement's night premium, in percent, or null when none is stated.
 *
 * The statute requires a night premium and sets no figure (art. 36.2 ET), so
 * this is only ever a collective agreement's number -- and where there is
 * none, a person paid no night premium is not under anything we can name.
 */
export function nightPremiumFloor(
  profiles: LaborProfileOut[],
  code: string,
): number | null {
  return threshold(profiles, code, 'night_premium');
}

/** The threshold of the most specific rule of this type, or null. */
function threshold(
  profiles: LaborProfileOut[],
  code: string,
  ruleType: string,
): number | null {
  for (const p of applicableProfiles(profiles, code)) {
    const rule = p.rules.find((r) => r.rule_type === ruleType);
    if (rule?.threshold != null) return Number(rule.threshold);
  }
  return null;
}

/** Whether any profile in the chain states this rule at all. */
function states(
  profiles: LaborProfileOut[],
  code: string,
  ruleType: string,
): boolean {
  return applicableProfiles(profiles, code).some((p) =>
    p.rules.some((r) => r.rule_type === ruleType),
  );
}

/**
 * The spec with the law of this jurisdiction in it.
 *
 * WHY THIS EXISTS, AND WHY ON THE CLIENT. The server writes these figures into
 * a spec when it interprets a brief. That covers a calendar built today and
 * misses two cases that matter more than it does: a draft built BEFORE the
 * rules existed, which is sitting in every manager's browser and is what
 * "reorganise" sends back; and a spec the local parser produced, which never
 * went past the server at all. A rota is judged and rebuilt from whatever spec
 * is on screen, so a spec without the law in it is a rota without the law in
 * it -- and the manager who just chose their jurisdiction sees nothing change.
 *
 * WHAT IT WILL NOT DO is overrule the manager. A figure the BRIEF stated is
 * left exactly as it is, and the validator is what says it breaks the statute:
 * the product's job is to show them the rule, not to rewrite their sentence.
 * The mark of a stated figure is `rules`: the intake tags each with an origin,
 * and only `parsed` means a person said it.
 */
export function withLabourFloor(
  spec: SchedulingSpec,
  profiles: LaborProfileOut[],
  code: string,
): SchedulingSpec {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (profiles.length === 0) return spec;

  const saidByHand = (kind: string): boolean =>
    spec.rules.some((r) => r.kind === kind && r.origin === 'parsed');

  const restFloor = threshold(profiles, code, 'daily_rest_between_shifts');
  const nightStart = threshold(profiles, code, 'night_work_window_start');
  const nightEnd = threshold(profiles, code, 'night_work_window_end');

  return {
    ...spec,
    // The one field that already existed, so the only one that can disagree
    // with a manager: raised to the floor only when nobody typed it.
    minRestHours:
      restFloor != null && !saidByHand('min_rest')
        ? Math.max(spec.minRestHours, restFloor)
        : spec.minRestHours,
    maxDailyHours:
      spec.maxDailyHours ?? threshold(profiles, code, 'max_daily_ordinary_hours'),
    weeklyRestHours:
      spec.weeklyRestHours ?? threshold(profiles, code, 'weekly_rest_hours'),
    nightAverageMax:
      spec.nightAverageMax ??
      threshold(profiles, code, 'night_work_daily_average_max'),
    nightWindow:
      spec.nightWindow ??
      (nightStart != null && nightEnd != null
        ? { startHour: nightStart, endHour: nightEnd }
        : null),
    annualOvertimeCap:
      spec.annualOvertimeCap ?? threshold(profiles, code, 'annual_overtime_cap'),
    weeklyAverageHours:
      spec.weeklyAverageHours ??
      threshold(profiles, code, 'weekly_ordinary_hours_average'),
    annualHours:
      spec.annualHours ?? threshold(profiles, code, 'annual_ordinary_hours'),
    irregularPct:
      spec.irregularPct ?? threshold(profiles, code, 'irregular_distribution_pct'),
    irregularNoticeDays:
      spec.irregularNoticeDays ??
      threshold(profiles, code, 'irregular_distribution_notice_days'),
    // Null is an ANSWER here -- "this country sets no overtime premium" -- so
    // `??` would be wrong: it cannot tell that from "nobody has said". The
    // rule's presence is what decides.
    overtimeMultiplier:
      spec.overtimeMultiplier !== undefined
        ? spec.overtimeMultiplier
        : states(profiles, code, 'no_statutory_overtime_premium')
          ? null
          : threshold(profiles, code, 'weekly_overtime_threshold') != null
            ? overtimeMultiplierOf(profiles, code)
            : undefined,
  };
}

/** The premium multiplier on the overtime rule, if it carries one. */
function overtimeMultiplierOf(
  profiles: LaborProfileOut[],
  code: string,
): number | undefined {
  for (const p of applicableProfiles(profiles, code)) {
    const rule = p.rules.find((r) => r.rule_type === 'weekly_overtime_threshold');
    if (rule?.premium_multiplier != null) return Number(rule.premium_multiplier);
  }
  return undefined;
}
