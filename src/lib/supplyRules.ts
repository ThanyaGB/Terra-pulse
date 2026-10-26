import type { BuyerClaim, ReceiptInput, SupplyOffer, SupplyOfferStatus, VerificationResult, WeighbridgeReceipt } from '@/api/contract';

/** An offer as the store keeps it. Its status is derived from claims and receipts on every read. */
export type StoredOffer = Omit<SupplyOffer, 'status'>;
/** A claim as the store keeps it. The receipt is joined on read. */
export type StoredClaim = Omit<BuyerClaim, 'receipt'>;
/** The buyer-facing receipt plus the checks the platform ran on it when it was recorded. */
export interface ReceiptRecord extends WeighbridgeReceipt {
  firmsNoFire: 'pass' | 'fail';
  spotCheck: 'pending' | 'not_selected';
  reconciliation: 'matched' | 'mismatch';
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Tonnes still open on an offer after the given claims. */
export function remainingTonnes(offer: Pick<StoredOffer, 'expectedTonnes'>, claims: Pick<StoredClaim, 'claimedTonnes'>[]): number {
  const claimed = claims.reduce((n, c) => n + c.claimedTonnes, 0);
  return Math.max(0, round2(offer.expectedTonnes - claimed));
}

/** Why a claim cannot be taken, with the HTTP-style code the mock returns. `null` means the claim is allowed. */
export function claimProblem(
  offer: Pick<StoredOffer, 'expectedTonnes'> & { status: SupplyOfferStatus },
  claims: Pick<StoredClaim, 'claimedTonnes'>[],
  tonnes: number,
): { code: 409 | 422; message: string } | null {
  if (!Number.isFinite(tonnes) || tonnes <= 0) return { code: 422, message: 'Enter a tonnage above zero' };
  if (offer.status === 'disputed') return { code: 409, message: 'This offer is in dispute and takes no new claims' };
  const remaining = remainingTonnes(offer, claims);
  if (tonnes > remaining + 1e-9) return { code: 409, message: `Only ${remaining.toFixed(2)} t remain on this offer` };
  return null;
}

/** Why a receipt cannot be recorded, or `null` when the weights and photo are usable. */
export function receiptProblem(input: ReceiptInput): string | null {
  if (!Number.isFinite(input.grossKg) || !Number.isFinite(input.tareKg)) return 'Enter the gross and tare weights';
  if (input.tareKg <= 0) return 'Tare must be above zero';
  if (input.grossKg <= input.tareKg) return 'Gross weight must be more than the tare';
  if (!input.photoRef) return 'Attach the weighbridge slip photo';
  return null;
}

/** Weighbridge net weight in kilograms. */
export const netKgFor = (input: Pick<ReceiptInput, 'grossKg' | 'tareKg'>): number => Math.round(input.grossKg - input.tareKg);

/** Net against claimed tonnes, inside the tolerance (inclusive). */
export function reconcile(claimedTonnes: number, netKg: number, tolerancePct: number): 'matched' | 'mismatch' {
  const allowed = claimedTonnes * (tolerancePct / 100);
  return Math.abs(netKg / 1000 - claimedTonnes) <= allowed + 1e-9 ? 'matched' : 'mismatch';
}

/** The platform's checks on one receipt. The buyer never supplies these. */
export function buildReceipt(args: {
  id: string;
  claim: StoredClaim;
  input: ReceiptInput;
  enteredAt: string;
  firmsDetections: number;
  spotChecked: boolean;
  tolerancePct: number;
}): ReceiptRecord {
  const netKg = netKgFor(args.input);
  return {
    id: args.id,
    claimId: args.claim.id,
    grossKg: args.input.grossKg,
    netKg,
    qualityGrade: args.input.qualityGrade,
    photoRef: args.input.photoRef,
    enteredAt: args.enteredAt,
    firmsNoFire: args.firmsDetections === 0 ? 'pass' : 'fail',
    spotCheck: args.spotChecked ? 'pending' : 'not_selected',
    reconciliation: reconcile(args.claim.claimedTonnes, netKg, args.tolerancePct),
  };
}

/** Verification for one offer, computed from its claims and their receipts. */
export function verificationFor(offerId: string, claims: StoredClaim[], receipts: ReceiptRecord[]): VerificationResult {
  const hasReceipt = (c: StoredClaim) => receipts.some((r) => r.claimId === c.id);
  const firmsNoFire: VerificationResult['firmsNoFire'] = receipts.length === 0 ? 'pending' : receipts.some((r) => r.firmsNoFire === 'fail') ? 'fail' : 'pass';
  const reconciliation: VerificationResult['reconciliation'] = receipts.length === 0
    ? 'pending'
    : receipts.some((r) => r.reconciliation === 'mismatch') ? 'mismatch'
      : claims.length > 0 && claims.every(hasReceipt) ? 'matched' : 'pending';
  const spotCheck: VerificationResult['spotCheck'] = receipts.length === 0 || receipts.some((r) => r.spotCheck === 'pending') ? 'pending' : 'not_selected';
  return {
    offerId,
    firmsNoFire,
    spotCheck,
    reconciliation,
    paymentStatus: firmsNoFire === 'pass' && reconciliation === 'matched' ? 'released' : 'held',
    computedBy: 'platform',
  };
}

/**
 * Offer status from its claims and receipts.
 * open → claimed (first claim) → collected (whole window claimed and every claim weighed in).
 * Any receipt outside tolerance sends the offer to disputed, which takes no further claims.
 */
export function offerStatusFor(offer: StoredOffer, claims: StoredClaim[], receipts: ReceiptRecord[]): SupplyOfferStatus {
  if (receipts.some((r) => r.reconciliation === 'mismatch')) return 'disputed';
  if (claims.length === 0) return 'open';
  const allWeighed = claims.every((c) => receipts.some((r) => r.claimId === c.id));
  return remainingTonnes(offer, claims) <= 0 && allWeighed ? 'collected' : 'claimed';
}

/** Everything the UI needs about one offer, from the full claim and receipt lists. */
export function offerState(offer: StoredOffer, allClaims: StoredClaim[], allReceipts: ReceiptRecord[]) {
  const claims = allClaims.filter((c) => c.offerId === offer.id);
  const receipts = allReceipts.filter((r) => claims.some((c) => c.id === r.claimId));
  return {
    claims,
    receipts,
    status: offerStatusFor(offer, claims, receipts),
    remaining: remainingTonnes(offer, claims),
    verification: verificationFor(offer.id, claims, receipts),
  };
}
