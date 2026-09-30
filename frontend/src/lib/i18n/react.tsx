// The React face of the dictionary.
//
// The language lives in a module (core.ts) rather than in this context, because
// non-React code needs it too. The context exists only so that changing it
// re-renders the tree: `useT` returns a fresh `t` identity per language, which
// is what makes every screen swap at once instead of on next navigation.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getLanguage,
  setLanguage as setLanguageGlobal,
  subscribe,
  translateIn,
  type Language,
  type Vars,
} from './core';

export type TFunction = (key: string, vars?: Vars) => string;

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TFunction;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getLanguage);

  // Anything that changes the language through the module API (or a second tab
  // of the same app) still moves this tree.
  useEffect(() => subscribe(setLanguageState), []);

  // A screen reader chooses its voice from this, so a Spanish interface read
  // aloud with an English one is a real bug, not a detail.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageGlobal(lang);
    setLanguageState(lang);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, vars) => translateIn(language, key, vars),
    }),
    [language, setLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

function useLanguageContext(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used inside <LanguageProvider>');
  }
  return ctx;
}

/** The current language and the way to change it. For the settings screen. */
export function useLanguage() {
  const { language, setLanguage } = useLanguageContext();
  return { language, setLanguage };
}

/** `const t = useT()` then `t('dashboard.title')`. The workhorse. */
export function useT(): TFunction {
  return useLanguageContext().t;
}
