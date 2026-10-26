import { useMemo, useState } from 'react';
import type { BuyerClaim, SupplyOffer } from '@/api/contract';
import type { AsyncState } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { Tag, Tile } from '@/design/Tile';
import { SkeletonBlock } from '@/design/Skeleton';
import { formatDate, formatNumber } from '@/lib/format';
import { RISK_TIERS, type SortDir } from '@/lib/risk';
import { villageLabelOf } from '@/lib/supplyConfig';
import { remainingTonnes } from '@/lib/supplyRules';
import { OFFER_STATUS } from './status';

type SortKey = 'village' | 'expected' | 'open' | 'window' | 'risk' | 'status';

const COLS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'village', label: 'Village' },
  { key: 'expected', label: 'Expected (t)', align: 'right' },
  { key: 'open', label: 'Open (t)', align: 'right' },
  { key: 'window', label: 'Window' },
  { key: 'risk', label: 'Fire risk' },
  { key: 'status', label: 'Status' },
];

interface Props {
  state: AsyncState<SupplyOffer[]>;
  onRetry: () => void;
  claims: BuyerClaim[];
  onClaim: (offer: SupplyOffer, open: number) => void;
  scoped: boolean;
}

/** Offers a buyer can claim. Village and parcel group only: no farmer names or phone numbers. */
export function OffersTable({ state, onRetry, claims, onClaim, scoped }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'risk', dir: 'desc' });

  const rows = useMemo(() => {
    if (state.status !== 'success') return [];
    const withOpen = state.data.map((o) => ({
      o,
      open: remainingTonnes(o, claims.filter((c) => c.offerId === o.id)),
    }));
    const value = (r: (typeof withOpen)[number], key: SortKey): number | string => {
      switch (key) {
        case 'village': return villageLabelOf(r.o.villageId);
        case 'expected': return r.o.expectedTonnes;
        case 'open': return r.open;
        case 'window': return r.o.windowEnd;
        case 'risk': return RISK_TIERS.findIndex((t) => t.id === r.o.riskTier);
        case 'status': return r.o.status;
      }
    };
    return withOpen.sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.dir === 'asc' ? c : -c;
    });
  }, [state, claims, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'village' || key === 'status' ? 'asc' : 'desc' }));
  }

  return (
    <Tile id="offers" title="Supply offers" aside={<Tag>Village and parcel group only</Tag>} className="flex min-h-0 flex-col">
      <AsyncBoundary
        state={state}
        onRetry={onRetry}
        what="the supply offers"
        skeleton={<SkeletonBlock rows={6} label="Loading supply offers" />}
        isEmpty={(d) => d.length === 0}
        empty={scoped ? 'No supply offers in these villages yet.' : 'No supply offers are open right now.'}
      >
        {() => (
          <div className="max-h-[560px] overflow-auto rounded-2xl border border-line">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <caption className="sr-only">Straw supply offers. Sort by a column heading, then claim an open offer.</caption>
              <thead className="sticky top-0 z-10 bg-air-50 text-left text-ink-soft">
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}>
                      <button type="button" className="inline-flex min-h-9 items-center gap-1 font-semibold" onClick={() => toggleSort(c.key)}>
                        {c.label}<span aria-hidden="true" className="text-xs">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-ink-soft">No offers match this view.</td></tr>
                )}
                {rows.map(({ o, open }) => {
                  const tier = RISK_TIERS.find((t) => t.id === o.riskTier) ?? RISK_TIERS[0]!;
                  const st = OFFER_STATUS[o.status];
                  const village = villageLabelOf(o.villageId);
                  const canClaim = open > 0 && o.status !== 'disputed';
                  return (
                    <tr key={o.id} className="border-t border-line" data-testid="offer-row">
                      <th scope="row" className="px-3 py-2 text-left">
                        <div className="font-semibold">{village}</div>
                        <div className="mono text-[11px] font-normal text-ink-mute">{o.parcelGroupId} · {o.id}</div>
                      </th>
                      <td className="mono px-3 py-2 text-right">{formatNumber(o.expectedTonnes, 1)}</td>
                      <td className="mono px-3 py-2 text-right">{formatNumber(open, 1)}</td>
                      <td className="mono px-3 py-2 text-xs">{formatDate(o.windowStart)} – {formatDate(o.windowEnd)}</td>
                      <td className="px-3 py-2">
                        <span className="chip" style={{ background: tier.bg, color: tier.fg }}>{tier.label}</span>
                      </td>
                      <td className="px-3 py-2"><span className="chip" style={{ background: st.bg, color: st.fg }}>{st.label}</span></td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="btn btn-primary !min-h-10"
                          disabled={!canClaim}
                          onClick={() => onClaim(o, open)}
                          aria-label={`Claim straw from ${village}, ${o.parcelGroupId}`}
                        >
                          Claim
                        </button>
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
