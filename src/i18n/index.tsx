import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '@/api/contract';
import { en, type MessageKey } from './en';
import { hi } from './hi';
import { pa } from './pa';

export type { MessageKey, Lang };

const DICTS: Record<Lang, Partial<Record<MessageKey, string>>> = { en, hi, pa };
const STORAGE_KEY = 'vs.lang';

export const LANGUAGES: { id: Lang; label: string; name: string; bcp47: string }[] = [
  { id: 'pa', label: 'ਪੰਜਾਬੀ', name: 'Punjabi', bcp47: 'pa-IN' },
  { id: 'hi', label: 'हिंदी', name: 'Hindi', bcp47: 'hi-IN' },
  { id: 'en', label: 'English', name: 'English', bcp47: 'en-IN' },
];

/** Punjabi for Punjab-region locales, Hindi for Hindi locales, otherwise English. */
export function detectLang(locales: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]): Lang {
  for (const l of locales) {
    const tag = l.toLowerCase();
    if (tag.startsWith('pa')) return 'pa';
    if (tag.startsWith('hi')) return 'hi';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = DICTS[lang][key] ?? en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : raw;
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** true once the visitor picked a language explicitly (so locale detection stops overriding it) */
  chosen: boolean;
}

const Ctx = createContext<I18nValue>({ lang: 'en', setLang: () => {}, t: (k, v) => translate('en', k, v), chosen: false });

function readStored(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'hi' || v === 'pa' ? v : null;
  } catch {
    return null;
  }
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [stored] = useState(readStored);
  // The farmer screen opens in the language the browser locale suggests (Punjabi for pa-*, Hindi for hi-*).
  // Everywhere else we default to English unless the visitor has chosen a language before.
  const [lang, setLangState] = useState<Lang>(() => initial ?? stored ?? (typeof location !== 'undefined' && location.pathname.startsWith('/farmer') ? detectLang() : 'en'));
  const [chosen, setChosen] = useState(!!stored);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setChosen(true);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* storage may be blocked */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = LANGUAGES.find((x) => x.id === lang)?.bcp47 ?? 'en';
  }, [lang]);

  const value = useMemo<I18nValue>(() => ({ lang, setLang, chosen, t: (k, v) => translate(lang, k, v) }), [lang, setLang, chosen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(Ctx);
}
