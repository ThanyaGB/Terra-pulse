import { useRealtime } from '@/api/RealtimeProvider';
import { API_MODE } from '@/api/client';
import { AqiBadge } from '@/design-system/AqiBadge';
import { RealtimeBadge } from '@/design-system/RealtimeBadge';
import { Tag } from '@/design-system/Tile';
import { useNow } from '@/hooks/useNow';
import { formatTime } from '@/lib/format';

/** Top status bar: live NCR AQI, active fires, stream state. Reads the shared realtime channel. */
export function StatusBar() {
  const rt = useRealtime();
  const now = useNow(30_000);
  const readings = Object.values(rt.aqi);
  const ncrAqi = readings.length ? Math.round(readings.reduce((s, r) => s + r.aqi, 0) / readings.length) : null;
  return (
    <div className="tile !rounded-2xl flex flex-wrap items-center gap-x-6 gap-y-2 !p-3" role="region" aria-label="Live status">
      <div className="flex items-center gap-2"><span className="text-xs text-ink-soft">NCR mean AQI</span>{ncrAqi == null ? <span className="mono text-sm" aria-label="No reading yet">—</span> : <AqiBadge aqi={ncrAqi} size="sm" />}</div>
      <div className="text-sm"><span className="text-xs text-ink-soft">Active fires </span><b className="mono">{rt.activeFires ?? '—'}</b>{rt.newDetections > 0 && <span className="mono ml-1 text-xs font-bold text-warn-fg">+{rt.newDetections} new</span>}</div>
      <div className="text-sm"><span className="text-xs text-ink-soft">Stations reporting </span><b className="mono">{readings.length || '—'}</b></div>
      <RealtimeBadge state={rt.connection} />
      <div className="ml-auto flex items-center gap-3 text-xs text-ink-soft">
        {API_MODE === 'mock' && <Tag>All data simulated</Tag>}
        <span className="mono">Updated {rt.lastEventAt ? formatTime(rt.lastEventAt) : formatTime(now.toISOString())}</span>
      </div>
    </div>
  );
}
