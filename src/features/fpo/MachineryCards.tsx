import type { MachineryStatus } from '@/api/contract';
import type { AsyncState } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { Tag, Tile } from '@/design/Tile';
import { formatInr, formatNumber } from '@/lib/format';
import type { BiomassStatus } from '@/api/contract';

function tone(pct: number): string {
  return pct >= 90 ? '#B45309' : pct >= 60 ? '#0F6FB8' : '#0B7A53';
}

export function MachineryCards({ state, onRetry }: { state: AsyncState<MachineryStatus[]> & { reload: () => void }; onRetry: () => void }) {
  return (
    <AsyncBoundary state={state} onRetry={onRetry} what="machinery status" isEmpty={(d) => d.length === 0} empty="No machinery registered for this cluster yet.">
      {(list) => (
        <div className="grid gap-4 sm:grid-cols-3">
          {list.map((m) => {
            const pct = Math.round((m.inUse / m.total) * 100);
            return (
              <Tile key={m.type} label={m.label}>
                <div className="flex items-center gap-4">
                  <div role="progressbar" aria-label={`${m.label} utilisation`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="relative h-[84px] w-[84px] shrink-0">
                    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
                      <circle cx="42" cy="42" r="34" fill="none" className="stroke-track" strokeWidth="9" />
                      <circle cx="42" cy="42" r="34" fill="none" stroke={tone(pct)} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 213.6} 213.6`} transform="rotate(-90 42 42)" style={{ transition: 'stroke-dasharray 600ms cubic-bezier(.22,1,.36,1)' }} />
                    </svg>
                    <span className="mono absolute inset-0 flex items-center justify-center text-lg font-bold" style={{ color: tone(pct) }}>{pct}%</span>
                  </div>
                  <div>
                    <h2 className="h capitalize">{m.label}</h2>
                    <div className="mt-1 text-sm text-ink-soft"><b className="mono text-ink">{m.inUse}</b> in use of <b className="mono text-ink">{m.total}</b> · <b className="mono text-ink">{m.total - m.inUse}</b> free</div>
                  </div>
                </div>
              </Tile>
            );
          })}
        </div>
      )}
    </AsyncBoundary>
  );
}

export const TRUCK_TONNES = 8;
/** Demo rule: 1 eco-credit per tonne of straw removed, valued at the Bio-CNG floor price. */
export const CREDIT_PER_TONNE = 1;

export function BiomassCard({ state, onRetry, extraTrucks, onAddTruck }: { state: AsyncState<BiomassStatus>; onRetry: () => void; extraTrucks: number; onAddTruck: () => void }) {
  return (
    <Tile dark title="Biomass purchase" aside={<Tag color="#8FD3FF">Example partner</Tag>} className="h-full">
      <AsyncBoundary state={state} onRetry={onRetry} what="biomass purchase figures">
        {(b) => (
          <div className="flex flex-col gap-3">
            <div className="text-xs text-[#C9DDF0]">{b.plant} · current Bio-CNG floor price</div>
            <div><span className="mono text-3xl font-bold text-white">{formatInr(b.floorPriceInrPerTonne)}</span><span className="ml-1 text-sm text-[#C9DDF0]">/tonne</span></div>
            <dl className="m-0 grid grid-cols-3 gap-3">
              <div><dd className="m-0 mono text-2xl font-bold text-[#34D399]">{formatNumber(b.tonnesRemovedToday + extraTrucks * TRUCK_TONNES, 1)}</dd><dt className="text-[11px] text-[#C9DDF0]">tonnes removed today</dt></div>
              <div><dd className="m-0 mono text-2xl font-bold text-white">{formatNumber(b.cumulativeAcres)}</dd><dt className="text-[11px] text-[#C9DDF0]">acres served (total)</dt></div>
              <div><dd className="m-0 mono text-2xl font-bold text-white">{b.trucksToday + extraTrucks}</dd><dt className="text-[11px] text-[#C9DDF0]">trucks today</dt></div>
            </dl>
            <button type="button" className="btn !min-h-10 self-start !bg-white/15 !text-white" onClick={onAddTruck}>+ Truck (+{TRUCK_TONNES} t)</button>
          </div>
        )}
      </AsyncBoundary>
    </Tile>
  );
}

export function EcoCreditsTile({ state, extraTrucks }: { state: AsyncState<BiomassStatus>; extraTrucks: number }) {
  return (
    <Tile title="Eco-credits" aside={<Tag>Demo rule</Tag>}>
      <AsyncBoundary state={state} onRetry={() => undefined} what="eco-credits">
        {(b) => {
          const tonnes = b.tonnesRemovedToday + extraTrucks * TRUCK_TONNES;
          const credits = Math.round(tonnes * CREDIT_PER_TONNE);
          return (
            <div className="flex flex-col gap-1">
              <div><span className="mono text-3xl font-bold text-leaf-700" aria-live="polite">{formatNumber(credits)}</span> <span className="text-sm text-ink-soft">credits today</span></div>
              <div className="mono text-xs text-ink-soft">{formatNumber(tonnes, 1)} t × {CREDIT_PER_TONNE} credit/t = {formatNumber(credits)} credits ≈ {formatInr(Math.round(tonnes * b.floorPriceInrPerTonne))}</div>
              <p className="m-0 mt-1 text-xs text-ink-mute">Illustrative formula for the prototype. The real credit scheme is not defined in the brief.</p>
            </div>
          );
        }}
      </AsyncBoundary>
    </Tile>
  );
}
