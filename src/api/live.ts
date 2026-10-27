import { createTokenProvider, type Role, type TokenProvider } from './auth';
import type {
  AdviceResponse, AssignmentReceipt, AttributionResponse, BiomassStatus, BookingReceipt, BookingRequest, CallDetails, CallLogEntry,
  CallReceipt, CallSession, CitizenArea, CitizenSnapshot, ComplianceResponse, CompletionReceipt, DirectivePreview, DirectiveReceipt, DirectiveType,
  Farmer, FarmersResponse, HealthItem, HealthProfile, HealthResponse, Lang, MachineType, MachineryStatus, PlumeResponse, WorkOrder,
  RealtimeEvent, ReportReceipt, ReportRequest, RoutesResponse, VayuApi,
} from './contract';
import type { HealthStatus } from '@/lib/health';
import { ApiError } from './errors';

/** The live backend has no straw-supply routes yet. Rejecting (not throwing) keeps the page's error state working. */
const notImplemented = <T,>(what: string): Promise<T> => Promise.reject(new ApiError(`${what} is not implemented in the live adapter yet`, 501));

interface ProblemDetails { title?: string; detail?: string }

/** Fetch client: signs in per role (see auth.ts) and sends `Authorization: Bearer` on every call. */
function createClient(baseUrl: string, auth: TokenProvider) {
  const base = baseUrl.replace(/\/$/, '');
  async function request<T>(method: 'GET' | 'POST', path: string, role: Role, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v));
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${await auth.token(role)}` };
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${base}${path}${qs.size ? `?${qs}` : ''}`, { method, headers, body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) });
    } catch {
      throw new ApiError('Network unreachable', 0);
    }
    if (res.status === 401) auth.invalidate(role); // expired: the next call signs in again
    if (!res.ok) {
      let p: ProblemDetails = {};
      try { p = (await res.json()) as ProblemDetails; } catch { /* non-JSON error */ }
      throw new ApiError(p.detail || p.title || `Request failed (${res.status})`, res.status);
    }
    return (await res.json()) as T;
  }
  return {
    get: <T,>(path: string, role: Role, query?: Record<string, string | number | undefined>) => request<T>('GET', path, role, undefined, query),
    post: <T,>(path: string, role: Role, body?: unknown) => request<T>('POST', path, role, body),
  };
}

/* ---- shapes returned by the backend (see packages/contracts/openapi.json) ---- */
interface Parcel {
  parcel_id: string; village: string; farmer_name: string; acres: number; harvest_date: string; score: number;
  machine_need: MachineType; status: Farmer['status']; last_contact_at: string | null;
}
interface PipelineHealth {
  quality: { freshness_min: Record<string, number>; status: Record<string, string>; origin: Record<string, string>; stations: { online: number; total: number } };
  agents: { agent: string; status: HealthStatus; last_latency_ms: number; events_processed: number }[];
  fires: { active: number; clusters: number };
}
interface WireDirective { id: string; type: DirectiveType; issuedAt: string }
const toReceipt = (d: WireDirective): DirectiveReceipt => ({ id: d.id, type: d.type, issuedAt: d.issuedAt, status: 'queued' });
interface WireWorkOrder {
  id: string; area_id: string; area: string; action_type: WorkOrder['actionType']; status: WorkOrder['status']; due_by: string; sla_breached: boolean;
  accepted_at: string | null; completed_at: string | null; roi: { delta_pm25: number; control_area: string | null } | null;
}
const toWorkOrder = (w: WireWorkOrder): WorkOrder => ({
  id: w.id, areaId: w.area_id, area: w.area, actionType: w.action_type, status: w.status, dueBy: w.due_by, createdAt: w.accepted_at ?? w.due_by, source: null,
  acceptedAt: w.accepted_at, completedAt: w.completed_at, roi: w.roi ? { deltaPm25: w.roi.delta_pm25, controlArea: w.roi.control_area } : null,
});
interface Envelope { channel: string; ts: string; payload: Record<string, unknown> }

const MIX_LABELS: Record<string, string> = {
  straw_plume: 'Upstream straw plume', vehicle: 'Transport arterials', dust: 'Dust & construction', industrial_waste: 'Industry & waste burning',
};
const LINE_MS = 3600;
const PLACE_AREA: Record<string, string> = {
  'anand vihar metro': 'av-isbt', 'patparganj depot': 'pp-ind', 'laxmi nagar': 'ito', 'mayur vihar ph-1': 'pp-mv', akshardham: 'okhla',
  'karkardooma court': 'av-204', 'preet vihar': 'av-204', 'yamuna sports complex': 'pp-mv',
};
const NEIGHBOURHOOD_IDS = ['av-204', 'av-isbt', 'pp-mv', 'pp-ind'];

/** Commute inputs are free text; the backend routes between monitored communities. */
function placeToArea(place: string, avoid?: string): string {
  const key = place.trim().toLowerCase();
  let id = PLACE_AREA[key];
  if (!id) {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    id = NEIGHBOURHOOD_IDS[h % NEIGHBOURHOOD_IDS.length]!;
  }
  if (id === avoid) id = NEIGHBOURHOOD_IDS[(NEIGHBOURHOOD_IDS.indexOf(id) + 1) % NEIGHBOURHOOD_IDS.length]!;
  return id;
}

function envelopeToEvents(e: Envelope): RealtimeEvent[] {
  const p = e.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (e.channel === 'aqi.update') return [{ type: 'aqi', areaId: String(p.area_id), areaName: String(p.name), aqi: Number(p.aqi), pm25: Number(p.pm25 ?? 0), ts: e.ts }];
  if (e.channel === 'agent.status' && p.kind === 'fire') return [{ type: 'fire', activeFires: Number(p.active_fires), newDetections: Number(p.new_detections ?? 0), ts: e.ts }];
  if (e.channel === 'agent.status' && p.kind === 'agent') {
    return [{ type: 'agent', ts: e.ts, agent: { id: String(p.agent), name: String(p.agent).replace(/_/g, ' '), status: p.status as HealthStatus, latencyMs: Math.round(Number(p.last_latency_ms ?? 0)) } }];
  }
  return [];
}
export { envelopeToEvents };

function dataUrlToBlob(url: string | null): Blob {
  if (!url) return new Blob([Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), (c) => c.charCodeAt(0))], { type: 'image/jpeg' });
  const [meta, b64] = url.split(',');
  const mime = /data:([^;]+)/.exec(meta ?? '')?.[1] ?? 'image/jpeg';
  return new Blob([Uint8Array.from(atob(b64 ?? ''), (c) => c.charCodeAt(0))], { type: mime });
}

/** Adapter: maps the backend endpoints (/v1/...) onto the UI-facing VayuApi. `baseUrl` must end in /v1. */
export function createLiveApi(baseUrl: string, auth: TokenProvider = createTokenProvider(baseUrl)): VayuApi {
  const client = createClient(baseUrl, auth);
  const sessions = new Map<string, string>(); // call session id -> parcel id
  const get = client.get;
  const post = client.post;

  return {
    async getAttribution(cell) {
      const r = await get<{ shares: Record<string, number>; ncr_shares: Record<string, number>; cells: AttributionResponse['cells']; computed_at: string }>(
        '/attribution/summary', 'policy_officer', { region: cell ?? 'anand-vihar' });
      const toShares = (m: Record<string, number>) => Object.entries(m).map(([source, pct]) => ({ source: source as never, pct }));
      const label = r.cells.find((c) => c.id === (cell ?? 'anand-vihar'))?.label ?? 'Anand Vihar';
      return { cell: { id: cell ?? 'anand-vihar', label, shares: toShares(r.shares) }, ncr: { shares: toShares(r.ncr_shares) }, cells: r.cells, updatedAt: r.computed_at };
    },
    async getPlume() {
      const r = await get<PlumeResponse & { hoursToReachNcr: number | null }>('/plume/projection', 'policy_officer');
      return { ...r, hoursToReachNcr: r.hoursToReachNcr ?? r.horizonHours };
    },
    async getCompliance(): Promise<ComplianceResponse> {
      const r = await get<{ compliance: Omit<ComplianceResponse, 'updatedAt'> }>('/roi/summary', 'policy_officer');
      return { ...r.compliance, updatedAt: new Date().toISOString() };
    },
    async getHealth(): Promise<HealthResponse> {
      const h = await get<PipelineHealth>('/pipeline/health', 'policy_officer');
      const q = h.quality;
      const st = (k: string): HealthStatus => (q.status[k] === 'ok' ? 'ok' : q.status[k] === 'degraded' ? 'degraded' : 'down');
      const now = new Date().toISOString();
      const agentsOk: HealthStatus = h.agents.every((a) => a.status === 'ok') ? 'ok' : h.agents.some((a) => a.status === 'down') ? 'down' : 'degraded';
      const mins = (k: string) => (q.freshness_min[k] === undefined ? 'no data' : `${Math.round(q.freshness_min[k]!)} min ago`);
      const items: HealthItem[] = [
        { id: 'firms', label: 'NASA FIRMS', status: st('firms'), detail: `Updated ${mins('firms')} (${q.origin.firms}) · ${h.fires.active} hotspots`, updatedAt: now },
        { id: 'cpcb', label: 'CPCB stations', status: st('cpcb'), detail: `${q.stations.online} of ${q.stations.total} online · ${q.origin.cpcb}`, updatedAt: now },
        { id: 'imd', label: 'Weather (NWP and ERA5)', status: st('weather'), detail: `Updated ${mins('weather')} (${q.origin.weather})`, updatedAt: now },
        { id: 'agents', label: 'Agents', status: agentsOk, detail: `${h.agents.filter((a) => a.status === 'ok').length} of ${h.agents.length} healthy`, updatedAt: now },
      ];
      return {
        items, cpcb: q.stations,
        agents: h.agents.map((a) => ({ id: a.agent, name: a.agent.replace(/_/g, ' '), status: a.status, latencyMs: Math.round(a.last_latency_ms) })),
      };
    },
    getDirectivePreview: (type: DirectiveType) => get<DirectivePreview>('/directives/preview', 'policy_officer', { type }),
    async issueDirective(type, areaIds): Promise<DirectiveReceipt> {
      return toReceipt(await post<WireDirective>('/directives', 'policy_officer', { type, area_ids: areaIds }));
    },

    async getMachinery(): Promise<MachineryStatus[]> {
      const r = await get<{ types: { type: MachineType; label: string; total: number; in_use: number }[] }>('/machinery/status', 'fpo_coordinator');
      return r.types.map((t) => ({ type: t.type, label: t.label, total: t.total, inUse: t.in_use }));
    },
    async getBiomass(): Promise<BiomassStatus> {
      const r = await get<{ plant: string; floor_price_inr_per_tonne: number | null; tonnes_received: number; tonnes_requested: number; cumulative_acres: number; trucks_today: number }>(
        '/collections/summary', 'fpo_coordinator');
      return { plant: r.plant, floorPriceInrPerTonne: r.floor_price_inr_per_tonne ?? 0, tonnesRemovedToday: r.tonnes_received, cumulativeAcres: r.cumulative_acres, trucksToday: r.trucks_today };
    },
    async getFarmers(): Promise<FarmersResponse> {
      const r = await get<{ items: Parcel[]; villages: string[] }>('/risk/parcels', 'fpo_coordinator', { limit: 200 });
      return {
        villages: r.villages,
        farmers: r.items.map((p): Farmer => ({
          id: p.parcel_id, name: p.farmer_name, village: p.village, acres: p.acres, harvestDate: new Date(p.harvest_date).toISOString(),
          riskScore: Math.round(p.score), lastContactAt: p.last_contact_at, status: p.status, machineNeed: p.machine_need,
        })),
      };
    },
    async getCallDetails(farmerId): Promise<CallDetails> {
      const r = await get<{
        calls: { call_id: string; started_at: string; status: string; keys: string[]; intent: string | null; transcript: unknown[] }[];
        matched_machine: { machine_type: MachineType; operator_name: string; operator_phone: string; distance_km: number; base: string } | null;
        bookings: { status: string }[];
      }>('/calls', 'fpo_coordinator', { parcel_id: farmerId });
      const log: CallLogEntry[] = r.calls.slice().reverse().map((c) => ({
        id: c.call_id, at: c.started_at, direction: 'outbound', outcome: c.keys.length ? 'answered' : 'queued',
        keyPressed: (c.keys[c.keys.length - 1] as CallLogEntry['keyPressed']) ?? undefined,
        note: c.keys.length ? `Pressed ${c.keys[c.keys.length - 1]}: ${c.intent?.replace(/_/g, ' ')}` : 'Voice call queued (Punjabi)',
      }));
      const last = r.calls[r.calls.length - 1];
      const booked = r.bookings.some((b) => b.status === 'confirmed' || b.status === 'dispatched');
      const intent: CallDetails['intent'] = !last ? null
        : booked ? { label: 'Machine booked', summary: 'Pressed 1 and a machine is locked for this parcel.', confidencePct: 94 }
        : last.intent ? { label: last.intent.replace(/_/g, ' '), summary: `Keypad choice: ${last.intent.replace(/_/g, ' ')}.`, confidencePct: 90 }
        : { label: 'Awaiting response', summary: 'Call queued; no keypad response yet.', confidencePct: 50 };
      const m = r.matched_machine;
      return { farmerId, log, intent, matchedResource: m ? { machineType: m.machine_type, operatorName: m.operator_name, phone: m.operator_phone, distanceKm: m.distance_km, base: m.base } : null };
    },
    async triggerVoiceCall(farmerId): Promise<CallReceipt> {
      const r = await post<{ call_id: string; status: 'queued' }>('/calls/trigger', 'fpo_coordinator', { parcel_id: farmerId, lang: 'pa' });
      return { callId: r.call_id, status: r.status, at: new Date().toISOString() };
    },
    async assignMachine(farmerId, machineType): Promise<AssignmentReceipt> {
      const r = await post<{ booking_id: string; eta_minutes: number; machinery: { type: MachineType } }>('/fpo/assign', 'fpo_coordinator', { parcel_id: farmerId, machine_type: machineType });
      return { assignmentId: r.booking_id, machineType: r.machinery.type, etaMinutes: r.eta_minutes };
    },

    async getCallSession(lang: Lang): Promise<CallSession> {
      const r = await get<{ session_id: string; parcel_id: string; caller_name: string; caller_id: string; farmer_first_name: string; audio_url: string | null; lines: string[];
        prices: { super_seeder_per_acre: number | null; straw_per_tonne: number | null } }>('/calls/session', 'farmer', { lang });
      sessions.set(r.session_id, r.parcel_id);
      return {
        sessionId: r.session_id, callerName: r.caller_name, callerId: r.caller_id, farmerFirstName: r.farmer_first_name, lang, audioUrl: r.audio_url,
        lines: r.lines.map((text, i) => ({ id: `l${i}`, startMs: i * LINE_MS, endMs: (i + 1) * LINE_MS - 150, text })),
        prices: { superSeederPerAcre: r.prices.super_seeder_per_acre ?? 0, strawPerTonne: r.prices.straw_per_tonne ?? 0 },
      };
    },
    /**
     * The backend keypad works like the phone line (ADR-09): the menu key (1, 2 or 9) only asks for confirmation (after 1 the
     * farmer first picks the machine: 1 Super Seeder, 2 Happy Seeder), and the confirming 1 books. The screen runs these steps
     * itself (0 = back never leaves the phone), so once the farmer has confirmed on screen this replays the keys in order.
     */
    async bookKey(req: BookingRequest): Promise<BookingReceipt> {
      const parcel = sessions.get(req.sessionId);
      if (!parcel) throw new ApiError('Call session expired', 410);
      type KeyReply = { key: BookingReceipt['key']; status: BookingReceipt['status'] | 'awaiting_confirmation' | 'choose_machine' | 'queued'; reference_id?: string };
      let step1 = await post<KeyReply>('/calls/keypress', 'farmer', { parcel_id: parcel, key: req.key, lang: req.lang });
      if (step1.status === 'choose_machine') {
        const machineKey = req.machine === 'happy_seeder' ? '2' : '1';
        step1 = await post<KeyReply>('/calls/keypress', 'farmer', { parcel_id: parcel, key: machineKey, lang: req.lang });
      }
      if (step1.status !== 'awaiting_confirmation') throw new ApiError('Unexpected keypad state', 409);
      const r = await post<KeyReply>('/calls/keypress', 'farmer', { parcel_id: parcel, key: '1', lang: req.lang });
      if (r.status === 'awaiting_confirmation' || r.status === 'choose_machine' || !r.reference_id) throw new ApiError('Booking was not confirmed', 409);
      return { referenceId: r.reference_id, key: r.key, status: r.status === 'confirmed' ? 'confirmed' : 'connecting', machine: req.machine };
    },

    getCitizenAreas: () => get<CitizenArea[]>('/aqi/communities', 'citizen'),
    async getCitizenSnapshot(areaId): Promise<CitizenSnapshot> {
      const r = await get<{ community_id: string; name: string; aqi: number; pm25: number; source_mix: Record<string, number>; alerts: CitizenSnapshot['alerts']; updated_at: string }>(
        `/aqi/community/${encodeURIComponent(areaId)}`, 'citizen');
      return { areaId: r.community_id, areaName: r.name, aqi: r.aqi, pm25: Math.round(r.pm25), mix: Object.entries(r.source_mix).map(([k, pct]) => ({ label: MIX_LABELS[k] ?? k, pct })), alerts: r.alerts, updatedAt: r.updated_at };
    },
    getAdvice: (profile: HealthProfile, hour) => get<AdviceResponse>('/health/advice', 'citizen', { profile, community_id: 'av-204', time: hour }),
    async getRoutes(from, to): Promise<RoutesResponse> {
      const a = placeToArea(from);
      const b = placeToArea(to, a);
      const r = await get<{ options: { id: string; name: string; segments: { minutes: number; aqi: number; label: string }[] }[] }>('/routes/clean', 'citizen', { from: a, to: b });
      return { from, to, options: r.options.map((o) => ({ id: o.id, name: o.name, via: o.segments.map((s) => s.label).join(' → '), segments: o.segments })) };
    },
    async submitReport(req: ReportRequest): Promise<ReportReceipt> {
      const form = new FormData();
      form.set('photo', dataUrlToBlob(req.photoDataUrl), 'report.jpg');
      form.set('category', req.category);
      form.set('area_id', req.areaId);
      if (req.lat !== null && req.lng !== null) { form.set('lat', String(req.lat)); form.set('lon', String(req.lng)); }
      const r = await post<{ reference_id: string; received_at: string }>('/reports/photo', 'citizen', form);
      return { referenceId: r.reference_id, receivedAt: r.received_at };
    },

    async listWorkOrders(): Promise<WorkOrder[]> {
      const r = await get<{ items: WireWorkOrder[] }>('/work-orders', 'municipal_supervisor', { limit: 200 });
      return r.items.map(toWorkOrder);
    },
    async acceptWorkOrder(id): Promise<WorkOrder> {
      return toWorkOrder(await post<WireWorkOrder>(`/work-orders/${encodeURIComponent(id)}/accept`, 'municipal_supervisor'));
    },
    async completeWorkOrder(req): Promise<CompletionReceipt> {
      const form = new FormData();
      form.set('photo', dataUrlToBlob(req.photoDataUrl), 'completion.jpg');
      form.set('lat', String(req.lat));
      form.set('lon', String(req.lng));
      form.set('client_request_id', req.clientRequestId);
      const r = await post<WireWorkOrder & { duplicate: boolean }>(`/work-orders/${encodeURIComponent(req.workOrderId)}/complete`, 'municipal_supervisor', form);
      return { workOrder: toWorkOrder(r), duplicate: r.duplicate };
    },

    listSupplyOffers: () => notImplemented('straw supply'),
    claimSupplyOffer: () => notImplemented('straw supply'),
    recordReceipt: () => notImplemented('straw supply'),
    getVerification: () => notImplemented('straw supply'),
    listBuyerClaims: () => notImplemented('straw supply'),
    getSupplySummary: () => notImplemented('straw supply'),

    async getRealtimeSnapshot(): Promise<RealtimeEvent[]> {
      const env = await get<Envelope[]>('/realtime/snapshot', 'citizen');
      return env.flatMap(envelopeToEvents);
    },
  };
}
