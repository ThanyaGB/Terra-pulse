import { ForecastCard } from './Forecast';
import { GrapBanner } from './GrapBanner';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { useRealtime } from '@/api/RealtimeProvider';
import type { CitizenSnapshot, HealthProfile } from '@/api/contract';
import { useAsync, type AsyncState } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { IconBack, IconCamera, IconRoute, IconWind } from '@/design/Icons';
import { ApiModeToggle } from '@/design/ApiModeToggle';
import { LangSwitch } from '@/design/LangSwitch';
import { OfflineBanner } from '@/design/OfflineBanner';
import { Skeleton } from '@/design/Skeleton';
import { revealIn } from '@/design/motion';
import { useI18n } from '@/i18n';
import { AlertsTimeline as Alerts } from './Alerts';
import { AqiCard } from './AqiCard';
import { CommutePlanner } from './CommutePlanner';
import { AdviceList, ProfilePicker } from './HealthAdvice';
import { InstallPrompt } from './InstallPrompt';
import { LocationHeader } from './LocationHeader';
import { SnapReport } from './SnapReport';
import { readJson, withCache, writeJson } from './storage';
import { hhmm, minutesOfDay } from './time';

type Tab = 'air' | 'route' | 'report';
type SnapResult = { data: CitizenSnapshot; stale: boolean; at: string | null };
const PREVIEWS = [null, 7 * 60, 13 * 60 + 45, 18 * 60 + 30] as const;

export default function CitizenPage() {
  const { t } = useI18n();
  const rt = useRealtime();
  const [tab, setTab] = useState<Tab>('air');
  const [areaId, setAreaId] = useState(() => readJson<string>('vs.area') ?? 'av-204');
  const [profile, setProfile] = useState<HealthProfile>(() => readJson<HealthProfile>('vs.profile') ?? 'asthma');
  const [previewMin, setPreviewMin] = useState<number | null>(null);
  const now = useNow(60_000);
  const nowMin = previewMin ?? minutesOfDay(now);
  const slot = Math.floor(nowMin / 30); // advice only changes every half hour
  const main = useRef<HTMLElement>(null);

  const areas = useAsync(() => withCache('areas', () => api.getCitizenAreas()), []);
  const snap = useAsync(() => withCache(`snap:${areaId}`, () => api.getCitizenSnapshot(areaId)), [areaId]);
  const advice = useAsync(() => withCache(`advice:${profile}:${slot}`, () => api.getAdvice(profile, nowMin / 60)), [profile, slot]);

  useEffect(() => { writeJson('vs.area', areaId); }, [areaId]);
  useEffect(() => { writeJson('vs.profile', profile); }, [profile]);
  useEffect(() => revealIn(main.current), [tab, snap.status]);

  // a live reading from the stream beats the REST snapshot
  const live = rt.aqi[areaId];
  const mergedSnap = useMemo<AsyncState<SnapResult>>(() => {
    if (snap.status === 'loading') return { status: 'loading' };
    if (snap.status === 'error') return { status: 'error', error: snap.error };
    const s: CitizenSnapshot = live ? { ...snap.data.data, aqi: live.aqi, pm25: live.pm25, updatedAt: live.ts } : snap.data.data;
    return { status: 'success', data: { ...snap.data, data: s } };
  }, [snap, live]);

  const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'air', label: t('cz.tab.air'), icon: <IconWind /> },
    { id: 'route', label: t('cz.tab.route'), icon: <IconRoute /> },
    { id: 'report', label: t('cz.tab.report'), icon: <IconCamera /> },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col">
      <OfflineBanner message={t('common.offline')} />
      <header className="flex flex-col gap-3 px-4 pb-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" aria-label={t('common.back')} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow"><IconBack /></Link>
          <LangSwitch />
          <ApiModeToggle />
        </div>
        <LocationHeader areas={areas.status === 'success' ? areas.data.data : []} areaId={areaId} onChange={setAreaId} title={t('nav.citizen')} aqiById={Object.fromEntries(Object.entries(rt.aqi).map(([k, v]) => [k, v.aqi]))} />
      </header>

      <main id="main" ref={main} className="flex flex-1 flex-col gap-4 px-4 pb-28">
        <GrapBanner />
        <InstallPrompt />
        {tab === 'air' && (
          <>
            <AsyncBoundary state={mergedSnap} onRetry={snap.reload} what={t('cz.aqi')} retryLabel={t('common.retry')} skeleton={<Skeleton className="h-[380px] w-full !rounded-3xl" />}>
              {(r) => <AqiCard snap={r.data} staleAt={r.stale ? r.at : null} />}
            </AsyncBoundary>

            {mergedSnap.status === 'success' && <ForecastCard aqi={mergedSnap.data.data.aqi} nowMin={nowMin} />}

            <section className="tile !p-5" aria-label={t('cz.profile')} data-reveal>
              <ProfilePicker value={profile} onChange={setProfile} />
              <div className="mt-4 flex items-center gap-3">
                <label htmlFor="preview" className="text-sm font-semibold text-ink-soft">{t('cz.previewAs')}</label>
                <select id="preview" className="field !w-auto" value={previewMin ?? 'now'} onChange={(e) => setPreviewMin(e.target.value === 'now' ? null : Number(e.target.value))}>
                  {PREVIEWS.map((p) => <option key={p ?? 'now'} value={p ?? 'now'}>{p === null ? `${t('cz.now')} (${hhmm(minutesOfDay(now))})` : hhmm(p)}</option>)}
                </select>
              </div>
              <AsyncBoundary state={advice} onRetry={advice.reload} what={t('cz.advice')} retryLabel={t('common.retry')}>
                {(r) => <AdviceList advice={r.data} stale={r.stale} />}
              </AsyncBoundary>
            </section>

            {mergedSnap.status === 'success' && <Alerts alerts={mergedSnap.data.data.alerts} nowMin={nowMin} />}
          </>
        )}
        {tab === 'route' && <CommutePlanner />}
        {tab === 'report' && <SnapReport areaId={areaId} />}
      </main>

      <nav aria-label={t('nav.citizen')} className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-[480px] grid-cols-3 gap-1 border-t border-line bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        {TABS.map((x) => {
          const on = x.id === tab;
          return (
            <button key={x.id} type="button" aria-current={on ? 'page' : undefined} onClick={() => setTab(x.id)}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-bold" style={{ color: on ? '#0B7A53' : '#4A6380', background: on ? '#E3F8EE' : 'transparent' }}>
              {x.icon}{x.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

