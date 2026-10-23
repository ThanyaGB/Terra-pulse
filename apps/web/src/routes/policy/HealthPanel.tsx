import { api } from '@/api/client';
import { useRealtime } from '@/api/RealtimeProvider';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design-system/AsyncBoundary';
import { StatusLamp } from '@/design-system/StatusLamp';
import { Tag, Tile } from '@/design-system/Tile';
import { latencyStatus, stationsStatus } from '@/lib/health';
import { timeAgo } from '@/lib/format';

export function HealthPanel() {
  const state = useAsync(() => api.getHealth(), []);
  const rt = useRealtime();
  return (
    <Tile id="health" title="Pipeline health monitor" aside={<Tag>{rt.connection === 'live' ? 'Streaming' : 'Snapshot'}</Tag>} className="min-h-[440px]">
      <AsyncBoundary state={state} onRetry={state.reload} what="pipeline health">
        {(d) => {
          // live agent events override the REST snapshot
          const agents = d.agents.map((a) => rt.agents[a.id] ?? a);
          const avg = Math.round(agents.reduce((s, a) => s + a.latencyMs, 0) / Math.max(1, agents.length));
          const rows = d.items.map((it) => {
            if (it.id === 'cpcb') return { ...it, status: stationsStatus(d.cpcb.online, d.cpcb.total), detail: `${d.cpcb.online}/${d.cpcb.total} online${d.cpcb.online < d.cpcb.total ? ', 1 offline' : ''}` };
            if (it.id === 'agents') return { ...it, status: latencyStatus(avg), detail: `Mean latency ${avg} ms` };
            return it;
          });
          return (
            <div className="flex flex-col gap-4">
              <ul className="flex flex-col gap-2" aria-label="Data pipeline status">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl bg-air-50 px-4 py-3">
                    <div>
                      <div className="font-semibold">{r.label}</div>
                      <div className="text-xs text-ink-soft">{r.detail}</div>
                    </div>
                    <div className="text-right">
                      <StatusLamp status={r.status} />
                      <div className="text-[11px] text-ink-mute">{timeAgo(r.updatedAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <div>
                <h3 className="mb-2 text-sm font-bold">Agent coordination latency</h3>
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Latency per agent</caption>
                  <thead>
                    <tr className="text-left text-xs text-ink-soft">
                      <th scope="col" className="pb-1 font-semibold">Agent</th>
                      <th scope="col" className="pb-1 text-right font-semibold">Latency</th>
                      <th scope="col" className="pb-1 pl-4 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => (
                      <tr key={a.id} className="border-t border-line">
                        <th scope="row" className="py-1.5 text-left font-medium">{a.name}</th>
                        <td className="mono py-1.5 text-right">{a.latencyMs} ms</td>
                        <td className="py-1.5 pl-4"><StatusLamp status={latencyStatus(a.latencyMs)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-ink-mute">Green under 500 ms, amber under 1.5 s, red beyond.</p>
              </div>
            </div>
          );
        }}
      </AsyncBoundary>
    </Tile>
  );
}
