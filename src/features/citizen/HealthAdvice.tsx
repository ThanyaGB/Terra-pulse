import type { AdviceResponse, HealthProfile } from '@/api/contract';
import { IconAlert, IconCheck } from '@/design/Icons';
import { useI18n, type MessageKey } from '@/i18n';

export const PROFILES: { id: HealthProfile; label: MessageKey }[] = [
  { id: 'asthma', label: 'cz.profile.asthma' },
  { id: 'child', label: 'cz.profile.child' },
  { id: 'elderly', label: 'cz.profile.elderly' },
  { id: 'outdoor', label: 'cz.profile.outdoor' },
  { id: 'general', label: 'cz.profile.general' },
];

const PERIOD_LABEL: Record<AdviceResponse['period'], MessageKey> = {
  early_morning: 'cz.period.early_morning',
  morning: 'cz.period.midday',
  midday: 'cz.period.midday',
  afternoon: 'cz.period.afternoon',
  evening: 'cz.period.evening',
  night: 'cz.period.night',
};

const LEVEL: Record<'avoid' | 'caution' | 'ok', { key: MessageKey; bg: string; fg: string }> = {
  avoid: { key: 'cz.level.avoid', bg: '#FDE8E8', fg: '#8A1C1C' },
  caution: { key: 'cz.level.caution', bg: '#FFF3C4', fg: '#6B4E00' },
  ok: { key: 'cz.level.ok', bg: '#E3F8EE', fg: '#0B5C3E' },
};

export function ProfilePicker({ value, onChange }: { value: HealthProfile; onChange: (p: HealthProfile) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 font-display text-base font-bold">{t('cz.profile')}</legend>
      <div className="flex flex-wrap gap-2">
        {PROFILES.map((p) => {
          const on = p.id === value;
          return (
            <label key={p.id} className="relative">
              <input type="radio" name="profile" value={p.id} checked={on} onChange={() => onChange(p.id)} className="peer sr-only" />
              <span className="inline-flex min-h-12 cursor-pointer items-center rounded-full border-2 px-4 text-sm font-semibold peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-air-600"
                style={{ background: on ? '#0B7A53' : '#fff', color: on ? '#fff' : '#0B1D33', borderColor: on ? '#0B7A53' : 'rgb(11 29 51 / 0.2)' }}>
                {t(p.label)}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AdviceList({ advice, stale }: { advice: AdviceResponse; stale: boolean }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="advice-h" className="mt-4" data-testid="advice">
      <div className="mb-2 flex items-center justify-between">
        <h3 id="advice-h" className="h">{t('cz.advice')}</h3>
        <span className="chip bg-air-100 text-ink" data-testid="period">{t(PERIOD_LABEL[advice.period])}</span>
      </div>
      {stale && <p className="m-0 mb-2 text-xs text-ink-mute">{t('cz.offlineAdvice')}</p>}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {advice.items.map((it) => {
          const l = LEVEL[it.level];
          return (
            <li key={it.id} className="flex gap-3 rounded-2xl bg-white p-4 shadow-sm">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: l.bg, color: l.fg }}>{it.level === 'ok' ? <IconCheck size={18} /> : <IconAlert size={18} />}</span>
              <div>
                <div className="flex flex-wrap items-center gap-2"><b>{it.title}</b><span className="chip !py-0.5" style={{ background: l.bg, color: l.fg }}>{t(l.key)}</span></div>
                <p className="m-0 text-sm text-ink-soft">{it.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
