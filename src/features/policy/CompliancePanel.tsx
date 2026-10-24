import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { Tag, Tile } from '@/design/Tile';
import { formatNumber } from '@/lib/format';

function Meter({ value, max, label, color = '#0B7A53' }: { value: number; max: number; label: string; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2.5 w-full overflow-hidden rounded-full bg-track">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width 600ms cubic-bezier(.22,1,.36,1)' }} />
    </div>
  );
}

export function CompliancePanel() {
  const state = useAsync(() => api.getCompliance(), []);
  return (
    <Tile id="compliance" title="Compliance & ROI" aside={<Tag>Measured</Tag>} className="min-h-[440px]">
      <AsyncBoundary state={state} onRetry={state.reload} what="compliance figures">
        {(d) => {
          const strawPct = Math.round((d.strawCollectedTonnes / d.strawTargetTonnes) * 100);
          return (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-air-50 p-3">
                  <div className="text-xs text-ink-soft">Straw collected</div>
                  <div className="mono text-2xl font-bold">{formatNumber(d.strawCollectedTonnes)} t</div>
                  <Meter value={d.strawCollectedTonnes} max={d.strawTargetTonnes} label="Straw collected versus target" />
                  <div className="mono mt-1 text-[11px] text-ink-mute">{strawPct}% of {formatNumber(d.strawTargetTonnes)} t target</div>
                </div>
                <div className="rounded-2xl bg-air-50 p-3">
                  <div className="text-xs text-ink-soft">CHC machinery utilisation</div>
                  <div className="mono text-2xl font-bold">{d.chc.utilisationPct}%</div>
                  <Meter value={d.chc.utilisationPct} max={100} label="Custom hiring centre machinery utilisation" color="#0F6FB8" />
                  <div className="mono mt-1 text-[11px] text-ink-mute">{d.chc.machinesInUse} of {d.chc.machinesTotal} machines in use</div>
                </div>
                <div className="rounded-2xl bg-air-50 p-3">
                  <div className="text-xs text-ink-soft">MCD fog cannons</div>
                  <div className="mono text-2xl font-bold">{d.fogCannons.inTransit} <span className="text-sm font-semibold text-ink-soft">in transit</span></div>
                  <Meter value={d.fogCannons.deployed} max={d.fogCannons.planned} label="Fog cannons deployed versus planned" color="#6D3FC9" />
                  <div className="mono mt-1 text-[11px] text-ink-mute">{d.fogCannons.deployed} deployed of {d.fogCannons.planned} planned</div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold">Measured ΔPM2.5 on monitored streets</h3>
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">PM2.5 before and after interventions on monitored streets</caption>
                  <thead>
                    <tr className="text-left text-xs text-ink-soft">
                      <th scope="col" className="pb-1 font-semibold">Street</th>
                      <th scope="col" className="pb-1 text-right font-semibold">Before</th>
                      <th scope="col" className="pb-1 text-right font-semibold">After</th>
                      <th scope="col" className="pb-1 pl-4 font-semibold">Reduction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.monitoredStreets.map((s) => {
                      const delta = s.beforePm25 - s.afterPm25;
                      const pct = Math.round((delta / s.beforePm25) * 100);
                      return (
                        <tr key={s.id} className="border-t border-line">
                          <th scope="row" className="py-1.5 text-left font-medium">{s.name}</th>
                          <td className="mono py-1.5 text-right text-ink-soft">{s.beforePm25}</td>
                          <td className="mono py-1.5 text-right">{s.afterPm25}</td>
                          <td className="py-1.5 pl-4">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-track" aria-hidden="true"><div className="h-full rounded-full bg-leaf-700" style={{ width: `${Math.min(100, pct * 3)}%` }} /></div>
                              <span className="mono w-24 text-right text-xs font-bold text-leaf-700">−{delta} µg/m³ ({pct}%)</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }}
      </AsyncBoundary>
    </Tile>
  );
}
