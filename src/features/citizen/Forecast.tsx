import { useMemo } from 'react';
import { Tag } from '@/design/Tile';
import { getAqiBand } from '@/lib/aqi';
import { betterWindow, forecast24 } from '@/lib/forecast';
import { hhmm } from './time';

const W = 320, H = 130, PX = 8, PT = 10, PB = 22;

export function ForecastCard({ aqi, nowMin }: { aqi: number; nowMin: number }) {
  const pts = useMemo(() => forecast24(aqi, nowMin), [aqi, nowMin]);
  const win = useMemo(() => betterWindow(pts), [pts]);
  const max = Math.max(...pts.map((p) => p.aqi), 1) * 1.1;
  const x = (min: number) => PX + (min / 1440) * (W - 2 * PX);
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.hour * 60).toFixed(1)},${y(p.aqi).toFixed(1)}`).join(' ');
  const band = getAqiBand(win.aqi);
  return (
    <section className="tile !p-5" aria-labelledby="fc-h" data-reveal>
      <div className="mb-2 flex items-center justify-between gap-2"><h2 id="fc-h" className="h">Next 24 hours</h2><Tag>Estimate</Tag></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Estimated AQI over the day. Cleaner window ${hhmm(win.startMin)} to ${hhmm(win.endMin)}, around AQI ${win.aqi} (${band.label}).`}>
        <rect x={x(win.startMin)} y={PT} width={x(win.endMin) - x(win.startMin)} height={H - PT - PB} rx="6" fill="#0B7A53" opacity="0.14" />
        <path d={d} fill="none" stroke="#0F6FB8" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(nowMin)} x2={x(nowMin)} y1={PT} y2={H - PB} stroke="#0B1D33" strokeDasharray="3 3" opacity="0.5" />
        {[0, 6, 12, 18, 24].map((h) => <text key={h} x={x(h * 60)} y={H - 6} fontSize="10" textAnchor="middle" fill="#4A6380">{String(h % 24).padStart(2, '0')}:00</text>)}
      </svg>
      <p className="m-0 mt-2 rounded-2xl bg-leaf-50 px-4 py-3 text-sm font-semibold text-leaf-700">
        Better window: <span className="mono">{hhmm(win.startMin)}–{hhmm(win.endMin)}</span> (AQI about {win.aqi}). Plan walks and outdoor play then.
      </p>
      <p className="m-0 mt-2 text-xs text-ink-mute">Scaled from today's reading using a typical daily cycle. Not a model forecast.</p>
    </section>
  );
}
