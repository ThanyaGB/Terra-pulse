import { useMemo, useState } from 'react';
import type { Farmer, FarmersResponse } from '@/api/contract';
import type { AsyncState } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design-system/AsyncBoundary';
import { Tag, Tile } from '@/design-system/Tile';
import { SkeletonBlock } from '@/design-system/Skeleton';
import { formatDate, timeAgo } from '@/lib/format';
import { RISK_TIERS, filterFarmers, riskTier, sortFarmers, type FarmerFilters, type RiskTier, type SortDir, type SortKey } from '@/lib/risk';
import { MACHINE_LABEL, STATUS_META } from './machine';

interface Props {
  state: AsyncState<FarmersResponse>;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCall: (f: Farmer) => void;
  onAssign: (f: Farmer) => void;
  busyId: string | null;
  callsOn: boolean;
}

const COLS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'Farmer' },
  { key: 'village', label: 'Village' },
  { key: 'acres', label: 'Area (acres)', align: 'right' },
  { key: 'harvestDate', label: 'Expected harvest' },
  { key: 'riskScore', label: 'Fire risk' },
  { key: 'lastContactAt', label: 'Last contact' },
];

export function FarmerTable({ state, onRetry, selectedId, onSelect, onCall, onAssign, busyId, callsOn }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'riskScore', dir: 'desc' });
  const [filters, setFilters] = useState<FarmerFilters>({ village: 'all', tier: 'all' });

  const rows = useMemo(() => {
    if (state.status !== 'success') return [];
    return sortFarmers(filterFarmers(state.data.farmers, filters), sort.key, sort.dir);
  }, [state, filters, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'village' ? 'asc' : 'desc' }));
  }

  const filtered = filters.village !== 'all' || filters.tier !== 'all';

  return (
    <Tile id="farmers" title="High-risk farmers" aside={<><Tag color="#8A4B0F">Fire risk = estimate</Tag><Tag>Example farmers</Tag></>} className="flex min-h-0 flex-col">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="f-village" className="mb-1 block text-xs font-semibold text-ink-soft">Village</label>
          <select id="f-village" className="field !w-auto min-w-[170px]" value={filters.village} onChange={(e) => setFilters((f) => ({ ...f, village: e.target.value }))}>
            <option value="all">All 14 villages</option>
            {state.status === 'success' && state.data.villages.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-tier" className="mb-1 block text-xs font-semibold text-ink-soft">Risk tier</label>
          <select id="f-tier" className="field !w-auto min-w-[150px]" value={filters.tier} onChange={(e) => setFilters((f) => ({ ...f, tier: e.target.value as RiskTier | 'all' }))}>
            <option value="all">All tiers</option>
            {RISK_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.min}+)</option>)}
          </select>
        </div>
        {state.status === 'success' && <p className="m-0 ml-auto text-sm text-ink-soft" aria-live="polite">Showing <b className="mono text-ink">{rows.length}</b> of <b className="mono text-ink">{state.data.farmers.length}</b></p>}
      </div>

      <AsyncBoundary state={state} onRetry={onRetry} what="the farmer list" skeleton={<SkeletonBlock rows={6} label="Loading farmers" />}
        isEmpty={(d) => d.farmers.length === 0} empty="No farmers are registered for this cluster yet.">
        {() => (
          <div className="max-h-[560px] overflow-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <caption className="sr-only">Farmers ranked by fire-risk score. Select a name to see the call log.</caption>
              <thead className="sticky top-0 z-10 bg-air-50 text-left text-ink-soft">
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}>
                      <button type="button" className="inline-flex min-h-9 items-center gap-1 font-semibold" onClick={() => toggleSort(c.key)}>
                        {c.label}<span aria-hidden="true" className="text-xs">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Quick action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-ink-soft">
                    No farmers match these filters.{' '}
                    {filtered && <button type="button" className="btn btn-ghost !min-h-9 ml-2" onClick={() => setFilters({ village: 'all', tier: 'all' })}>Clear filters</button>}
                  </td></tr>
                )}
                {rows.map((f) => {
                  const tier = riskTier(f.riskScore);
                  const st = STATUS_META[f.status];
                  const sel = f.id === selectedId;
                  const busy = busyId === f.id;
                  return (
                    <tr key={f.id} aria-selected={sel} className="border-t border-line" style={{ background: sel ? '#DFF3FF' : f.status === 'dispatched' ? '#F3FBF7' : undefined }}>
                      <th scope="row" className="px-3 py-2 text-left">
                        <button type="button" aria-pressed={sel} onClick={() => onSelect(f.id)} className="min-h-10 text-left font-semibold underline-offset-2 hover:underline">{f.name}</button>
                        <div className="mono text-[11px] font-normal text-ink-mute">{f.id}</div>
                      </th>
                      <td className="px-3 py-2">{f.village}</td>
                      <td className="mono px-3 py-2 text-right">{f.acres}</td>
                      <td className="mono px-3 py-2">{formatDate(f.harvestDate)}</td>
                      <td className="px-3 py-2">
                        <span className="chip" style={{ background: tier.bg, color: tier.fg }}><span className="mono font-bold">{f.riskScore}</span>{tier.label}</span>
                      </td>
                      <td className="px-3 py-2 text-ink-soft">{timeAgo(f.lastContactAt)}</td>
                      <td className="px-3 py-2"><span className="chip" style={{ background: st.bg, color: st.fg }}>{st.label}</span></td>
                      <td className="px-3 py-2 text-right">
                        {f.status === 'dispatched' ? (
                          <span className="text-xs font-semibold text-leaf-700">Done</span>
                        ) : (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button type="button" className="btn !min-h-10" disabled={busy || !callsOn} title={callsOn ? undefined : 'Calls are switched off (TELEPHONY_ENABLED)'} onClick={() => onCall(f)} aria-label={`Call ${f.name}`}>Voice alert</button>
                            <button type="button" className="btn btn-primary !min-h-10" disabled={busy} onClick={() => onAssign(f)} aria-label={`Assign ${MACHINE_LABEL[f.machineNeed]} to ${f.name}`}>Assign machine</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AsyncBoundary>
    </Tile>
  );
}
