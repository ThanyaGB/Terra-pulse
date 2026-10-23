import type {
  AssignmentReceipt, BookingReceipt, BookingRequest, CallDetails, CallReceipt, DirectivePreview, DirectiveReceipt,
  DirectiveType, Farmer, HealthProfile, Lang, MachineType, MachineryStatus, RealtimeEvent, ReportReceipt, ReportRequest,
  VayuApi,
} from '../contract';
import { ApiError } from '../errors';
import { buildAdvice } from './advice';
import {
  AGENTS, BIOMASS, CITIZEN_AREAS, COMPLIANCE, MACHINERY, OPERATORS, PLUME, VILLAGES, attributionFor,
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
      callerName: 'Sangrur Machinery Cooperative',
      callerId: '01672-XXXXXX',
      farmerFirstName: 'Gurpreet',
      lang,
      audioUrl: null,
      lines: scriptFor(lang),
      prices: { superSeederPerAcre: 750, strawPerTonne: 1650 },
    })),
    bookKey: (req: BookingRequest) => gate(false, (): BookingReceipt => {
      if (!['1', '2', '9'].includes(req.key)) throw new ApiError('Unknown key', 400);
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
