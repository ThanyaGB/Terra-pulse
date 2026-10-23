import type { TimedAlert } from '@/api/contract';
import { IconAlert, IconWind } from '@/design-system/Icons';
import { useI18n } from '@/i18n';
import { alertTiming, hhmm, humanDuration } from './time';

export function AlertsTimeline({ alerts, nowMin }: { alerts: TimedAlert[]; nowMin: number }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="alerts-h" className="tile !p-5" data-reveal>
      <h2 id="alerts-h" className="h mb-3">{t('cz.alerts')}</h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {alerts.map((a) => {
          const timing = alertTiming(a, nowMin);
          const warn = a.severity === 'warning';
          const active = timing.state === 'active';
          return (
            <li key={a.id} data-state={timing.state} className="rounded-2xl border-2 p-4" style={{
              borderColor: active ? (warn ? '#C62828' : '#0B7A53') : 'rgb(11 29 51 / 0.1)',
              background: active ? (warn ? '#FDE8E8' : '#E3F8EE') : '#fff',
              opacity: timing.state === 'passed' ? 0.65 : 1,
            }}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5" style={{ color: warn ? '#8A1C1C' : '#0B5C3E' }}>{warn ? <IconAlert /> : <IconWind />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b>{a.title}</b>
                    <span className="mono text-sm font-bold">{hhmm(a.startMin)}–{hhmm(a.endMin)}</span>
                  </div>
                  <p className="m-0 mt-1 text-sm text-ink-soft">{a.body}</p>
                  <div className="mt-2 text-xs font-bold" style={{ color: active ? (warn ? '#8A1C1C' : '#0B5C3E') : '#4A6380' }}>
                    {timing.state === 'active' && `${t('cz.state.active')} · ${t('cz.state.endsIn', { when: humanDuration(timing.endsInMin) })}`}
                    {timing.state === 'upcoming' && t('cz.state.upcoming', { when: humanDuration(timing.startsInMin) })}
                    {timing.state === 'passed' && t('cz.state.passed')}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
