// Where the manager decides how the product speaks to them.
//
// One setting today -- the language -- but the page is built as a list of
// sections rather than a single control, because "settings" that is one radio
// group has to be rebuilt the moment a second preference exists.
//
// The language options are written in their own language ("Español", never
// "Spanish"): somebody who needs to switch is, by definition, reading a screen
// they do not understand, and the one word they can recognise is the name of
// their own language.

import { useCallback } from 'react';
import { Card } from '../components/Card';
import { DeleteAccountCard } from '../components/DeleteAccountCard';
import { RequirementsPanel } from '../components/schedule/RequirementsPanel';
import { StandingRules } from '../components/schedule/StandingRules';
import {
  forgetDeclaration,
  type AppliedHint,
  type Declaration,
  type ProfileSuggestion,
  type SpecGap,
} from '../api/schedule';
import { DEFAULT_SPEC } from '../lib/schedule/spec';
import type { SchedulingSpec } from '../lib/schedule/types';
import { PageHeader } from './DashboardLayout';
import { LANGUAGES, useLanguage, useT } from '../lib/i18n';
import { formatDate, formatHours, formatMoney } from '../lib/format';
import { useAuth } from '../auth/useAuth';
import { usePayPolicyEditor } from '../api/payPolicy';
import { useLaborProfiles } from '../api/laborProfiles';
import { useQueryClient } from '@tanstack/react-query';
import { useDraftState } from '../lib/schedule/draftStore';
import {
  useBusinessProfile,
  useUpdateBusinessProfile,
} from '../api/profile';
import { queryKeys } from '../api/keys';
import { minimumWage } from '../lib/schedule/jurisdiction';

export function SettingsPage() {
  const { language, setLanguage } = useLanguage();
  const t = useT();
  const { user } = useAuth();
  const qc = useQueryClient();

  /**
   * The business's labour rules. Stored on the SERVER, chosen here.
   *
   * This was draft state, and the picker wrote to it and to nothing else: a
   * manager who chose their jurisdiction changed one key in their own browser
   * while the organisation carried on under whatever it was created with, and
   * the calendar went on being planned to the old rules with nothing on
   * screen to explain it. Now the choice goes where it belongs -- `PUT
   * /profile`, which also carries the country's premiums onto the pay policy
   * -- and every screen reads it back from the profile.
   */
  const businessProfile = useBusinessProfile();
  const updateProfile = useUpdateBusinessProfile();
  const jurisdiction =
    businessProfile.data?.jurisdiction_code ??
    user?.org_jurisdiction ??
    'ES-CT-HOSTELERIA';
  const setJurisdiction = (code: string) => {
    updateProfile.mutate(
      { jurisdiction_code: code },
      {
        // The premiums move with the country on the server, so the copy this
        // page is editing has to be re-read rather than kept.
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: queryKeys.payPolicy });
        },
      },
    );
  };
  const [minWage, setMinWage] = useDraftState<number | null>('minWage', null);

  // What the calendar is following, read from the same draft keys the
  // dashboard writes. Read-only here on purpose, with two exceptions that are
  // facts about the BUSINESS rather than about the rota on screen: taking
  // back something you told us, and forgetting something we learned. The
  // number on an assumption is not offered, because changing it rebuilds a
  // calendar, and the calendar is on the other screen.
  const [spec] = useDraftState<SchedulingSpec>('spec', DEFAULT_SPEC);
  const [declared, setDeclared] = useDraftState<Declaration[]>('declared', []);
  const [profileGaps] = useDraftState<SpecGap[]>('profileGaps', []);
  const [profileApplied] = useDraftState<AppliedHint[]>('profileApplied', []);
  const [profileSuggestions] = useDraftState<ProfileSuggestion[]>(
    'profileSuggestions',
    [],
  );
  const handleForgetDeclaration = useCallback(
    (key: string) => {
      setDeclared((ds) => ds.filter((d) => d.key !== key));
      forgetDeclaration(key).catch(() => {});
    },
    [setDeclared],
  );
  const laborProfiles = useLaborProfiles();
  const [payPolicy, setPayPolicy, payPolicyError] = usePayPolicyEditor();

  // A real date and a real amount, formatted right now, so the effect of the
  // choice is visible before it is made rather than described in a sentence.
  const sampleDate = new Date();
  const sample = [
    {
      label: t('settings.language.sample.date'),
      value: formatDate(sampleDate.toISOString()),
    },
    { label: t('settings.language.sample.money'), value: formatMoney(1250.5) },
    { label: t('settings.language.sample.hours'), value: formatHours(37.5) },
  ];

  return (
    <div>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
      />

      <Card title={t('settings.scheduler.title')} className="mb-6 max-w-3xl">
        <p className="mb-4 text-sm text-gray-500">{t('settings.scheduler.help')}</p>
        <RequirementsPanel
          policy={payPolicy}
          onPolicyChange={setPayPolicy}
          policyError={payPolicyError}
          jurisdiction={jurisdiction}
          onJurisdictionChange={setJurisdiction}
          minimumWage={minWage ?? minimumWage(laborProfiles.data ?? [], jurisdiction)}
          onMinimumWageChange={setMinWage}
        />
      </Card>

      <StandingRules
        gaps={profileGaps}
        spec={spec}
        declared={declared}
        applied={profileApplied}
        suggestions={profileSuggestions}
        onForget={handleForgetDeclaration}
      />

      <div className="mb-6" />

      <Card title={t('settings.language.title')} className="max-w-2xl">
        <p className="text-sm text-gray-500">{t('settings.language.help')}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {LANGUAGES.map((lang) => {
            const active = lang.code === language;
            return (
              <button
                key={lang.code}
                type="button"
                aria-pressed={active}
                aria-label={t('settings.language.select', { language: lang.label })}
                onClick={() => setLanguage(lang.code)}
                className={[
                  'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none',
                  active
                    ? 'border-brand-400/60 bg-brand-400/[0.1] shadow-[0_10px_30px_-18px_rgb(68_214_180/0.7)]'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]',
                ].join(' ')}
              >
                <span>
                  <span className="block text-sm font-semibold text-gray-900">
                    {lang.label}
                  </span>
                  <span className="block text-xs uppercase tracking-wide text-gray-500">
                    {lang.code}
                  </span>
                </span>
                {active && (
                  <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-medium text-white shadow-[0_4px_14px_-6px_rgb(68_214_180/0.8)]">
                    {t('settings.language.current')}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-xl border border-white/[0.06] bg-black/[0.15] p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {t('settings.language.sample.title')}
          </p>
          <dl className="mt-2 grid grid-cols-3 gap-3">
            {sample.map((row) => (
              <div key={row.label}>
                <dt className="text-xs text-gray-500">{row.label}</dt>
                <dd className="text-sm font-medium text-gray-900">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-gray-700">
            {t('settings.language.scope.title')}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {t('settings.language.scope.body')}
          </p>
        </div>
      </Card>

      <DeleteAccountCard />
    </div>
  );
}
