import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReceiptInput } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { createMockApi } from '@/api/mock/mockApi';
import { getClaims, getOffers, getReceipts, resetSupply, saveClaims, saveOffers, subscribeSupply, SUPPLY_EVENT } from '@/lib/supply';
import { SUPPLY_CONFIG } from '@/lib/supplyConfig';
import {
  buildReceipt, claimProblem, netKgFor, offerState, reconcile, receiptProblem, remainingTonnes, verificationFor,
  type ReceiptRecord, type StoredClaim, type StoredOffer,
} from '@/lib/supplyRules';

const offer = (over: Partial<StoredOffer> = {}): StoredOffer => ({
  id: 'SO-T', villageId: 'moonak', parcelGroupId: 'PG-MOO', expectedTonnes: 12,
  windowStart: '2026-10-26T00:00:00.000Z', windowEnd: '2026-10-28T00:00:00.000Z', riskTier: 'critical', ...over,
});
const claim = (over: Partial<StoredClaim> = {}): StoredClaim => ({
  id: 'BC-T', offerId: 'SO-T', buyerId: SUPPLY_CONFIG.buyerId, claimedTonnes: 12, claimedAt: '2026-10-26T01:00:00.000Z', contractId: 'CT-T', ...over,
});
const input = (grossKg: number, tareKg: number): ReceiptInput => ({ grossKg, tareKg, qualityGrade: 'B', photoRef: 'demo://slip' });
const receipt = (c: StoredClaim, i: ReceiptInput, firmsDetections = 0, spotChecked = false): ReceiptRecord => buildReceipt({
  id: 'WR-T', claim: c, input: i, enteredAt: '2026-10-26T02:00:00.000Z', firmsDetections, spotChecked, tolerancePct: SUPPLY_CONFIG.tolerancePct,
});

describe('claim tonnage limit', () => {
  it('subtracts claimed tonnes from the expected tonnes', () => {
    expect(remainingTonnes(offer({ expectedTonnes: 12 }), [claim({ claimedTonnes: 5 })])).toBe(7);
  });
  it('allows a claim up to exactly the remaining tonnes', () => {
    expect(claimProblem({ ...offer(), status: 'claimed' }, [claim({ claimedTonnes: 5 })], 7)).toBeNull();
  });
  it('rejects a claim above the remaining tonnes with 409', () => {
    expect(claimProblem({ ...offer(), status: 'claimed' }, [claim({ claimedTonnes: 5 })], 7.5)).toMatchObject({ code: 409 });
  });
  it('rejects zero, negative and non-numeric tonnage with 422', () => {
    expect(claimProblem({ ...offer(), status: 'open' }, [], 0)).toMatchObject({ code: 422 });
    expect(claimProblem({ ...offer(), status: 'open' }, [], -3)).toMatchObject({ code: 422 });
    expect(claimProblem({ ...offer(), status: 'open' }, [], Number.NaN)).toMatchObject({ code: 422 });
  });
  it('takes no new claims on a disputed offer', () => {
    expect(claimProblem({ ...offer(), status: 'disputed' }, [], 1)).toMatchObject({ code: 409 });
  });
});

describe('weighbridge reconciliation', () => {
  it('converts gross minus tare into net kilograms', () => {
    expect(netKgFor(input(24300, 9800))).toBe(14500);
  });
  it('matches a net within the tolerance, boundary included', () => {
    expect(reconcile(14, 14500, 10)).toBe('matched');
    expect(reconcile(12, 13200, 10)).toBe('matched');
  });
  it('flags a net outside the tolerance as a mismatch', () => {
    expect(reconcile(18, 12000, 10)).toBe('mismatch');
    expect(reconcile(12, 10000, 10)).toBe('mismatch');
  });
  it('explains a receipt that cannot be saved', () => {
    expect(receiptProblem(input(9000, 9000))).toMatch(/more than the tare/);
    expect(receiptProblem({ ...input(21000, 9000), photoRef: '' })).toMatch(/photo/);
    expect(receiptProblem(input(21000, 9000))).toBeNull();
  });
});

describe('payment hold rule', () => {
  it('holds payment while no receipt exists', () => {
    const v = verificationFor('SO-T', [claim()], []);
    expect(v).toMatchObject({ firmsNoFire: 'pending', reconciliation: 'pending', paymentStatus: 'held' });
  });
  it('releases payment only when the fire check passes and the net matches', () => {
    const v = verificationFor('SO-T', [claim({ claimedTonnes: 12 })], [receipt(claim({ claimedTonnes: 12 }), input(21000, 9000))]);
    expect(v).toMatchObject({ firmsNoFire: 'pass', reconciliation: 'matched', paymentStatus: 'released' });
  });
  it('keeps payment held when a fire is detected, even if the net matches', () => {
    const c = claim({ claimedTonnes: 12 });
    const v = verificationFor('SO-T', [c], [receipt(c, input(21000, 9000), 2)]);
    expect(v).toMatchObject({ firmsNoFire: 'fail', reconciliation: 'matched', paymentStatus: 'held' });
  });
  it('keeps payment held on a mismatch', () => {
    const c = claim({ claimedTonnes: 18 });
    const v = verificationFor('SO-T', [c], [receipt(c, input(21000, 9000))]);
    expect(v).toMatchObject({ reconciliation: 'mismatch', paymentStatus: 'held' });
  });
  it('is always computed by the platform', () => {
    expect(verificationFor('SO-T', [], []).computedBy).toBe('platform');
  });
});

describe('offer status transitions', () => {
  const c = claim({ claimedTonnes: 12 });
  it('open with no claims', () => {
    expect(offerState(offer(), [], []).status).toBe('open');
  });
  it('open → claimed on a claim, before any receipt', () => {
    expect(offerState(offer(), [c], []).status).toBe('claimed');
  });
  it('claimed → collected once the whole window is claimed and weighed in', () => {
    expect(offerState(offer(), [c], [receipt(c, input(21000, 9000))]).status).toBe('collected');
  });
  it('a partial claim stays claimed even after its receipt', () => {
    const partial = claim({ claimedTonnes: 5 });
    expect(offerState(offer(), [partial], [receipt(partial, input(6000, 1000))]).status).toBe('claimed');
  });
  it('disputed when a receipt falls outside tolerance', () => {
    const bad = claim({ claimedTonnes: 18 });
    expect(offerState(offer({ expectedTonnes: 18 }), [bad], [receipt(bad, input(21000, 9000))]).status).toBe('disputed');
  });
});

describe('supply store and events', () => {
  beforeEach(() => { resetSupply(); });

  it('dispatches the vayuswachh:supply event on save', () => {
    const spy = vi.fn();
    window.addEventListener(SUPPLY_EVENT, spy);
    saveOffers(getOffers());
    window.removeEventListener(SUPPLY_EVENT, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('calls subscribers until they unsubscribe', () => {
    const fn = vi.fn();
    const off = subscribeSupply(fn);
    saveClaims(getClaims());
    off();
    saveClaims(getClaims());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stores under the vayuswachh.supply prefix', () => {
    saveClaims(getClaims());
    expect(localStorage.getItem('vayuswachh.supply.claims')).not.toBeNull();
  });

  it('seeds one collected and released, one collected but held by a fire, and one disputed offer', () => {
    const state = (village: string) => {
      const o = getOffers().find((x) => x.villageId === village)!;
      return offerState(o, getClaims(), getReceipts());
    };
    expect(state('sunam').status).toBe('collected');
    expect(state('sunam').verification.paymentStatus).toBe('released');
    expect(state('lehragaga').status).toBe('collected');
    expect(state('lehragaga').verification).toMatchObject({ firmsNoFire: 'fail', paymentStatus: 'held' });
    expect(state('dirba').status).toBe('disputed');
  });
});

describe('mock supply API', () => {
  const api = createMockApi();
  beforeEach(() => { resetSupply(); });

  it('rejects a claim above the remaining tonnes', async () => {
    const moonak = (await api.listSupplyOffers()).find((o) => o.villageId === 'moonak');
    expect(moonak).toBeDefined();
    await expect(api.claimSupplyOffer(moonak!.id, 99)).rejects.toMatchObject({ status: 409 });
  });

  it('claims, weighs in and releases payment on a matched, fire-free delivery', async () => {
    const moonak = (await api.listSupplyOffers()).find((o) => o.villageId === 'moonak')!;
    const claimed = await api.claimSupplyOffer(moonak.id, 12);
    expect(claimed.receipt).toBeNull();
    expect((await api.getVerification(moonak.id)).paymentStatus).toBe('held');

    const r = await api.recordReceipt(claimed.id, input(21000, 9000));
    expect(r).not.toHaveProperty('firmsNoFire');
    const v = await api.getVerification(moonak.id);
    expect(v).toMatchObject({ firmsNoFire: 'pass', reconciliation: 'matched', paymentStatus: 'released', computedBy: 'platform' });
    const after = (await api.listSupplyOffers()).find((o) => o.id === moonak.id);
    expect(after?.status).toBe('collected');
  });

  it('refuses a receipt for a claim held by another buyer', async () => {
    const moonak = (await api.listSupplyOffers()).find((o) => o.villageId === 'moonak')!;
    saveClaims([...getClaims(), claim({ id: 'BC-OTHER', offerId: moonak.id, buyerId: 'SOMEONE-ELSE', claimedTonnes: 1 })]);
    await expect(api.recordReceipt('BC-OTHER', input(2000, 1000))).rejects.toBeInstanceOf(ApiError);
    await expect(api.recordReceipt('BC-OTHER', input(2000, 1000))).rejects.toMatchObject({ status: 403 });
  });
});
