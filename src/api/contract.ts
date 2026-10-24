/**
 * Backend contract (v1). Every UI component reads through the `TerraPulseApi` interface below.
 * REST paths are relative to VITE_API_BASE_URL. Both the mock and live clients implement it.
 */
import type { RiskTier } from '@/lib/risk';
import type { StreetImpact } from '@/lib/plume';
import type { HealthStatus } from '@/lib/health';

export type Lang = 'en' | 'hi' | 'pa';

/* ---------- shared ---------- */
export type SourceId = 'straw_plume' | 'vehicle' | 'dust' | 'industrial_waste';
export interface SourceShare {
  source: SourceId;
  /** percent of PM2.5, all shares of one set sum to 100 */
  pct: number;
}
export type LngLat = [number, number];

/* ---------- 1. Policy (/policy) ---------- */
export interface GridCell {
  id: string;
  label: string;
  lat: number;
  lng: number;
}
/** GET /policy/attribution?cell=:id */
export interface AttributionResponse {
  cell: { id: string; label: string; shares: SourceShare[] };
  ncr: { shares: SourceShare[] };
  cells: GridCell[];
  updatedAt: string;
}
/** GET /policy/plume */
export interface PlumeResponse {
  generatedAt: string;
  horizonHours: number;
  windSpeedKmh: number;
  /** active fire clusters feeding the plume (NASA FIRMS) */
  sources: { id: string; name: string; lat: number; lng: number; fires: number }[];
  /** corridor centre line, Sangrur -> Patiala -> NCR */
  corridor: LngLat[];
  hoursToReachNcr: number;
  streets: StreetImpact[];
}
/** GET /policy/compliance */
export interface ComplianceResponse {
  strawCollectedTonnes: number;
  strawTargetTonnes: number;
  chc: { utilisationPct: number; machinesInUse: number; machinesTotal: number };
  fogCannons: { inTransit: number; deployed: number; planned: number };
  monitoredStreets: { id: string; name: string; beforePm25: number; afterPm25: number }[];
  updatedAt: string;
}
/** GET /system/health */
export interface HealthItem {
  id: 'firms' | 'cpcb' | 'imd' | 'agents';
  label: string;
  status: HealthStatus;
  detail: string;
  updatedAt: string;
}
export interface AgentStatus {
  id: string;
  name: string;
  status: HealthStatus;
  latencyMs: number;
}
export interface HealthResponse {
  items: HealthItem[];
  cpcb: { online: number; total: number };
  agents: AgentStatus[];
}
export type DirectiveType = 'grap_ii' | 'diversion_trucks' | 'fog_cannons';
/** GET /policy/directives/preview?type=:type */
export interface DirectivePreview {
  type: DirectiveType;
  title: string;
  action: string;
  affectedAreas: { id: string; name: string; detail: string }[];
  note: string;
}
/** POST /policy/directives */
export interface DirectiveReceipt {
  id: string;
  type: DirectiveType;
  issuedAt: string;
  status: 'queued';
}

/* ---------- 2. FPO (/fpo) ---------- */
export type MachineType = 'super_seeder' | 'baler' | 'happy_seeder';
/** GET /fpo/machinery */
export interface MachineryStatus {
  type: MachineType;
  label: string;
  total: number;
  inUse: number;
}
/** GET /fpo/biomass */
export interface BiomassStatus {
  plant: string;
  floorPriceInrPerTonne: number;
  tonnesRemovedToday: number;
  cumulativeAcres: number;
  trucksToday: number;
}
export type FarmerStatus = 'to_contact' | 'called' | 'confirmed' | 'dispatched';
export interface Farmer {
  id: string;
  name: string;
  village: string;
  acres: number;
  harvestDate: string;
  riskScore: number;
  lastContactAt: string | null;
  status: FarmerStatus;
  machineNeed: MachineType;
}
/** GET /fpo/farmers */
export interface FarmersResponse {
  villages: string[];
  farmers: Farmer[];
}
export interface CallLogEntry {
  id: string;
  at: string;
  direction: 'outbound' | 'inbound';
  outcome: 'answered' | 'no_answer' | 'queued';
  keyPressed?: '1' | '2' | '9';
  note: string;
}
/** GET /fpo/farmers/:id/call-details */
export interface CallDetails {
  farmerId: string;
  log: CallLogEntry[];
  intent: { label: string; summary: string; confidencePct: number } | null;
  matchedResource: { machineType: MachineType; operatorName: string; phone: string; distanceKm: number; base: string } | null;
}
/** POST /fpo/farmers/:id/call */
export interface CallReceipt {
  callId: string;
  status: 'queued';
  at: string;
}
/** POST /fpo/farmers/:id/assign */
export interface AssignmentReceipt {
  assignmentId: string;
  machineType: MachineType;
  etaMinutes: number;
}

/* ---------- 3. Farmer call (/farmer) ---------- */
export interface ScriptLine {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}
/** GET /farmer/call-session?lang=:lang */
export interface CallSession {
  sessionId: string;
  callerName: string;
  callerId: string;
  farmerFirstName: string;
  lang: Lang;
  /** optional recorded audio. When absent the UI voices the lines with speech synthesis. */
  audioUrl: string | null;
  lines: ScriptLine[];
  prices: { superSeederPerAcre: number; strawPerTonne: number };
}
export type KeyAction = '1' | '2' | '9';
/** POST /farmer/bookings. Sent only after the farmer confirms the choice with 1 (0 goes back on the phone and sends nothing). */
export interface BookingRequest {
  sessionId: string;
  key: KeyAction;
  lang: Lang;
}
export interface BookingReceipt {
  referenceId: string;
  key: KeyAction;
  status: 'confirmed' | 'connecting';
}

/* ---------- 4. Citizen (/citizen) ---------- */
export interface CitizenArea {
  id: string;
  name: string;
  detail: string;
}
export type HealthProfile = 'asthma' | 'child' | 'elderly' | 'outdoor' | 'general';
export interface TimedAlert {
  id: string;
  kind: 'inversion' | 'ventilation' | 'peak_traffic';
  title: string;
  body: string;
  /** minutes since midnight, local time */
  startMin: number;
  endMin: number;
  severity: 'warning' | 'info';
}
/** GET /citizen/snapshot?area=:id */
export interface CitizenSnapshot {
  areaId: string;
  areaName: string;
  aqi: number;
  pm25: number;
  mix: { label: string; pct: number }[];
  alerts: TimedAlert[];
  updatedAt: string;
}
export interface AdviceItem {
  id: string;
  title: string;
  body: string;
  level: 'avoid' | 'caution' | 'ok';
}
/** GET /citizen/advice?profile=:p&hour=:h */
export interface AdviceResponse {
  profile: HealthProfile;
  period: 'early_morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
  items: AdviceItem[];
}
export interface RouteOption {
  id: string;
  name: string;
  via: string;
  segments: { minutes: number; aqi: number; label: string }[];
}
/** GET /citizen/routes?from=:a&to=:b */
export interface RoutesResponse {
  from: string;
  to: string;
  options: RouteOption[];
}
export type ReportCategory = 'open_burning' | 'construction' | 'road_dust';
/** POST /citizen/reports */
export interface ReportRequest {
  category: ReportCategory;
  photoDataUrl: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  areaId: string;
  capturedAt: string;
}
export interface ReportReceipt {
  referenceId: string;
  receivedAt: string;
}

/* ---------- Realtime (WebSocket /ws/v1/stream, polling GET /realtime/snapshot) ---------- */
export type RealtimeEvent =
  | { type: 'aqi'; areaId: string; areaName: string; aqi: number; pm25: number; ts: string }
  | { type: 'fire'; activeFires: number; newDetections: number; ts: string }
  | { type: 'agent'; agent: AgentStatus; ts: string };

/* ---------- the client every component uses ---------- */
export interface TerraPulseApi {
  getAttribution(cellId?: string): Promise<AttributionResponse>;
  getPlume(): Promise<PlumeResponse>;
  getCompliance(): Promise<ComplianceResponse>;
  getHealth(): Promise<HealthResponse>;
  getDirectivePreview(type: DirectiveType): Promise<DirectivePreview>;
  issueDirective(type: DirectiveType, areaIds: string[]): Promise<DirectiveReceipt>;

  getMachinery(): Promise<MachineryStatus[]>;
  getBiomass(): Promise<BiomassStatus>;
  getFarmers(): Promise<FarmersResponse>;
  getCallDetails(farmerId: string): Promise<CallDetails>;
  triggerVoiceCall(farmerId: string): Promise<CallReceipt>;
  assignMachine(farmerId: string, machineType: MachineType): Promise<AssignmentReceipt>;

  getCallSession(lang: Lang): Promise<CallSession>;
  bookKey(req: BookingRequest): Promise<BookingReceipt>;

  getCitizenAreas(): Promise<CitizenArea[]>;
  getCitizenSnapshot(areaId: string): Promise<CitizenSnapshot>;
  getAdvice(profile: HealthProfile, hour: number): Promise<AdviceResponse>;
  getRoutes(from: string, to: string): Promise<RoutesResponse>;
  submitReport(req: ReportRequest): Promise<ReportReceipt>;

  getRealtimeSnapshot(): Promise<RealtimeEvent[]>;
}

export type { RiskTier };
