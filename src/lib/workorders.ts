import type { DirectiveReceipt, DirectiveType, WorkActionType, WorkOrder } from '@/api/contract';

/**
 * Demo work-order store shared by /policy (a directive creates orders) and /ops (supervisors accept and complete them).
 * Kept in localStorage so an order issued on the policy dashboard appears in the supervisor portal in the same browser,
 * like the GRAP banner on /citizen. With storage unavailable it falls back to memory for the session.
 */
const KEY = 'terrapulse.workorders';
const EVENT = 'terrapulse:workorders';

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function seed(): WorkOrder[] {
  return [
    { id: 'WO-A1F3C9', areaId: 'av-isbt', area: 'Anand Vihar, ISBT side', actionType: 'fog_cannons', status: 'created', dueBy: hours(3), createdAt: hours(-1), source: null, acceptedAt: null, completedAt: null, roi: null },
    { id: 'WO-B27D40', areaId: 'ito', area: 'ITO junction', actionType: 'road_sweeping', status: 'created', dueBy: hours(5), createdAt: hours(-1), source: null, acceptedAt: null, completedAt: null, roi: null },
    { id: 'WO-C90E11', areaId: 'pp-ind', area: 'Patparganj Industrial Area', actionType: 'dust_suppression', status: 'accepted', dueBy: hours(2), createdAt: hours(-3), source: null, acceptedAt: hours(-1), completedAt: null, roi: null },
    { id: 'WO-D5512A', areaId: 'okhla', area: 'Okhla Phase-2', actionType: 'fog_cannons', status: 'completed', dueBy: hours(-6), createdAt: hours(-12), source: null, acceptedAt: hours(-9), completedAt: hours(-7), roi: { deltaPm25: 38.5, controlArea: 'R.K. Puram' } },
  ];
}

let memory: WorkOrder[] | null = null;

export function getWorkOrders(): WorkOrder[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as WorkOrder[];
  } catch { /* storage unavailable or corrupt: use memory */ }
  memory ??= seed();
  saveWorkOrders(memory, false);
  return memory;
}

export function saveWorkOrders(list: WorkOrder[], notify = true): void {
  memory = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* memory only */ }
  if (notify && typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function subscribeWorkOrders(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); };
}

/** What the city has to do on the ground for each directive (demo mapping; truck diversion is a traffic-police job). */
const PLAN: Record<DirectiveType, { areaId: string; area: string; actionType: WorkActionType; dueH: number }[]> = {
  grap_ii: [
    { areaId: 'av-isbt', area: 'Anand Vihar, ISBT side', actionType: 'fog_cannons', dueH: 2 },
    { areaId: 'ito', area: 'ITO junction', actionType: 'road_sweeping', dueH: 3 },
    { areaId: 'pp-ind', area: 'Patparganj Industrial Area', actionType: 'dust_suppression', dueH: 4 },
  ],
  fog_cannons: [
    { areaId: 'av-204', area: 'Anand Vihar, Colony 204', actionType: 'fog_cannons', dueH: 2 },
    { areaId: 'pp-mv', area: 'Patparganj, Mayur Vihar Ph-1', actionType: 'fog_cannons', dueH: 3 },
  ],
  diversion_trucks: [],
};

const shortTitle: Record<DirectiveType, string> = { grap_ii: 'GRAP-II alert', fog_cannons: 'Fog cannon order', diversion_trucks: 'Truck diversion' };

/** Turn an issued directive into work orders for municipal supervisors. Returns how many were created. */
export function createWorkOrdersFor(receipt: DirectiveReceipt): number {
  const plan = PLAN[receipt.type];
  if (plan.length === 0) return 0;
  const tag = receipt.id.replace(/^DIR-?/, '').slice(-4).toUpperCase();
  const made: WorkOrder[] = plan.map((p, i) => ({
    id: `WO-${tag}${i + 1}`,
    areaId: p.areaId,
    area: p.area,
    actionType: p.actionType,
    status: 'created',
    dueBy: hours(p.dueH),
    createdAt: receipt.issuedAt,
    source: `${shortTitle[receipt.type]} · ${receipt.id}`,
    acceptedAt: null,
    completedAt: null,
    roi: null,
  }));
  saveWorkOrders([...made, ...getWorkOrders().filter((w) => !made.some((m) => m.id === w.id))]);
  return made.length;
}

export const workOrdersPlannedFor = (type: DirectiveType): number => PLAN[type].length;
