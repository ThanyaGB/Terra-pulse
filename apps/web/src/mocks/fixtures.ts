import type {
  AgentStatus, AttributionResponse, BiomassStatus, CitizenArea, CitizenSnapshot, ComplianceResponse, Farmer,
  GridCell, HealthItem, MachineryStatus, MachineType, PlumeResponse, SourceShare, WorkOrder,
} from '@/api/contract';

/** All values below are simulated demo data. */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- policy ---------------- */
export const GRID_CELLS: GridCell[] = [
  { id: 'narela', label: 'Narela', lat: 28.8527, lng: 77.0929 },
  { id: 'rohini', label: 'Rohini', lat: 28.7495, lng: 77.0565 },
  { id: 'punjabi-bagh', label: 'Punjabi Bagh', lat: 28.6742, lng: 77.131 },
  { id: 'anand-vihar', label: 'Anand Vihar', lat: 28.6469, lng: 77.3152 },
  { id: 'ito', label: 'ITO', lat: 28.6289, lng: 77.241 },
  { id: 'dwarka', label: 'Dwarka', lat: 28.5921, lng: 77.046 },
  { id: 'rk-puram', label: 'R.K. Puram', lat: 28.5633, lng: 77.1869 },
  { id: 'okhla', label: 'Okhla', lat: 28.5355, lng: 77.275 },
];

export const NCR_SHARES: SourceShare[] = [
  { source: 'straw_plume', pct: 36 },
  { source: 'vehicle', pct: 28 },
  { source: 'dust', pct: 21 },
  { source: 'industrial_waste', pct: 15 },
];

const CELL_SHARES: Record<string, [number, number, number, number]> = {
  narela: [31, 18, 17, 34],
  rohini: [47, 26, 14, 13],
  'punjabi-bagh': [38, 33, 17, 12],
  'anand-vihar': [42, 38, 12, 8],
  ito: [35, 41, 16, 8],
  dwarka: [39, 24, 26, 11],
  'rk-puram': [33, 30, 28, 9],
  okhla: [29, 27, 14, 30],
};

export function attributionFor(cellId?: string): AttributionResponse {
  const cell = GRID_CELLS.find((c) => c.id === cellId) ?? GRID_CELLS[3]!;
  const [a, b, c, d] = CELL_SHARES[cell.id]!;
  return {
    cell: {
      id: cell.id,
      label: cell.label,
      shares: [
        { source: 'straw_plume', pct: a },
        { source: 'vehicle', pct: b },
        { source: 'dust', pct: c },
        { source: 'industrial_waste', pct: d },
      ],
    },
    ncr: { shares: NCR_SHARES },
    cells: GRID_CELLS,
    updatedAt: new Date().toISOString(),
  };
}

export const PLUME: PlumeResponse = {
  generatedAt: new Date().toISOString(),
  horizonHours: 72,
  windSpeedKmh: 22,
  sources: [
    { id: 'sangrur', name: 'Sangrur cluster', lat: 30.2458, lng: 75.8421, fires: 86 },
    { id: 'patiala', name: 'Patiala cluster', lat: 30.3398, lng: 76.3869, fires: 61 },
    { id: 'malerkotla', name: 'Malerkotla cluster', lat: 30.5309, lng: 75.8801, fires: 34 },
  ],
  corridor: [
    [75.8421, 30.2458],
    [76.3869, 30.3398],
    [76.7794, 30.3782],
    [76.9905, 29.6857],
    [76.9635, 29.3909],
    [77.1025, 28.7041],
    [77.3152, 28.6469],
  ],
  hoursToReachNcr: 12,
  streets: [
    { id: 'narela', name: 'Narela', lat: 28.8527, lng: 77.0929, etaHours: 9, peakPm25: 420, hoursToPeak: 7, baselinePm25: 96 },
    { id: 'rohini', name: 'Rohini', lat: 28.7495, lng: 77.0565, etaHours: 10, peakPm25: 390, hoursToPeak: 7, baselinePm25: 104 },
    { id: 'punjabi-bagh', name: 'Punjabi Bagh', lat: 28.6742, lng: 77.131, etaHours: 11, peakPm25: 380, hoursToPeak: 8, baselinePm25: 112 },
    { id: 'anand-vihar', name: 'Anand Vihar', lat: 28.6469, lng: 77.3152, etaHours: 12, peakPm25: 462, hoursToPeak: 8, baselinePm25: 128 },
    { id: 'ito', name: 'ITO', lat: 28.6289, lng: 77.241, etaHours: 12, peakPm25: 410, hoursToPeak: 8, baselinePm25: 120 },
    { id: 'dwarka', name: 'Dwarka', lat: 28.5921, lng: 77.046, etaHours: 13, peakPm25: 330, hoursToPeak: 9, baselinePm25: 90 },
    { id: 'rk-puram', name: 'R.K. Puram', lat: 28.5633, lng: 77.1869, etaHours: 14, peakPm25: 350, hoursToPeak: 9, baselinePm25: 98 },
    { id: 'okhla', name: 'Okhla', lat: 28.5355, lng: 77.275, etaHours: 16, peakPm25: 340, hoursToPeak: 9, baselinePm25: 118 },
  ],
};

export const COMPLIANCE: ComplianceResponse = {
  strawCollectedTonnes: 18420,
  strawTargetTonnes: 30000,
  chc: { utilisationPct: 63, machinesInUse: 12, machinesTotal: 19 },
  fogCannons: { inTransit: 6, deployed: 14, planned: 24 },
  monitoredStreets: [
    { id: 'anand-vihar', name: 'Anand Vihar', beforePm25: 214, afterPm25: 176 },
    { id: 'rohini', name: 'Rohini', beforePm25: 187, afterPm25: 159 },
    { id: 'ito', name: 'ITO', beforePm25: 201, afterPm25: 182 },
    { id: 'okhla', name: 'Okhla', beforePm25: 168, afterPm25: 149 },
    { id: 'dwarka', name: 'Dwarka', beforePm25: 148, afterPm25: 141 },
  ],
  updatedAt: new Date().toISOString(),
};

export const AGENTS: AgentStatus[] = [
  { id: 'fire', name: 'Fire Sentinel', status: 'ok', latencyMs: 180 },
  { id: 'plume', name: 'Plume Forecaster', status: 'ok', latencyMs: 320 },
  { id: 'source', name: 'Source Attributor', status: 'ok', latencyMs: 410 },
  { id: 'outreach', name: 'Outreach Caller', status: 'degraded', latencyMs: 880 },
  { id: 'dispatch', name: 'Dispatch Planner', status: 'ok', latencyMs: 260 },
];

export function healthItems(now = new Date()): HealthItem[] {
  const iso = now.toISOString();
  return [
    { id: 'firms', label: 'NASA FIRMS', status: 'ok', detail: 'Last satellite pass 14 min ago', updatedAt: iso },
    { id: 'cpcb', label: 'CPCB stations', status: 'degraded', detail: '39/40 online, Bawana offline', updatedAt: iso },
    { id: 'imd', label: 'IMD wind data', status: 'ok', detail: '3-hourly grid, next run 17:30', updatedAt: iso },
    { id: 'agents', label: 'Agent coordination', status: 'ok', detail: 'Median latency 320 ms', updatedAt: iso },
  ];
}

/* ---------------- fpo ---------------- */
export const VILLAGES = [
  'Bhawanigarh', 'Sunam', 'Dhuri', 'Lehragaga', 'Dirba', 'Moonak', 'Longowal',
  'Cheema', 'Ladda', 'Kauhrian', 'Sherpur', 'Andana', 'Balian', 'Ghabdan',
];

export const MACHINERY: MachineryStatus[] = [
  { type: 'super_seeder', label: 'Super Seeder', total: 6, inUse: 4 },
  { type: 'baler', label: 'Balers', total: 5, inUse: 3 },
  { type: 'happy_seeder', label: 'Happy Seeder', total: 8, inUse: 5 },
];

export const BIOMASS: BiomassStatus = {
  plant: 'Bio-CNG plant, Sangrur',
  floorPriceInrPerTonne: 1650,
  tonnesRemovedToday: 142.5,
  cumulativeAcres: 3860,
  trucksToday: 17,
};

const FIRST = ['Gurpreet', 'Harnek', 'Balwinder', 'Jaswant', 'Manpreet', 'Sukhdev', 'Amarjit', 'Kulwinder', 'Satnam', 'Paramjit', 'Rajinder', 'Gurmeet', 'Jagdev', 'Baljit', 'Lakhwinder', 'Davinder', 'Surjit', 'Harpreet', 'Nirmal', 'Tarsem', 'Gurdev', 'Mukhtiar', 'Charanjit', 'Avtar'];
const LAST = ['Singh', 'Kaur'];

export function makeFarmers(now = Date.now()): Farmer[] {
  const rnd = mulberry32(2026);
  const needs: MachineType[] = ['super_seeder', 'baler', 'happy_seeder'];
  return Array.from({ length: 24 }, (_, i) => {
    const village = VILLAGES[i % VILLAGES.length]!;
    const female = i % 4 === 2;
    const first = FIRST[i % FIRST.length]!;
    const risk = Math.round(35 + rnd() * 62);
    const daysToHarvest = Math.max(2, Math.round(16 - risk / 8 + rnd() * 3));
    const contacted = rnd() > 0.35;
    const hoursAgo = Math.round(2 + rnd() * 70);
    return {
      id: `PB-SGR-${String(1100 + i * 37).padStart(4, '0')}`,
      name: `${first} ${female ? 'Kaur' : LAST[0]}`,
      village,
      acres: Math.round(3 + rnd() * 14),
      harvestDate: new Date(now + daysToHarvest * 86400_000).toISOString(),
      riskScore: risk,
      lastContactAt: contacted ? new Date(now - hoursAgo * 3600_000).toISOString() : null,
      status: contacted ? (rnd() > 0.5 ? 'called' : 'confirmed') : 'to_contact',
      machineNeed: needs[Math.floor(rnd() * 3)]!,
    } satisfies Farmer;
  }).sort((a, b) => b.riskScore - a.riskScore);
}

export const OPERATORS: Record<MachineType, { operatorName: string; phone: string; base: string }[]> = {
  baler: [
    { operatorName: 'Jagtar Singh', phone: '9872112345', base: 'Bhawanigarh CHC' },
    { operatorName: 'Ranjit Singh', phone: '9815534120', base: 'Sunam CHC' },
  ],
  super_seeder: [
    { operatorName: 'Baldev Singh', phone: '9872198760', base: 'Dhuri CHC' },
    { operatorName: 'Gurnam Singh', phone: '9988123456', base: 'Lehragaga CHC' },
  ],
  happy_seeder: [
    { operatorName: 'Sewak Singh', phone: '9876054321', base: 'Dirba CHC' },
    { operatorName: 'Amrik Singh', phone: '9814067890', base: 'Moonak CHC' },
  ],
};

/* ---------------- citizen ---------------- */
export const CITIZEN_AREAS: CitizenArea[] = [
  { id: 'av-204', name: 'Anand Vihar, Colony 204', detail: 'East Delhi · near ISBT' },
  { id: 'av-isbt', name: 'Anand Vihar, ISBT side', detail: 'East Delhi · arterial road' },
  { id: 'pp-mv', name: 'Patparganj, Mayur Vihar Ph-1', detail: 'East Delhi · residential' },
  { id: 'pp-ind', name: 'Patparganj Industrial Area', detail: 'East Delhi · industrial' },
];

const SNAP: Record<string, { aqi: number; pm25: number; mix: [number, number, number, number] }> = {
  'av-204': { aqi: 362, pm25: 214, mix: [42, 38, 12, 8] },
  'av-isbt': { aqi: 391, pm25: 236, mix: [36, 48, 10, 6] },
  'pp-mv': { aqi: 318, pm25: 187, mix: [44, 31, 16, 9] },
  'pp-ind': { aqi: 345, pm25: 205, mix: [35, 27, 14, 24] },
};

export function citizenSnapshot(areaId: string, now = new Date()): CitizenSnapshot {
  const area = CITIZEN_AREAS.find((a) => a.id === areaId) ?? CITIZEN_AREAS[0]!;
  const s = SNAP[area.id]!;
  return {
    areaId: area.id,
    areaName: area.name,
    aqi: s.aqi,
    pm25: s.pm25,
    mix: [
      { label: 'Upstream straw plume', pct: s.mix[0] },
      { label: 'Transport arterials', pct: s.mix[1] },
      { label: 'Dust & construction', pct: s.mix[2] },
      { label: 'Industry & waste burning', pct: s.mix[3] },
    ],
    alerts: [
      { id: 'inv', kind: 'inversion', severity: 'warning', title: 'Inversion warning', body: 'Smoke is trapped near the ground. Avoid outdoor exercise and keep windows shut.', startMin: 6 * 60, endMin: 10 * 60 + 30 },
      { id: 'vent', kind: 'ventilation', severity: 'info', title: 'Ventilation window', body: 'Winds pick up and pollutants disperse. Air out rooms and do outdoor errands now.', startMin: 13 * 60 + 30, endMin: 16 * 60 },
      { id: 'traffic', kind: 'peak_traffic', severity: 'warning', title: 'Evening traffic peak', body: 'Traffic fumes build up along arterial roads. Use inner lanes where you can.', startMin: 17 * 60 + 30, endMin: 20 * 60 + 30 },
    ],
    updatedAt: now.toISOString(),
  };
}

/** Supervisor work orders (simulated). Two are open, one is accepted, one is finished with a measured ROI. */
export const WORK_ORDERS: WorkOrder[] = (() => {
  const t = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  return [
    { id: 'WO-A1F3C9', areaId: 'anand-vihar', area: 'Anand Vihar', actionType: 'fog_cannons', status: 'created', dueBy: t(3), slaBreached: false, acceptedAt: null, completedAt: null, roi: null },
    { id: 'WO-B27D40', areaId: 'ito', area: 'ITO', actionType: 'road_sweeping', status: 'created', dueBy: t(5), slaBreached: false, acceptedAt: null, completedAt: null, roi: null },
    { id: 'WO-C90E11', areaId: 'patparganj', area: 'Patparganj', actionType: 'dust_suppression', status: 'accepted', dueBy: t(2), slaBreached: false, acceptedAt: t(-1), completedAt: null, roi: null },
    { id: 'WO-D5512A', areaId: 'okhla', area: 'Okhla', actionType: 'fog_cannons', status: 'completed', dueBy: t(-6), slaBreached: false, acceptedAt: t(-9), completedAt: t(-7), roi: { deltaPm25: 38.5, controlArea: 'rk-puram' } },
  ];
})();
