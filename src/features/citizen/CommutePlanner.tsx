import { useId, useState, type FormEvent } from 'react';
import { api } from '@/api/client';
import type { RouteOption, RoutesResponse } from '@/api/contract';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { AqiBadge } from '@/design/AqiBadge';
import { IconCheck } from '@/design/Icons';
import { useI18n } from '@/i18n';
import { avgExposureAqi, exposureReductionPct, pickRecommended, totalMinutes } from '@/lib/exposure';
import { getAqiBand } from '@/lib/aqi';
import { withCache } from './storage';

export const PLACES = ['Anand Vihar Metro', 'Patparganj Depot', 'Laxmi Nagar', 'Mayur Vihar Ph-1', 'Akshardham', 'Karkardooma Court', 'Preet Vihar', 'Yamuna Sports Complex'];

export interface RouteView {
  option: RouteOption;
  minutes: number;
  exposure: number;
  extraMinutes: number;
  reductionPct: number;
  recommended: boolean;
  fastest: boolean;
}

/** Derives everything the cards show from the raw segments, so the numbers are always consistent. */
export function buildRouteViews(options: RouteOption[]): RouteView[] {
  if (options.length === 0) return [];
  const rows = options.map((o) => ({ option: o, minutes: totalMinutes(o.segments), exposure: avgExposureAqi(o.segments) }));
  const fastest = rows.reduce((a, b) => (b.minutes < a.minutes ? b : a));
  const rec = pickRecommended(options.map((o) => ({ id: o.id, segments: o.segments })));
  return rows.map((r) => ({
    ...r,
    extraMinutes: r.minutes - fastest.minutes,
    reductionPct: r === fastest ? 0 : exposureReductionPct(fastest.exposure, r.exposure),
    recommended: r.option.id === rec,
    fastest: r === fastest,
  }));
}

export function CommutePlanner() {
  const { t } = useI18n();
  const uid = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState<{ from: string; to: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const state = useAsync(
    () => (query ? withCache<RoutesResponse>(`routes:${query.from}:${query.to}`, () => api.getRoutes(query.from, query.to)) : Promise.resolve(null)),
    [query?.from, query?.to],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const a = from.trim();
    const b = to.trim();
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) { setFormError(t('cz.route.invalid')); return; }
    setFormError(null);
    setQuery({ from: a, to: b });
  }

  return (
    <section aria-labelledby="route-h" className="flex flex-col gap-4">
      <div className="tile !p-5" data-reveal>
        <h2 id="route-h" className="h mb-3">{t('cz.route.title')}</h2>
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <div>
            <label htmlFor={`${uid}-from`} className="mb-1 block text-sm font-semibold">{t('cz.from')}</label>
            <input id={`${uid}-from`} className="field" list={`${uid}-places`} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Anand Vihar Metro" autoComplete="off" />
          </div>
          <div>
            <label htmlFor={`${uid}-to`} className="mb-1 block text-sm font-semibold">{t('cz.to')}</label>
            <input id={`${uid}-to`} className="field" list={`${uid}-places`} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Patparganj Depot" autoComplete="off" />
          </div>
          <datalist id={`${uid}-places`}>{PLACES.map((p) => <option key={p} value={p} />)}</datalist>
          {formError && <p role="alert" className="m-0 text-sm font-semibold text-danger">{formError}</p>}
          <button type="submit" className="btn btn-primary btn-lg">{t('cz.plan')}</button>
        </form>
      </div>

      {query && (
        <div aria-live="polite">
          <AsyncBoundary state={state} onRetry={state.reload} what={t('cz.route.title')} retryLabel={t('common.retry')} isEmpty={(d) => !d || d.data.options.length === 0} empty={t('cz.route.empty')}>
            {(res) => res && (
              <div className="flex flex-col gap-3">
                {res.stale && <p className="m-0 text-xs text-ink-mute">{t('cz.offlineAdvice')}</p>}
                <RouteMap views={buildRouteViews(res.data.options)} />
                {buildRouteViews(res.data.options).map((r) => <RouteCard key={r.option.id} view={r} />)}
              </div>
            )}
          </AsyncBoundary>
        </div>
      )}
    </section>
  );
}

function RouteCard({ view: v }: { view: RouteView }) {
  const { t } = useI18n();
  const band = getAqiBand(v.exposure);
  return (
    <article data-testid="route-card" data-recommended={v.recommended} aria-label={v.option.name} className="tile !p-5" style={{ borderColor: v.recommended ? '#0B7A53' : undefined, borderWidth: v.recommended ? 2 : 1 }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="h">{v.option.name}</h3>
          <div className="text-xs text-ink-soft">{v.option.via}</div>
        </div>
        {v.recommended && <span className="chip bg-leaf-700 text-white"><IconCheck size={14} /> {t('cz.recommended')}</span>}
        {!v.recommended && v.fastest && <span className="chip bg-air-100 text-ink">{t('cz.fastest')}</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-air-50 p-3">
          <div className="text-xs text-ink-soft">{t('cz.time')}</div>
          <div className="mono text-2xl font-bold">{t('cz.minutes', { n: v.minutes })}</div>
          {v.extraMinutes > 0 && <div className="text-xs text-ink-soft">{t('cz.extraTime', { n: v.extraMinutes })}</div>}
        </div>
        <div className="rounded-2xl p-3" style={{ background: band.bg, color: band.fg }}>
          <div className="text-xs font-semibold">{t('cz.avgExposure')}</div>
          <div className="mono text-2xl font-bold">AQI {v.exposure}</div>
          <div className="text-xs font-semibold">{band.label}</div>
        </div>
      </div>
      {v.reductionPct > 0 && (
        <p className="m-0 mt-3 rounded-2xl bg-leaf-50 px-4 py-3 text-lg font-bold text-leaf-700" data-testid="reduction">
          {t('cz.lessExposure', { pct: v.reductionPct })}
        </p>
      )}
      <details className="mt-3 text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('cz.segments')}</summary>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {v.option.segments.map((s) => (
            <li key={s.label} className="flex items-center justify-between"><span>{s.label} · {t('cz.minutes', { n: s.minutes })}</span><AqiBadge aqi={s.aqi} size="sm" showLabel={false} /></li>
          ))}
        </ul>
      </details>
    </article>
  );
}

/** Schematic only: shows the shape of the choice (direct road through the hotspot vs cleaner detour), not real geometry. */
function RouteMap({ views }: { views: RouteView[] }) {
  const [nav, setNav] = useState(false);
  const rec = views.find((v) => v.recommended) ?? views[0];
  const fast = views.find((v) => v.fastest) ?? views[0];
  const direct = 'M30,150 L290,40';
  const clean = 'M30,150 C70,60 200,30 290,40';
  const recIsDirect = rec === fast;
  return (
    <figure className="tile m-0 !p-4" aria-label="Route comparison map (schematic)">
      <svg viewBox="0 0 320 180" className="w-full" role="img" aria-label={`Schematic map. ${recIsDirect ? 'The fastest route is also the cleanest.' : 'The recommended route bends away from the polluted main road.'}`}>
        <rect width="320" height="180" rx="16" fill="#EAF4FA" />
        <circle cx="160" cy="95" r="34" fill="#C62828" opacity="0.18" /><text x="160" y="99" textAnchor="middle" fontSize="10" fill="#7A1212">hotspot</text>
        <path d={direct} fill="none" stroke="#B45309" strokeWidth="4" strokeDasharray={recIsDirect ? undefined : '8 6'} strokeLinecap="round" />
        {!recIsDirect && <path d={clean} fill="none" stroke="#0B7A53" strokeWidth="5" strokeLinecap="round" />}
        <circle cx="30" cy="150" r="7" fill="#0B1D33" /><circle cx="290" cy="40" r="7" fill="#0B7A53" />
        {nav && <circle r="6" fill="#0F6FB8" stroke="#fff" strokeWidth="2"><animateMotion dur="6s" repeatCount="indefinite" path={recIsDirect ? direct : clean} /></circle>}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
        <span><span className="mr-1 inline-block h-2 w-5 rounded bg-[#0B7A53] align-middle" />recommended <span className="ml-2 mr-1 inline-block h-2 w-5 rounded bg-[#B45309] align-middle" />fastest</span>
        <button type="button" className="btn btn-navy !min-h-10" aria-pressed={nav} onClick={() => setNav((n) => !n)}>{nav ? 'Stop navigation' : 'Start navigation (demo)'}</button>
      </figcaption>
    </figure>
  );
}
