import { LANGUAGES, useI18n } from '@/i18n';

export function LangSwitch({ large = false, inverse = false }: { large?: boolean; inverse?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t('lang.label')} className="flex gap-1 rounded-full p-1" style={{ background: inverse ? 'rgb(255 255 255 / 0.14)' : 'rgb(11 29 51 / 0.07)' }}>
      {LANGUAGES.map((l) => {
        const on = l.id === lang;
        return (
          <button
            key={l.id}
            type="button"
            lang={l.bcp47}
            aria-pressed={on}
            onClick={() => setLang(l.id)}
            className={`rounded-full font-semibold ${large ? 'min-h-12 px-4 text-base' : 'min-h-11 px-3 text-sm'}`}
            style={{ background: on ? '#fff' : 'transparent', color: on ? '#0B1D33' : inverse ? '#E6F1FB' : '#3B526B' }}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
