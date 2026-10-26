import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import type { BuyerClaim, SupplyOffer, SupplySummary } from '@/api/contract';
import { useAsync } from '@/hooks/useAsync';
import { ApiModeToggle } from '@/design/ApiModeToggle';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { ConfirmDialog } from '@/design/ConfirmDialog';
import { OfflineBanner } from '@/design/OfflineBanner';
import { PageShell } from '@/design/PageShell';
import { Tag, Tile } from '@/design/Tile';
import { useToast } from '@/design/Toast';
import { formatDate, formatInr, formatNumber } from '@/lib/format';
import { subscribeSupply } from '@/lib/supply';
import { SUPPLY_CONFIG, villageLabelOf } from '@/lib/supplyConfig';
import { round2 } from '@/lib/supplyRules';
import { OffersTable } from './OffersTable';
import { ReceiptForm } from './ReceiptForm';
import { VerificationPanel } from './VerificationPanel';
import { OFFER_STATUS } from './status';

/** Claims made in this demo, the receipts still to weigh in, and the platform's view of each. */
export default function BuyerPage() {
  const [params] = useSearchParams();
  const villageParam = params.get('villages') ?? '';
  const villageIds = useMemo(() => villageParam.split(',').filter(Boolean), [villageParam]);
  const scoped = villageIds.length > 0;
  const scopeKey = villageIds.join(',');

  const offers = useAsync(() => api.listSupplyOffers(scoped ? { villageIds } : undefined), [scopeKey]);
  const claims = useAsync(() => api.listBuyerClaims(SUPPLY_CONFIG.buyerId), []);
  const summary = useAsync(() => api.getSupplySummary(scoped ? villageIds : undefined), [scopeKey]);
  const { toast } = useToast();

  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [claimTarget, setClaimTarget] = useState<{ offer: SupplyOffer; open: number } | null>(null);
  const [tonnesText, setTonnesText] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => subscribeSupply(() => { offers.refresh(); claims.refresh(); summary.refresh(); }), [offers.refresh, claims.refresh, summary.refresh]);

  const claimList: BuyerClaim[] = claims.status === 'success' ? claims.data : [];
  const selectedClaim = claimList.find((c) => c.id === selectedClaimId) ?? null;
  const villageOf = (offerId: string) => (offers.status === 'success' ? offers.data.find((o) => o.id === offerId)?.villageId : undefined);

  function openClaim(offer: SupplyOffer, open: number) {
    setClaimError(null);
    setTonnesText(String(round2(open)));
    setClaimTarget({ offer, open });
  }

  const tonnes = Number(tonnesText);
  const tonnesProblem = claimTarget === null ? null
    : tonnesText.trim() === '' || !Number.isFinite(tonnes) ? 'Enter the tonnes to claim'
      : tonnes <= 0 ? 'Enter a tonnage above zero'
        : tonnes > claimTarget.open + 1e-9 ? `Only ${formatNumber(claimTarget.open, 2)} t remain on this offer`
          : null;

  async function confirmClaim() {
    if (!claimTarget || tonnesProblem) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const claim = await api.claimSupplyOffer(claimTarget.offer.id, tonnes);
      toast(`Claimed ${formatNumber(claim.claimedTonnes, 2)} t from ${villageLabelOf(claimTarget.offer.villageId)}. Weigh it in at the gate.`, 'success');
      setSelectedClaimId(claim.id);
      setClaimTarget(null);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'The claim was not recorded. Nothing has changed.');
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="theme-command">
      <OfflineBanner />
      <PageShell
        code="BUYER · STRAW OFFTAKE DESK"
        title="Straw supply desk"
        aside={<>
          <Tag>{scoped ? `${villageIds.length} villages · filtered` : 'All pilot villages'} · simulated data</Tag>
          {scoped && <Link to="/buyer" className="btn btn-ghost !min-h-9">Show all villages</Link>}
          <ApiModeToggle />
          <Link to="/fpo" className="btn btn-ghost !min-h-9">FPO console</Link>
        </>}
      >
        <AsyncBoundary state={summary} onRetry={summary.reload} what="the supply figures" skeleton={<div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">{[0, 1, 2, 3].map((i) => <div key={i} className="tile h-[88px] animate-pulse !p-4" />)}</div>}>
          {(s: SupplySummary) => (
            <dl className="m-0 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Straw supply summary">
              <div className="tile !p-4"><dd className="m-0 mono text-2xl font-bold" data-testid="kpi-open">{formatNumber(s.openTonnes, 1)} t</dd><dt className="text-xs text-ink-soft">open tonnes</dt></div>
              <div className="tile !p-4"><dd className="m-0 mono text-2xl font-bold" data-testid="kpi-claimed">{formatNumber(s.claimedTonnes, 1)} t</dd><dt className="text-xs text-ink-soft">claimed tonnes</dt></div>
              <div className="tile !p-4"><dd className="m-0 mono text-2xl font-bold text-leaf-700" data-testid="kpi-collected">{formatNumber(s.collectedTonnes, 1)} t</dd><dt className="text-xs text-ink-soft">collected tonnes</dt></div>
              <div className="tile !p-4"><dd className="m-0 mono text-2xl font-bold" data-testid="kpi-held">{formatInr(s.heldPaymentsInr)}</dd><dt className="text-xs text-ink-soft">held payments, held until verified</dt></div>
            </dl>
          )}
        </AsyncBoundary>

        <div className="grid items-start gap-4 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <OffersTable
              state={offers}
              onRetry={offers.reload}
              claims={claimList}
              onClaim={openClaim}
              scoped={scoped}
            />
          </div>
          <div className="flex flex-col gap-4 lg:col-span-4">
            <Tile id="claims" title="Your claims" aside={<Tag>{claims.status === 'success' ? claimList.length : '—'} claims</Tag>}>
              <AsyncBoundary
                state={claims}
                onRetry={claims.reload}
                what="your claims"
                isEmpty={(d) => d.length === 0}
                empty="No claims yet. Claim an open offer to start a delivery."
              >
                {(list) => (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {list.map((c) => {
                      const village = villageOf(c.offerId);
                      const active = c.id === selectedClaimId;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => setSelectedClaimId(c.id)}
                            className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm"
                            style={{ background: active ? 'var(--color-sel)' : 'var(--color-air-50)' }}
                          >
                            <span><b>{village ? villageLabelOf(village) : c.offerId}</b> · <span className="mono">{formatNumber(c.claimedTonnes, 2)} t</span></span>
                            <span className="chip" style={c.receipt ? { background: '#E3F8EE', color: '#0B5C3E' } : { background: '#FFF1E6', color: '#8A4B0F' }}>
                              {c.receipt ? 'Weighed in' : 'Awaiting receipt'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </AsyncBoundary>
            </Tile>

            <Tile id="receipt" title="Weighbridge receipt" aside={selectedClaim && <Tag>{formatDate(selectedClaim.claimedAt)}</Tag>}>
              {!selectedClaim && <p className="m-0 text-sm text-ink-soft">Select a claim to record its weighbridge receipt.</p>}
              {selectedClaim && !selectedClaim.receipt && (
                <ReceiptForm claim={selectedClaim} onRecorded={() => { claims.refresh(); summary.refresh(); }} />
              )}
              {selectedClaim?.receipt && (
                <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-ink-soft">Receipt</dt><dd className="m-0 mono">{selectedClaim.receipt.id}</dd></div>
                  <div><dt className="text-xs text-ink-soft">Net weight</dt><dd className="m-0 mono">{formatNumber(selectedClaim.receipt.netKg / 1000, 2)} t</dd></div>
                  <div><dt className="text-xs text-ink-soft">Grade</dt><dd className="m-0">{selectedClaim.receipt.qualityGrade}</dd></div>
                  <div><dt className="text-xs text-ink-soft">Entered</dt><dd className="m-0 mono">{formatDate(selectedClaim.receipt.enteredAt)}</dd></div>
                  <p className="col-span-2 m-0 text-xs text-ink-mute">Recorded. Verification below shows the platform checks.</p>
                </dl>
              )}
            </Tile>

            {selectedClaim && <VerificationPanel offerId={selectedClaim.offerId} />}
          </div>
        </div>

        <p className="m-0 text-xs text-ink-mute">
          Open tonnes are offer tonnes not yet claimed. Figures are simulated, and checked against NASA FIRMS fire data and weighbridge receipts.
        </p>
      </PageShell>

      <ConfirmDialog
        open={claimTarget !== null}
        title={claimTarget ? `Claim straw from ${villageLabelOf(claimTarget.offer.villageId)}` : 'Claim straw'}
        confirmLabel="Confirm claim"
        busy={claiming}
        confirmDisabled={tonnesProblem !== null}
        onConfirm={confirmClaim}
        onCancel={() => setClaimTarget(null)}
      >
        {claimTarget && (
          <div className="flex flex-col gap-3">
            <dl className="m-0 grid grid-cols-2 gap-3">
              <div><dt className="text-xs font-bold uppercase tracking-wide text-ink-mute">Parcel group</dt><dd className="m-0 mono">{claimTarget.offer.parcelGroupId}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wide text-ink-mute">Window</dt><dd className="m-0 mono">{formatDate(claimTarget.offer.windowStart)} – {formatDate(claimTarget.offer.windowEnd)}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wide text-ink-mute">Open tonnes</dt><dd className="m-0 mono">{formatNumber(claimTarget.open, 2)} t</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wide text-ink-mute">Status</dt><dd className="m-0"><span className="chip" style={{ background: OFFER_STATUS[claimTarget.offer.status].bg, color: OFFER_STATUS[claimTarget.offer.status].fg }}>{OFFER_STATUS[claimTarget.offer.status].label}</span></dd></div>
            </dl>
            <label htmlFor="claim-tonnes" className="text-xs font-bold uppercase tracking-wide text-ink-mute">Tonnes to claim</label>
            <input
              id="claim-tonnes"
              type="number"
              step="0.1"
              min={0}
              max={claimTarget.open}
              className="field mono"
              value={tonnesText}
              onChange={(e) => setTonnesText(e.target.value)}
            />
            {tonnesProblem && <p role="alert" className="m-0 text-xs font-semibold text-warn-fg">{tonnesProblem}</p>}
            {claimError && <p role="alert" className="m-0 font-semibold text-danger">{claimError}</p>}
            <p className="m-0 rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn-fg">
              This claim is recorded once you confirm. Payment is held until the weighbridge receipt is verified against the satellite check.
            </p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
