import type { TerraPulseApi } from './contract';
import { ApiError } from './errors';

/** Thin fetch-based client for the real backend. Paths mirror contract.ts. */
export function createLiveApi(baseUrl: string): TerraPulseApi {
  const base = baseUrl.replace(/\/$/, '');

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Network unreachable', 0);
    }
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    return (await res.json()) as T;
  }
  const q = (params: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, String(v));
    const out = s.toString();
    return out ? `?${out}` : '';
  };
  const enc = encodeURIComponent;

  return {
    getAttribution: (cell) => request('GET', `/policy/attribution${q({ cell })}`),
    getPlume: () => request('GET', '/policy/plume'),
    getCompliance: () => request('GET', '/policy/compliance'),
    getHealth: () => request('GET', '/system/health'),
    getDirectivePreview: (type) => request('GET', `/policy/directives/preview${q({ type })}`),
    issueDirective: (type, areaIds) => request('POST', '/policy/directives', { type, areaIds }),

    getMachinery: () => request('GET', '/fpo/machinery'),
    getBiomass: () => request('GET', '/fpo/biomass'),
    getFarmers: () => request('GET', '/fpo/farmers'),
    getCallDetails: (id) => request('GET', `/fpo/farmers/${enc(id)}/call-details`),
    triggerVoiceCall: (id) => request('POST', `/fpo/farmers/${enc(id)}/call`),
    assignMachine: (id, machineType) => request('POST', `/fpo/farmers/${enc(id)}/assign`, { machineType }),

    getCallSession: (lang) => request('GET', `/farmer/call-session${q({ lang })}`),
    bookKey: (req) => request('POST', '/farmer/bookings', req),

    getCitizenAreas: () => request('GET', '/citizen/areas'),
    getCitizenSnapshot: (area) => request('GET', `/citizen/snapshot${q({ area })}`),
    getAdvice: (profile, hour) => request('GET', `/citizen/advice${q({ profile, hour })}`),
    getRoutes: (from, to) => request('GET', `/citizen/routes${q({ from, to })}`),
    submitReport: (req) => request('POST', '/citizen/reports', req),

    listWorkOrders: () => request('GET', '/ops/work-orders'),
    acceptWorkOrder: (id) => request('POST', `/ops/work-orders/${enc(id)}/accept`),
    completeWorkOrder: (req) => request('POST', `/ops/work-orders/${enc(req.workOrderId)}/complete`, req),

    getRealtimeSnapshot: () => request('GET', '/realtime/snapshot'),
  };
}
