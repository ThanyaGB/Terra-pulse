import { useEffect } from 'react';
import { useRealtime } from '@/api/RealtimeProvider';
import { API_MODE, api } from '@/api/client';
import { AqiBadge } from '@/design/AqiBadge';
import { RealtimeBadge } from '@/design/RealtimeBadge';
import { Tag } from '@/design/Tile';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { formatNumber, formatTime } from '@/lib/format';
import { subscribeSupply } from '@/lib/supply';

/** Top status bar: live NCR AQI, active fires, stream state, and the straw-supply read-out. Reads the shared realtime channel. */
export function StatusBar() {
  const rt = useRealtime();
  const now = useNow(30_000);
  const supply = useAsync(() => api.getSupplySummary(), []);
  useEffect(() => subscribeSupply(supply.refresh), [supply.refresh]);
  const readings = Object.values(rt.aqi);
  const ncrAqi = readings.length ? Math.round(readings.reduce((s, r) => s + r.aqi, 0) / readings.length) : null;
  return (
    <div className="tile !rounded-2xl flex flex-wrap items-center gap-x-6 gap-y-2 !p-3" role="region" aria-label="Live status">
      <div className="flex items-center gap-2"><span className="text-xs text-ink-soft">NCR mean AQI</span>{ncrAqi == null ? <span className="mono text-sm" aria-label="No reading yet">—</span> : <AqiBadge aqi={ncrAqi} size="sm" />}</div>
      <div className="text-sm"><span className="text-xs text-ink-soft">Active fires </span><b className="mono">{rt.activeFires ?? '—'}</b>{rt.newDetections > 0 && <span className="mono ml-1 text-xs font-bold text-warn-fg">+{rt.newDetections} new</span>}</div>
      <div className="text-sm"><span className="text-xs text-ink-soft">Stations reporting </span><b className="mono">{readings.length || '—'}</b></div>
      <div className="text-sm" data-testid="policy-straw"><span className="text-xs text-ink-soft">Straw collected by buyers </span><b className="mono">{supply.status === 'success' ? `${formatNumber(supply.data.collectedTonnes, 1)} t` : '—'}</b><span className="text-xs text-ink-soft"> vs burn proxy </span><b className="mono">{supply.status === 'success' ? `${formatNumber(supply.data.burnProxyFires)} FIRMS fires` : '—'}</b></div>
      <RealtimeBadge state={rt.connection} />
      <div className="ml-auto flex items-center gap-3 text-xs text-ink-soft">
        {API_MODE === 'mock' && <Tag>All data simulated</Tag>}
        <span className="mono">Updated {rt.lastEventAt ? formatTime(rt.lastEventAt) : formatTime(now.toISOString())}</span>
      </div>
    </div>
  );
}
