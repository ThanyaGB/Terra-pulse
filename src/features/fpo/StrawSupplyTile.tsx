import { Link } from 'react-router-dom';
import type { SupplySummary } from '@/api/contract';
import type { AsyncState } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { Tag, Tile } from '@/design/Tile';
import { formatInr, formatNumber } from '@/lib/format';
import { villageIdOf } from '@/lib/supplyConfig';

/** Buyer offtake at a glance. Shows volumes and verification only: no farmer-facing rates. */
export function StrawSupplyTile({ state, onRetry, villages }: { state: AsyncState<SupplySummary>; onRetry: () => void; villages: string[] }) {
  const to = villages.length > 0 ? `/buyer?villages=${villages.map(villageIdOf).join(',')}` : '/buyer';
  return (
    <Tile title="Straw supply" aside={<Tag>Buyer offtake</Tag>} className="h-full">
      <AsyncBoundary state={state} onRetry={onRetry} what="straw supply figures">
        {(s) => (
          <div className="flex flex-col gap-3">
            <dl className="m-0 grid grid-cols-2 gap-3">
              <div><dd className="m-0 mono text-2xl font-bold" data-testid="straw-open">{formatNumber(s.openTonnes, 1)} t</dd><dt className="text-xs text-ink-soft">open in pilot villages</dt></div>
              <div><dd className="m-0 mono text-2xl font-bold" data-testid="straw-claimed">{formatNumber(s.claimedTonnes, 1)} t</dd><dt className="text-xs text-ink-soft">claimed by buyers</dt></div>
              <div><dd className="m-0 mono text-2xl font-bold text-leaf-700" data-testid="straw-collected">{formatNumber(s.collectedTonnes, 1)} t</dd><dt className="text-xs text-ink-soft">collected at weighbridge</dt></div>
              <div><dd className="m-0 mono text-2xl font-bold" data-testid="straw-awaiting">{formatNumber(s.awaitingVerification)}</dd><dt className="text-xs text-ink-soft">receipts awaiting verification</dt></div>
            </dl>
            <p className="m-0 text-xs text-ink-soft">Payments held until verified: <b className="mono text-ink">{formatInr(s.heldPaymentsInr)}</b></p>
            <Link to={to} className="btn btn-ghost !min-h-10 self-start">Open buyer desk</Link>
            <p className="m-0 text-xs text-ink-mute">Simulated. Checked against NASA FIRMS fire data and weighbridge receipts.</p>
          </div>
        )}
      </AsyncBoundary>
    </Tile>
  );
}
