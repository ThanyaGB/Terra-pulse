import { FIRMS_DETECTIONS, SUPPLY_SEED_LOTS, supplyOfferSeed } from '@/api/mock/fixtures';
import { SUPPLY_CONFIG, villageIdOf } from './supplyConfig';
import { buildReceipt, type ReceiptRecord, type StoredClaim, type StoredOffer } from './supplyRules';

/**
 * Demo store for the buyer-led straw offtake. Shared by /buyer (writes claims and receipts), /fpo (tile) and /policy (status line).
 * Kept in localStorage so a receipt recorded on /buyer updates the FPO tile in the same browser, like the work-order store.
 * With storage unavailable it falls back to memory for the session.
 */
const OFFERS_KEY = 'vayuswachh.supply.offers';
const CLAIMS_KEY = 'vayuswachh.supply.claims';
const RECEIPTS_KEY = 'vayuswachh.supply.receipts';
const EVENT = 'vayuswachh:supply';

type Key = typeof OFFERS_KEY | typeof CLAIMS_KEY | typeof RECEIPTS_KEY;

let memory: Partial<Record<Key, unknown>> = {};
let seeded: { offers: StoredOffer[]; claims: StoredClaim[]; receipts: ReceiptRecord[] } | null = null;

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** The demo starts with one collected offer, one held by a fire and one in dispute. Built once per session. */
function seedState() {
  if (seeded) return seeded;
  const offers = supplyOfferSeed();
  const claims: StoredClaim[] = [];
  const receipts: ReceiptRecord[] = [];
  SUPPLY_SEED_LOTS.forEach((lot, i) => {
    const offer = offers.find((o) => o.villageId === villageIdOf(lot.village));
    if (!offer) return;
    const claim: StoredClaim = {
      id: `BC-${100 + i}`,
      offerId: offer.id,
      buyerId: SUPPLY_CONFIG.buyerId,
      claimedTonnes: lot.claimedTonnes,
      claimedAt: hoursFromNow(-lot.hoursAgo - 4),
      contractId: `CT-${200 + i}`,
    };
    claims.push(claim);
    receipts.push(buildReceipt({
      id: `WR-${100 + i}`,
      claim,
      input: { grossKg: lot.grossKg, tareKg: lot.tareKg, qualityGrade: lot.grade, photoRef: `seed://weighbridge/${claim.id}` },
      enteredAt: hoursFromNow(-lot.hoursAgo),
      firmsDetections: FIRMS_DETECTIONS[villageIdOf(lot.village)] ?? 0,
      spotChecked: (SUPPLY_CONFIG.spotCheckVillages as readonly string[]).includes(villageIdOf(lot.village)),
      tolerancePct: SUPPLY_CONFIG.tolerancePct,
    }));
  });
  seeded = { offers, claims, receipts };
  return seeded;
}

function read<T>(key: Key, seed: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch { /* storage unavailable or corrupt: use memory */ }
  if (!(key in memory)) memory[key] = seed();
  return memory[key] as T;
}

function write(key: Key, value: unknown, notify: boolean): void {
  memory[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* memory only */ }
  if (notify && typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export const getOffers = (): StoredOffer[] => read(OFFERS_KEY, () => seedState().offers);
export const getClaims = (): StoredClaim[] => read(CLAIMS_KEY, () => seedState().claims);
export const getReceipts = (): ReceiptRecord[] => read(RECEIPTS_KEY, () => seedState().receipts);

export function saveOffers(list: StoredOffer[], notify = true): void { write(OFFERS_KEY, list, notify); }
export function saveClaims(list: StoredClaim[], notify = true): void { write(CLAIMS_KEY, list, notify); }
export function saveReceipts(list: ReceiptRecord[], notify = true): void { write(RECEIPTS_KEY, list, notify); }

/** Re-runs the listener on any supply change in this tab (custom event) or another tab (storage event). */
export function subscribeSupply(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); };
}

/** Back to the seeded demo: clears the stored supply state and tells listeners. */
export function resetSupply(): void {
  memory = {};
  seeded = null;
  try { localStorage.removeItem(OFFERS_KEY); localStorage.removeItem(CLAIMS_KEY); localStorage.removeItem(RECEIPTS_KEY); } catch { /* memory only */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export const SUPPLY_EVENT = EVENT;
