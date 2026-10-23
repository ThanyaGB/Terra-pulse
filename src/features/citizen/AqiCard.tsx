import type { CitizenSnapshot } from '@/api/contract';
import { useI18n } from '@/i18n';
import { aqiGaugeFraction, describeAqi, formatAqi, formatPm25, getAqiBand } from '@/lib/aqi';
import { formatTime } from '@/lib/format';

const MIX_COLORS = ['#E8710A', '#1F6FBF', '#A8885C', '#6D3FC9'];

/** Half-circle gauge. The arc is decorative; the text next to it carries the value. */
function Gauge({ aqi, color }: { aqi: number; color: string }) {
  const R = 74;
  const len = Math.PI * R;
  return (
    <svg viewBox="0 0 180 100" className="w-full max-w-[220px]" aria-hidden="true">
      <path d={`M16 90 A${R} ${R} 0 0 1 164 90`} fill="none" stroke="#E3EEF5" strokeWidth="16" strokeLinecap="round" />
      <path d={`M16 90 A${R} ${R} 0 0 1 164 90`} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${len * aqiGaugeFraction(aqi)} ${len}`} style={{ transition: 'stroke-dasharray 800ms cubic-bezier(.22,1,.36,1)' }} />
    </svg>
  );
}

export function AqiCard({ snap, staleAt }: { snap: CitizenSnapshot; staleAt: string | null }) {
  const { t } = useI18n();
  const band = getAqiBand(snap.aqi);
  return (
    <section aria-labelledby="aqi-h" className="tile !p-5" data-reveal>
      <div className="flex items-center justify-between gap-2">
        <h2 id="aqi-h" className="h">{t('cz.aqi')}</h2>
        <span className="text-xs text-ink-soft">{staleAt ? t('cz.saved', { time: formatTime(staleAt) }) : t('cz.updated', { time: formatTime(snap.updatedAt) })}</span>
      </div>
      <div className="mt-2 flex flex-col items-center">
        <Gauge aqi={snap.aqi} color={band.bg} />
        <div className="-mt-14 flex flex-col items-center" role="img" aria-label={describeAqi(snap.aqi)}>
          <span className="mono text-6xl font-bold leading-none" data-testid="aqi-value">{formatAqi(snap.aqi)}</span>
          <span className="mt-2 rounded-full px-4 py-1 text-base font-bold" style={{ background: band.bg, color: band.fg }} data-testid="aqi-band">{band.label}</span>
        </div>
      </div>
      <div className="mt-4 flex items-baseline justify-between rounded-2xl bg-air-50 px-4 py-3">
        <span className="text-sm font-semibold text-ink-soft">{t('cz.pm25')}</span>
        <span className="mono text-xl font-bold" data-testid="pm25-value">{formatPm25(snap.pm25)}</span>
      </div>
      <div className="mt-4">
        <div className="mb-1 text-sm font-semibold">{t('cz.mix')}</div>
        <div className="flex h-4 overflow-hidden rounded-full" role="img" aria-label={snap.mix.map((m) => `${m.label} ${m.pct}%`).join(', ')}>
          {snap.mix.map((m, i) => <div key={m.label} style={{ width: `${m.pct}%`, background: MIX_COLORS[i % MIX_COLORS.length] }} />)}
        </div>
        <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-1 p-0 text-sm">
          {snap.mix.map((m, i) => (
            <li key={m.label} className="flex items-center justify-between">
              <span><span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} aria-hidden="true" />{m.label}</span>
              <b className="mono">{m.pct}%</b>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
