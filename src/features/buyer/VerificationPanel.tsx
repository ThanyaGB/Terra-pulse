import { useEffect } from 'react';
import { api } from '@/api/client';
import type { VerificationResult } from '@/api/contract';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { Tag, Tile } from '@/design/Tile';
import { subscribeSupply } from '@/lib/supply';
import { SUPPLY_CONFIG } from '@/lib/supplyConfig';
import { CHECK_TONE } from './status';

type Tone = keyof typeof CHECK_TONE;
interface Check { word: string; text: string; tone: Tone }

/** Plain labels for each platform check. Payment always carries its reason for being held. */
function describe(v: VerificationResult) {
  const tol = SUPPLY_CONFIG.tolerancePct;
  const firms: Check = v.firmsNoFire === 'pass'
    ? { word: 'Pass', text: 'No fire detected on the parcel group in the collection window', tone: 'good' }
    : v.firmsNoFire === 'fail'
      ? { word: 'Fail', text: 'Fire detected on the parcel group in the window', tone: 'bad' }
      : { word: 'Pending', text: 'Waiting for the satellite pass', tone: 'wait' };
  const spot: Check = v.spotCheck === 'pass'
    ? { word: 'Pass', text: 'Physical spot check passed', tone: 'good' }
    : v.spotCheck === 'fail'
      ? { word: 'Fail', text: 'Physical spot check failed', tone: 'bad' }
      : v.spotCheck === 'not_selected'
        ? { word: 'Not selected', text: 'Not picked for a physical spot check', tone: 'wait' }
        : { word: 'Pending', text: 'Spot check not yet scheduled', tone: 'wait' };
  const recon: Check = v.reconciliation === 'matched'
    ? { word: 'Matched', text: `Net weight within ±${tol}% of the claimed tonnes`, tone: 'good' }
    : v.reconciliation === 'mismatch'
      ? { word: 'Mismatch', text: `Net weight is more than ±${tol}% away from the claim`, tone: 'bad' }
      : { word: 'Pending', text: 'Waiting for every claim to be weighed in', tone: 'wait' };
  const payment: Check = v.paymentStatus === 'released'
    ? { word: 'Released', text: 'Both checks passed', tone: 'good' }
    : { word: 'Held until verified', text: 'Released only when reconciliation matches and the fire check passes', tone: 'hold' };
  return { firms, spot, recon, payment };
}

/** Platform verification for one offer. Read-only: the buyer cannot change any of these results. */
export function VerificationPanel({ offerId }: { offerId: string }) {
  const v = useAsync(() => api.getVerification(offerId), [offerId]);
  useEffect(() => subscribeSupply(v.refresh), [v.refresh]);
  return (
    <Tile id="verification" title="Verification" aside={<Tag>Run by the platform</Tag>}>
      <AsyncBoundary state={v} onRetry={v.reload} what="the verification result">
        {(r) => {
          const d = describe(r);
          const rows = [
            { key: 'firms', label: 'NASA FIRMS no-fire check', check: d.firms },
            { key: 'spot', label: 'Spot check', check: d.spot },
            { key: 'recon', label: 'Weighbridge reconciliation', check: d.recon },
          ];
          return (
            <div className="flex flex-col gap-3">
              <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Verification checks">
                {rows.map(({ key, label, check }) => (
                  <li key={key} className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-air-50 px-3 py-2" data-testid={`check-${key}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{label}</div>
                      <div className="text-xs text-ink-soft">{check.text}</div>
                    </div>
                    <span className="chip shrink-0" style={{ background: CHECK_TONE[check.tone].bg, color: CHECK_TONE[check.tone].fg }}>{check.word}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2" data-testid="payment-status">
                <div>
                  <div className="text-sm font-semibold">Payment</div>
                  <div className="text-xs text-ink-soft">{d.payment.text}</div>
                </div>
                <span className="chip" style={{ background: CHECK_TONE[d.payment.tone].bg, color: CHECK_TONE[d.payment.tone].fg }}>{d.payment.word}</span>
              </div>
              <p className="m-0 text-xs text-ink-mute">Source: NASA FIRMS fire detections and the weighbridge receipt. Simulated data. Computed by the platform; the buyer cannot change these results.</p>
            </div>
          );
        }}
      </AsyncBoundary>
    </Tile>
  );
}
