import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design-system/AsyncBoundary';
import { Skeleton } from '@/design-system/Skeleton';
import { Tag, Tile } from '@/design-system/Tile';
import { IconPause, IconPlay } from '@/design-system/Icons';
import { getAqiBand, pm25ToAqi } from '@/lib/aqi';
import { HORIZON_HOURS, arrivalState, clockAt, pm25At } from '@/lib/plume';
import { PlumeMap } from './PlumeMap';

export function PlumePanel({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const state = useAsync(() => api.getPlume(), []);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const start = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setHour((h) => {
        if (h >= HORIZON_HOURS) { setPlaying(false); return h; }
        return h + 1;
      });
    }, 300);
    return () => clearInterval(id);
  }, [playing]);

  return (
    <Tile id="plume" title="72-hour plume projection" aside={<Tag>Sangrur → NCR</Tag>} className="min-h-[440px]">
      <AsyncBoundary state={state} onRetry={state.reload} what="the plume forecast" skeleton={<Skeleton className="h-[340px] w-full" />}>
        {(d) => (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="h-[300px] lg:h-[340px]">
                <PlumeMap data={d} hour={hour} selectedId={selectedId} onSelect={onSelect} />
              </div>
              <div className="max-h-[340px] overflow-auto rounded-2xl border border-line bg-surface">
                <table className="w-full border-collapse text-xs">
                  <caption className="sr-only">Plume arrival time and PM2.5 per street at the selected hour</caption>
                  <thead className="sticky top-0 bg-air-50 text-left text-ink-soft">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Street</th>
                      <th scope="col" className="px-2 py-2 font-semibold">Arrival</th>
                      <th scope="col" className="px-2 py-2 text-right font-semibold">Now</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Peak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.streets.map((s) => {
                      const a = arrivalState(s, hour);
                      const pm = pm25At(s, hour);
                      const band = getAqiBand(pm25ToAqi(pm));
                      const on = s.id === selectedId;
                      return (
                        <tr key={s.id} className="border-t border-line" style={{ background: on ? 'var(--color-sel)' : undefined }}>
                          <th scope="row" className="px-3 py-1.5 text-left font-semibold">
                            <button type="button" className="min-h-8 text-left underline-offset-2 hover:underline" aria-pressed={on} onClick={() => onSelect(s.id)}>{s.name}</button>
                          </th>
                          <td className="px-2 py-1.5">
                            <div className="mono font-semibold">+{s.etaHours} h</div>
                            <div className="text-[11px] text-ink-mute">{a.state === 'arrived' ? 'arrived' : `in ${a.hours} h`}</div>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="mono inline-block rounded-md px-1.5 py-0.5 font-bold" style={{ background: band.bg, color: band.fg }}>{pm}</span>
                          </td>
                          <td className="mono px-3 py-1.5 text-right font-bold">{s.peakPm25}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-[11px] text-ink-mute">PM2.5 in µg/m³. Colour = CPCB category of the converted AQI.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-air-50 p-3">
              <button type="button" className="btn btn-navy !min-h-11 !w-11 !px-0" aria-label={playing ? 'Pause timeline' : 'Play timeline'} onClick={() => { if (hour >= HORIZON_HOURS) setHour(0); setPlaying((p) => !p); }}>
                {playing ? <IconPause /> : <IconPlay />}
              </button>
              <div className="min-w-[200px] flex-1">
                <label htmlFor="scrubber" className="flex justify-between text-xs font-semibold text-ink-soft">
                  <span>Forecast hour</span>
                  <span className="mono text-ink">+{hour} h · {clockAt(start, hour)}</span>
                </label>
                <input
                  id="scrubber" type="range" min={0} max={HORIZON_HOURS} step={1} value={hour}
                  aria-valuetext={`Plus ${hour} hours, ${clockAt(start, hour)}`}
                  onChange={(e) => { setPlaying(false); setHour(Number(e.target.value)); }}
                  className="mt-1 h-8 w-full accent-[#0F6FB8]"
                />
                <div className="mono flex justify-between text-[11px] text-ink-mute"><span>0 h</span><span>24 h</span><span>48 h</span><span>72 h</span></div>
              </div>
              <div className="text-xs text-ink-soft">Wind <b className="mono text-ink">{d.windSpeedKmh} km/h</b> · NCR in <b className="mono text-ink">~{d.hoursToReachNcr} h</b></div>
            </div>
          </div>
        )}
      </AsyncBoundary>
    </Tile>
  );
}
