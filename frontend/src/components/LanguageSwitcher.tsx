// The language control for every shell that cannot reach the settings screen:
// the employee's single screen, the back office, the welcome questions, and
// the sign-in and sign-up pages -- where there is no session yet and the
// browser's own language is the only thing that has spoken.
//
// A select rather than the settings screen's cards because it lives in a
// header, next to a name and a log-out button, and must not compete with them.

import { LANGUAGES, useLanguage, useT, isLanguage } from '../lib/i18n';

export function LanguageSwitcher({
  tone = 'light',
}: {
  /**
   * `glass` for the sign-in's empty stage, the faintest. Everywhere else the
   * app's own glass, with an edge that holds 3:1 (there used to be a white
   * header's tone and the back office's slate one; every shell is on the dark
   * stage now).
   */
  tone?: 'light' | 'glass';
}) {
  const { language, setLanguage } = useLanguage();
  const t = useT();

  // The open list is painted in the surface's colours: some systems draw it
  // with the options' own, and they would otherwise be the page's.
  const styles =
    tone === 'glass'
      ? 'border-white/15 bg-white/5 text-white/80 hover:border-white/25 hover:bg-white/10 focus:border-brand-400'
      : 'border-gray-400 bg-white/[0.04] text-gray-700 hover:border-gray-500 hover:bg-white/[0.07] focus:border-brand-400';

  return (
    <select
      aria-label={t('settings.switcher.label')}
      value={language}
      onChange={(e) => {
        if (isLanguage(e.target.value)) setLanguage(e.target.value);
      }}
      className={`m-field shrink-0 rounded-lg border px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-400/30 [&>option]:bg-surface [&>option]:text-gray-900 ${styles}`}
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
