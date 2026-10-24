import { useRef } from 'react';
import { api } from '@/api/client';
import type { AttributionResponse, SourceShare } from '@/api/contract';
import { useAsync, type AsyncState } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { Tag, Tile } from '@/design/Tile';
import { SOURCE_META, SOURCE_ORDER, shareOf } from '@/lib/sources';

const R = 62;
const C = 2 * Math.PI * R;

function Donut({ shares, label }: { shares: SourceShare[]; label: string }) {
  let offset = 0;
  const summary = SOURCE_ORDER.map((id) => `${SOURCE_META[id].short} ${shareOf(shares, id)}%`).join(', ');
  return (
    <svg width="168" height="168" viewBox="0 0 168 168" role="img" aria-label={`${label}: ${summary}`}>
      <circle cx="84" cy="84" r={R} fill="none" className="stroke-track" strokeWidth="26" />
      {SOURCE_ORDER.map((id) => {
        const len = (shareOf(shares, id) / 100) * C;
        const el = (
          <circle key={id} cx="84" cy="84" r={R} fill="none" stroke={SOURCE_META[id].color} strokeWidth="26"
            strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-offset} transform="rotate(-90 84 84)" style={{ transition: 'stroke-dasharray 600ms cubic-bezier(.22,1,.36,1), stroke-dashoffset 600ms cubic-bezier(.22,1,.36,1)' }} />
        );
        offset += len;
        return el;
      })}
      <text x="84" y="80" textAnchor="middle" fontSize="28" fontWeight="700" fontFamily="JetBrains Mono, monospace" style={{ fill: 'var(--color-ink)' }}>{shareOf(shares, 'straw_plume')}%</text>
      <text x="84" y="100" textAnchor="middle" fontSize="11" style={{ fill: 'var(--color-ink-soft)' }}>straw plume</text>
    </svg>
  );
}

function StackedBar({ shares, label }: { shares: SourceShare[]; label: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-ink-soft">{label}</div>
      <div className="flex h-5 overflow-hidden rounded-full" role="img" aria-label={`${label}: ${SOURCE_ORDER.map((id) => `${SOURCE_META[id].short} ${shareOf(shares, id)}%`).join(', ')}`}>
        {SOURCE_ORDER.map((id) => <div key={id} style={{ width: `${shareOf(shares, id)}%`, background: SOURCE_META[id].color }} />)}
      </div>
    </div>
  );
}

export function AttributionPanel({ cellId, onCellChange }: { cellId: string; onCellChange: (id: string) => void }) {
  const state = useAsync(() => api.getAttribution(cellId), [cellId]);
  const last = useRef<AttributionResponse | null>(null);
  if (state.status === 'success') last.current = state.data;
  // keep showing the previous cell while the next one loads, so the panel does not flash
  const shown: AsyncState<AttributionResponse> = state.status === 'loading' && last.current ? { status: 'success', data: last.current } : state;

  return (
    <Tile
      id="attribution"
      title="Source attribution matrix"
      aside={<Tag>{state.status === 'loading' && last.current ? 'Updating' : 'Regional scale'}</Tag>}
      className="min-h-[440px]"
    >
      <AsyncBoundary state={shown} onRetry={state.reload} what="source attribution">
        {(d) => (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="cell-select" className="text-sm font-semibold">Grid cell</label>
              <select id="cell-select" className="field !w-auto min-w-[180px]" value={cellId} onChange={(e) => onCellChange(e.target.value)}>
                {d.cells.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <span className="text-xs text-ink-mute">Click a street on the map to select its cell.</span>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <Donut shares={d.cell.shares} label={`PM2.5 source share in ${d.cell.label}`} />
              <table className="min-w-[280px] flex-1 border-collapse text-sm">
                <caption className="sr-only">Share of PM2.5 by source, selected cell and Delhi-NCR overall</caption>
                <thead>
                  <tr className="text-left text-xs text-ink-soft">
                    <th scope="col" className="pb-2 font-semibold">Source</th>
                    <th scope="col" className="pb-2 text-right font-semibold">{d.cell.label}</th>
                    <th scope="col" className="pb-2 text-right font-semibold">Delhi-NCR</th>
                  </tr>
                </thead>
                <tbody>
                  {SOURCE_ORDER.map((id) => {
                    const a = shareOf(d.cell.shares, id);
                    const b = shareOf(d.ncr.shares, id);
                    return (
                      <tr key={id} className="border-t border-line">
                        <th scope="row" className="py-2 text-left font-medium">
                          <span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: SOURCE_META[id].color }} aria-hidden="true" />
                          {SOURCE_META[id].label}
                        </th>
                        <td className="mono py-2 text-right font-bold">{a}%</td>
                        <td className="mono py-2 text-right text-ink-soft">{b}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <StackedBar shares={d.cell.shares} label={`Selected cell: ${d.cell.label}`} />
              <StackedBar shares={d.ncr.shares} label="Delhi-NCR overall" />
            </div>
            <div className="rounded-2xl bg-air-50 p-4">
              <h3 className="mb-2 text-sm font-bold">How {d.cell.label} differs from Delhi-NCR</h3>
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                {SOURCE_ORDER.map((id) => {
                  const diff = shareOf(d.cell.shares, id) - shareOf(d.ncr.shares, id);
                  return (
                    <li key={id} className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2">
                      <span>{SOURCE_META[id].short}</span>
                      <span className="mono font-bold">{diff === 0 ? 'same as NCR' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} pts ${diff > 0 ? 'higher' : 'lower'}`}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-ink-soft">Straw plume responds to upstream baler and seeder dispatch; vehicle exhaust to diversion orders; dust to fog cannons.</p>
            </div>
          </div>
        )}
      </AsyncBoundary>
    </Tile>
  );
}
