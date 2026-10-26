import type {
  AssignmentReceipt, BookingReceipt, BookingRequest, BuyerClaim, CallDetails, CallReceipt, CompletionReceipt, CompletionRequest, DirectivePreview, DirectiveReceipt,
  DirectiveType, Farmer, HealthProfile, Lang, MachineType, MachineryStatus, ReceiptInput, RealtimeEvent, ReportReceipt, ReportRequest,
  SupplyOffer, SupplyOfferFilter, SupplySummary, VayuApi, VerificationResult, WeighbridgeReceipt, WorkOrder,
} from '../contract';
import { getWorkOrders, saveWorkOrders } from '@/lib/workorders';
import { getClaims, getOffers, getReceipts, saveClaims, saveReceipts } from '@/lib/supply';
import { SUPPLY_CONFIG } from '@/lib/supplyConfig';
import { buildReceipt, claimProblem, offerState, receiptProblem, round2, type ReceiptRecord, type StoredClaim } from '@/lib/supplyRules';
import { ApiError } from '../errors';
import { buildAdvice } from './advice';
import {
  AGENTS, BIOMASS, CITIZEN_AREAS, COMPLIANCE, FIRMS_DETECTIONS, MACHINERY, OPERATORS, PLUME, VILLAGES, attributionFor,
  citizenSnapshot, healthItems, makeFarmers,
} from './fixtures';
import { scriptFor } from './script';

export type MockFlag = 'error' | 'empty' | 'slow' | null;

/** `?mock=error|empty|slow` in the URL forces the matching state so every error/empty/loading UI is reachable. */
export function readMockFlag(): MockFlag {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('mock');
  return v === 'error' || v === 'empty' || v === 'slow' ? v : null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gate<T>(read: boolean, value: () => T, empty?: () => T): Promise<T> {
  const flag = readMockFlag();
  await wait((flag === 'slow' ? 2500 : 0) + 180 + Math.random() * 220);
  if (flag === 'error' && read) throw new ApiError('Service unavailable (mock)', 503);
  if (flag === 'empty' && empty) return empty();
  return value();
}

const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

/** Offers with their derived status, optionally limited to some villages and statuses. */
function listOffers(filter?: SupplyOfferFilter): SupplyOffer[] {
  const claims = getClaims();
  const receipts = getReceipts();
  return getOffers()
    .filter((o) => !filter?.villageIds || filter.villageIds.includes(o.villageId))
    .map((o): SupplyOffer => ({ ...o, status: offerState(o, claims, receipts).status }))
    .filter((o) => !filter?.status || o.status === filter.status);
}

/** The buyer-facing receipt: the platform's checks stay in the store. */
function toReceipt(r: ReceiptRecord | undefined): WeighbridgeReceipt | null {
  if (!r) return null;
  const { firmsNoFire: _f, spotCheck: _s, reconciliation: _r, ...receipt } = r;
  return receipt;
}

/** A buyer's claims with their receipts joined in, newest first. */
function claimsWithReceipts(buyerId: string): BuyerClaim[] {
  const receipts = getReceipts();
  return getClaims()
    .filter((c) => c.buyerId === buyerId)
    .map((c): BuyerClaim => ({ ...c, receipt: toReceipt(receipts.find((r) => r.claimId === c.id)) }))
    .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt));
}

function supplySummary(villageIds?: string[]): SupplySummary {
  const claims = getClaims();
  const receipts = getReceipts();
  const floor = BIOMASS.floorPriceInrPerTonne;
  let open = 0, claimed = 0, collected = 0, held = 0, awaiting = 0;
  for (const o of getOffers().filter((x) => !villageIds || villageIds.includes(x.villageId))) {
    const s = offerState(o, claims, receipts);
    if (s.status === 'open' || s.status === 'claimed') open += s.remaining;
    claimed += s.claims.reduce((n, c) => n + c.claimedTonnes, 0);
    const netT = s.receipts.reduce((n, r) => n + r.netKg / 1000, 0);
    collected += netT;
    if (s.receipts.length > 0 && s.verification.paymentStatus === 'held') {
      held += netT * floor;
      if (s.status !== 'disputed') awaiting += s.receipts.length;
    }
  }
  return {
    openTonnes: round2(open),
    claimedTonnes: round2(claimed),
    collectedTonnes: round2(collected),
    heldPaymentsInr: Math.round(held),
    awaitingVerification: awaiting,
    burnProxyFires: PLUME.sources.reduce((n, s) => n + s.fires, 0),
    updatedAt: new Date().toISOString(),
  };
}

const DIRECTIVES: Record<DirectiveType, Omit<DirectivePreview, 'type'>> = {
  grap_ii: {
    title: 'Issue GRAP-II alert',
    action: 'Broadcast a Stage-II GRAP alert to all NCR enforcement agencies and publish a public advisory.',
    affectedAreas: [
      { id: 'delhi', name: 'Delhi (all 11 districts)', detail: 'Dust control, parking fees, DG-set curbs' },
      { id: 'gurugram', name: 'Gurugram', detail: 'Construction dust enforcement' },
      { id: 'faridabad', name: 'Faridabad', detail: 'Industrial emission checks' },
      { id: 'ghaziabad', name: 'Ghaziabad', detail: 'Road sweeping and water sprinkling' },
      { id: 'noida', name: 'Noida / Greater Noida', detail: 'Construction dust enforcement' },
    ],
    note: 'Alert is sent to state pollution control boards and municipal commissioners. It can be withdrawn later.',
  },
  diversion_trucks: {
    title: 'Issue diversion order for out-of-state diesel trucks',
    action: 'Divert non-essential out-of-state diesel trucks away from Delhi to the peripheral expressways.',
    affectedAreas: [
      { id: 'singhu', name: 'Singhu / Kundli border', detail: 'NH-44, northbound entry' },
      { id: 'tikri', name: 'Tikri border', detail: 'NH-9, westbound entry' },
      { id: 'ghazipur', name: 'Ghazipur border', detail: 'NH-24, eastern entry' },
      { id: 'kmp', name: 'KMP / Eastern Peripheral Expressway', detail: 'Designated diversion route' },
    ],
    note: 'Applies to non-CNG, non-BS-VI diesel goods vehicles without essential-goods exemption.',
  },
  fog_cannons: {
    title: 'Deploy fog cannons on heavy-pollution corridors',
    action: 'Dispatch available anti-smog fog cannons to the corridors forecast to peak within 12 hours.',
    affectedAreas: [
      { id: 'anand-vihar', name: 'Anand Vihar ISBT corridor', detail: '3 units · forecast PM2.5 462 µg/m³' },
      { id: 'rohini', name: 'Rohini Sectors 15-17', detail: '2 units · forecast PM2.5 390 µg/m³' },
      { id: 'ito', name: 'ITO to Pragati Maidan', detail: '2 units · forecast PM2.5 410 µg/m³' },
      { id: 'okhla', name: 'Okhla Phase 1-3', detail: '1 unit · forecast PM2.5 340 µg/m³' },
    ],
    note: '6 units are already in transit and will be re-tasked. Water supply is arranged by MCD.',
  },
};

export function createMockApi(): VayuApi {
  // Mutable session state so actions are visible across screens.
  let machinery: MachineryStatus[] = MACHINERY.map((m) => ({ ...m }));
  const completionByRequest = new Map<string, string>();   // clientRequestId -> work order, so a re-sent completion counts once
  const farmers: Farmer[] = makeFarmers();
  const callLogs = new Map<string, CallDetails['log']>();
  let reportCounter = 4200;


  const intentFor = (f: Farmer): CallDetails['intent'] => {
    if (f.status === 'to_contact') return null;
    if (f.status === 'dispatched') return { label: 'Machine dispatched', summary: 'Operator is on the way. Farmer agreed not to burn.', confidencePct: 96 };
    if (f.status === 'confirmed') return { label: 'Wants a machine', summary: `Pressed 1 and asked for a ${labelOf(f.machineNeed)}. Prefers a start in 2 days.`, confidencePct: 91 };
    return { label: 'Considering', summary: 'Listened to the full message but has not chosen yet. Asked about the price.', confidencePct: 64 };
  };

  function logFor(f: Farmer): CallDetails['log'] {
    const existing = callLogs.get(f.id);
    if (existing) return existing;
    const log: CallDetails['log'] = [];
    if (f.lastContactAt) {
      const t = new Date(f.lastContactAt).getTime();
      log.push({ id: id('c'), at: new Date(t).toISOString(), direction: 'outbound', outcome: 'answered', keyPressed: f.status === 'confirmed' ? '1' : undefined, note: f.status === 'confirmed' ? 'Pressed 1: lock Super Seeder' : 'Listened for 48 s, no key pressed' });
      log.push({ id: id('c'), at: new Date(t - 5 * 3600_000).toISOString(), direction: 'outbound', outcome: 'no_answer', note: 'No answer, retry scheduled' });
    }
    callLogs.set(f.id, log);
    return log;
  }

  function matchFor(f: Farmer): CallDetails['matchedResource'] {
    const list = OPERATORS[f.machineNeed];
    const op = list[f.id.charCodeAt(f.id.length - 1) % list.length]!;
    return { machineType: f.machineNeed, operatorName: op.operatorName, phone: op.phone, base: op.base, distanceKm: Math.round((2 + (f.riskScore % 11) * 1.3) * 10) / 10 };
  }

  const findFarmer = (fid: string) => {
    const f = farmers.find((x) => x.id === fid);
    if (!f) throw new ApiError('Farmer not found', 404);
    return f;
  };

  return {
    getAttribution: (cellId) => gate(true, () => attributionFor(cellId)),
    getPlume: () => gate(true, () => ({ ...PLUME, generatedAt: new Date().toISOString() })),
    getCompliance: () => gate(true, () => ({ ...COMPLIANCE, updatedAt: new Date().toISOString() })),
    getHealth: () => gate(true, () => ({ items: healthItems(), cpcb: { online: 39, total: 40 }, agents: AGENTS })),
    getDirectivePreview: (type) => gate(true, () => ({ type, ...DIRECTIVES[type] })),
    issueDirective: (type, areaIds): Promise<DirectiveReceipt> => {
      void areaIds;
      return gate(false, () => ({ id: id('DIR'), type, issuedAt: new Date().toISOString(), status: 'queued' as const }));
    },

    getMachinery: () => gate(true, () => machinery.map((m) => ({ ...m })), () => []),
    getBiomass: () => gate(true, () => ({ ...BIOMASS })),
    getFarmers: () => gate(true, () => ({ villages: VILLAGES, farmers: farmers.map((f) => ({ ...f })) }), () => ({ villages: VILLAGES, farmers: [] })),
    getCallDetails: (fid) => gate(true, (): CallDetails => {
      const f = findFarmer(fid);
      return { farmerId: f.id, log: [...logFor(f)], intent: intentFor(f), matchedResource: matchFor(f) };
    }, () => ({ farmerId: fid, log: [], intent: null, matchedResource: null })),
    triggerVoiceCall: (fid) => gate(false, (): CallReceipt => {
      const f = findFarmer(fid);
      const at = new Date().toISOString();
      logFor(f).unshift({ id: id('c'), at, direction: 'outbound', outcome: 'queued', note: 'Voice call queued (Punjabi)' });
      f.lastContactAt = at;
      if (f.status === 'to_contact') f.status = 'called';
      return { callId: id('CALL'), status: 'queued', at };
    }),
    assignMachine: (fid, machineType: MachineType) => gate(false, (): AssignmentReceipt => {
      const f = findFarmer(fid);
      const m = machinery.find((x) => x.type === machineType);
      if (!m || m.inUse >= m.total) throw new ApiError('No machine of this type is free', 409);
      m.inUse += 1;
      f.status = 'dispatched';
      logFor(f).unshift({ id: id('c'), at: new Date().toISOString(), direction: 'outbound', outcome: 'queued', note: `${labelOf(machineType)} assigned on-site` });
      return { assignmentId: id('ASG'), machineType, etaMinutes: Math.round(25 + (f.riskScore % 20)) };
    }),

    getCallSession: (lang: Lang) => gate(true, () => ({
      sessionId: id('SES'),
      callerName: 'Sangrur Kisan Society',
      callerId: '01672-XXXXXX',
      farmerFirstName: 'Gurpreet',
      lang,
      audioUrl: null,
      lines: scriptFor(lang),
      prices: { superSeederPerAcre: 750, strawPerTonne: 1650 },
    })),
    bookKey: (req: BookingRequest) => gate(false, (): BookingReceipt => {
      if (!['1', '2', '9'].includes(req.key)) throw new ApiError('Unknown key', 400);
      if (req.key === '1') {
        if (req.machine !== 'super_seeder' && req.machine !== 'happy_seeder') throw new ApiError('Choose the Super Seeder or the Happy Seeder', 400);
        return { referenceId: id('BK'), key: req.key, machine: req.machine, status: 'confirmed' };
      }
      return { referenceId: id('BK'), key: req.key, status: req.key === '9' ? 'connecting' : 'confirmed' };
    }),

    getCitizenAreas: () => gate(true, () => CITIZEN_AREAS),
    getCitizenSnapshot: (areaId) => gate(true, () => citizenSnapshot(areaId)),
    getAdvice: (profile: HealthProfile, hour) => gate(true, () => buildAdvice(profile, hour)),
    getRoutes: (from, to) => gate(true, () => ({
      from, to,
      options: [
        { id: 'A', name: 'Route A · Main road', via: 'NH-24 and Vikas Marg', segments: [{ minutes: 5, aqi: 410, label: 'NH-24' }, { minutes: 7, aqi: 375, label: 'ISBT flyover' }] },
        { id: 'B', name: 'Route B · Park greenway', via: 'Colony lanes and Yamuna Sports Complex', segments: [{ minutes: 4, aqi: 300, label: 'Colony lanes' }, { minutes: 7, aqi: 250, label: 'Greenway' }, { minutes: 4, aqi: 260, label: 'Cross road' }] },
      ],
    }), () => ({ from, to, options: [] })),
    submitReport: (req: ReportRequest) => gate(false, (): ReportReceipt => {
      if (!['open_burning', 'construction', 'road_dust'].includes(req.category)) throw new ApiError('Unknown category', 400);
      reportCounter += 1;
      return { referenceId: `VS-R-${reportCounter}`, receivedAt: new Date().toISOString() };
    }),

    listWorkOrders: () => gate(true, () => [...getWorkOrders()].sort((a, b) => a.dueBy.localeCompare(b.dueBy)), () => []),
    acceptWorkOrder: (wid) => gate(false, (): WorkOrder => {
      const all = getWorkOrders();
      const w = all.find((o) => o.id === wid);
      if (!w) throw new ApiError('Work order not found', 404);
      if (w.status === 'accepted') return { ...w };
      if (w.status !== 'created') throw new ApiError('A completed work order cannot be accepted', 409);
      const next: WorkOrder = { ...w, status: 'accepted', acceptedAt: new Date().toISOString() };
      saveWorkOrders(all.map((o) => (o.id === wid ? next : o)));
      return next;
    }),
    completeWorkOrder: (req: CompletionRequest) => gate(false, (): CompletionReceipt => {
      const all = getWorkOrders();
      const w = all.find((o) => o.id === req.workOrderId);
      if (!w) throw new ApiError('Work order not found', 404);
      if (completionByRequest.get(req.clientRequestId) === w.id) return { workOrder: { ...w }, duplicate: true };
      if (w.status !== 'accepted') throw new ApiError('Accept the work order before completing it', 409);
      if (!req.photoDataUrl || !Number.isFinite(req.lat) || !Number.isFinite(req.lng)) throw new ApiError('A photo and GPS position are required', 422);
      const next: WorkOrder = { ...w, status: 'completed', completedAt: new Date().toISOString() };
      saveWorkOrders(all.map((o) => (o.id === w.id ? next : o)));
      completionByRequest.set(req.clientRequestId, w.id);
      return { workOrder: next, duplicate: false };
    }),

    listSupplyOffers: (filter) => gate(true, () => listOffers(filter), () => []),
    claimSupplyOffer: (offerId, claimedTonnes) => gate(false, (): BuyerClaim => {
      const offer = getOffers().find((o) => o.id === offerId);
      if (!offer) throw new ApiError('Offer not found', 404);
      const claims = getClaims();
      const mine = claims.filter((c) => c.offerId === offerId);
      const status = offerState(offer, claims, getReceipts()).status;
      const problem = claimProblem({ ...offer, status }, mine, claimedTonnes);
      if (problem) throw new ApiError(problem.message, problem.code);
      const claim: StoredClaim = {
        id: id('BC'),
        offerId,
        buyerId: SUPPLY_CONFIG.buyerId,
        claimedTonnes: round2(claimedTonnes),
        claimedAt: new Date().toISOString(),
        contractId: id('CT'),
      };
      saveClaims([...claims, claim]);
      return { ...claim, receipt: null };
    }),
    recordReceipt: (claimId, payload: ReceiptInput) => gate(false, (): WeighbridgeReceipt => {
      const claim = getClaims().find((c) => c.id === claimId);
      if (!claim) throw new ApiError('Claim not found', 404);
      // Only the buyer holding the claim can weigh it in. The checks below are run by the platform, never taken from the payload.
      if (claim.buyerId !== SUPPLY_CONFIG.buyerId) throw new ApiError('Only the buyer who holds this claim can record its receipt', 403);
      if (getReceipts().some((r) => r.claimId === claimId)) throw new ApiError('A receipt is already recorded for this claim', 409);
      const problem = receiptProblem(payload);
      if (problem) throw new ApiError(problem, 422);
      const offer = getOffers().find((o) => o.id === claim.offerId);
      if (!offer) throw new ApiError('Offer not found', 404);
      const record = buildReceipt({
        id: id('WR'),
        claim,
        input: payload,
        enteredAt: new Date().toISOString(),
        firmsDetections: FIRMS_DETECTIONS[offer.villageId] ?? 0,
        spotChecked: (SUPPLY_CONFIG.spotCheckVillages as readonly string[]).includes(offer.villageId),
        tolerancePct: SUPPLY_CONFIG.tolerancePct,
      });
      saveReceipts([...getReceipts(), record]);
      return toReceipt(record) as WeighbridgeReceipt;
    }),
    getVerification: (offerId) => gate(true, (): VerificationResult => {
      const offer = getOffers().find((o) => o.id === offerId);
      if (!offer) throw new ApiError('Offer not found', 404);
      return offerState(offer, getClaims(), getReceipts()).verification;
    }),
    listBuyerClaims: (buyerId) => gate(true, () => claimsWithReceipts(buyerId), () => []),
    getSupplySummary: (villageIds) => gate(true, () => supplySummary(villageIds), () => ({
      openTonnes: 0, claimedTonnes: 0, collectedTonnes: 0, heldPaymentsInr: 0, awaitingVerification: 0, burnProxyFires: 0, updatedAt: new Date().toISOString(),
    })),

    getRealtimeSnapshot: async (): Promise<RealtimeEvent[]> => {
      const ts = new Date().toISOString();
      return [
        ...CITIZEN_AREAS.map((a): RealtimeEvent => { const s = citizenSnapshot(a.id); return { type: 'aqi', areaId: a.id, areaName: a.name, aqi: s.aqi, pm25: s.pm25, ts }; }),
        { type: 'fire', activeFires: 181, newDetections: 7, ts },
        ...AGENTS.map((agent): RealtimeEvent => ({ type: 'agent', agent, ts })),
      ];
    },
  };

  function labelOf(t: MachineType) {
    return t === 'baler' ? 'baler' : t === 'super_seeder' ? 'Super Seeder' : 'Happy Seeder';
  }
}
