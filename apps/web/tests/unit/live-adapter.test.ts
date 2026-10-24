import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@/api-client';
import { createLiveApi, envelopeToEvents } from '@/api/live';

/** Payloads copied from real responses of the backend (packages/contracts/openapi.json). */
const responses: Record<string, unknown> = {
  '/risk/parcels': {
    items: [{ parcel_id: 'PCL-SGR-0530', village: 'Sherpur', farmer_name: 'Gurpreet Kaur', acres: 17, harvest_date: '2026-10-30', score: 46.8, tier: 'medium',
      machine_need: 'baler', status: 'to_contact', last_contact_at: null }],
    villages: ['Sherpur', 'Sunam'],
  },
  '/machinery/status': { types: [{ type: 'baler', label: 'Baler', total: 5, in_use: 2, utilisation_pct: 40 }] },
  '/aqi/community/av-204': {
    community_id: 'av-204', name: 'Anand Vihar, Colony 204', aqi: 279, pm25: 113.6, source_mix: { straw_plume: 1.2, vehicle: 14.2, dust: 64.1, industrial_waste: 20.5 },
    alerts: [{ id: 'inversion', kind: 'inversion', title: 't', body: 'b', startMin: 300, endMin: 600, severity: 'warning' }], updated_at: '2026-10-23T15:30:00Z',
  },
  '/pipeline/health': {
    quality: { freshness_min: { firms: 1.2 }, status: { firms: 'ok', cpcb: 'ok', weather: 'degraded' }, origin: { firms: 'live', cpcb: 'live', weather: 'fixture' }, stations: { online: 9, total: 9 } },
    agents: [{ agent: 'risk_agent', status: 'ok', last_latency_ms: 12.4, events_processed: 3 }], fires: { active: 368, clusters: 263 },
  },
  '/work-orders': { items: [{ id: 'WO-1', area_id: 'ito', area: 'ITO', action_type: 'fog_cannons', grap_tier: 'stage_3', status: 'completed', created_at: 'x', due_by: '2026-10-24T10:00:00Z',
    sla_breached: false, accepted_by: 's', accepted_at: 'a', completed_at: 'c', completion_grid_ref: 'G', roi_window: null, roi: { delta_pm25: 31.5, control_area: 'rk-puram', measured_at: 'm' } }] },
  '/calls/session': { session_id: 'SES-1', parcel_id: 'PCL-SGR-0530', caller_name: 'Sangrur Machinery Cooperative', caller_id: '01672-XXXXXX', farmer_first_name: 'Gurpreet',
    audio_url: null, lines: ['a', 'b'], prices: { super_seeder_per_acre: null, straw_per_tonne: null } },
  '/plume/projection': { generatedAt: 'x', horizonHours: 72, windSpeedKmh: 4, sources: [], corridor: [], hoursToReachNcr: null, streets: [] },
};

function fakeClient(): { client: Client; calls: string[] } {
  const calls: string[] = [];
  const client: Client = {
    token: async () => 't',
    get: vi.fn(async (path: string, _role, query) => { calls.push(path + (query ? `?${new URLSearchParams(query as Record<string, string>)}` : '')); return responses[path] as never; }),
    post: vi.fn(async () => ({}) as never),
    download: vi.fn(async () => ({ blob: new Blob(['%PDF']), filename: 'advisory-DIR-1.pdf' })),
  };
  return { client, calls };
}

describe('live adapter maps the spec API onto the UI contract', () => {
  it('parcels become farmers with village names and rounded risk', async () => {
    const { client } = fakeClient();
    const r = await createLiveApi('http://x/v1', client).getFarmers();
    expect(r.villages).toEqual(['Sherpur', 'Sunam']);
    expect(r.farmers[0]).toMatchObject({ id: 'PCL-SGR-0530', village: 'Sherpur', riskScore: 47, machineNeed: 'baler', status: 'to_contact' });
  });

  it('machinery utilisation uses camelCase counts', async () => {
    const { client } = fakeClient();
    expect(await createLiveApi('http://x/v1', client).getMachinery()).toEqual([{ type: 'baler', label: 'Baler', total: 5, inUse: 2 }]);
  });

  it('community card becomes a citizen snapshot with labelled source mix', async () => {
    const { client } = fakeClient();
    const s = await createLiveApi('http://x/v1', client).getCitizenSnapshot('av-204');
    expect(s.areaName).toBe('Anand Vihar, Colony 204');
    expect(s.pm25).toBe(114);
    expect(s.mix.map((m) => m.label)).toEqual(['Upstream straw plume', 'Transport arterials', 'Dust & construction', 'Industry & waste burning']);
    expect(s.mix.reduce((a, m) => a + m.pct, 0)).toBeCloseTo(100, 1);
  });

  it('pipeline health maps statuses and keeps the origin in the detail', async () => {
    const { client } = fakeClient();
    const h = await createLiveApi('http://x/v1', client).getHealth();
    expect(h.items.find((i) => i.id === 'weather')).toMatchObject({ status: 'degraded' });
    expect(h.items.find((i) => i.id === 'firms')!.detail).toContain('368 hotspots');
    expect(h.cpcb).toEqual({ online: 9, total: 9 });
    expect(h.agents[0]).toMatchObject({ id: 'risk_agent', latencyMs: 12 });
  });

  it('a plume that does not reach NCR within the horizon reports the horizon', async () => {
    const { client } = fakeClient();
    expect((await createLiveApi('http://x/v1', client).getPlume()).hoursToReachNcr).toBe(72);
  });

  it('commute free text maps to two different monitored communities', async () => {
    const { client, calls } = fakeClient();
    responses['/routes/clean'] = { options: [{ id: 'A', name: 'Route A', segments: [{ minutes: 5, aqi: 300, label: 'Arterial road' }] }] };
    const r = await createLiveApi('http://x/v1', client).getRoutes('Laxmi Nagar', 'Laxmi Nagar');
    const q = new URLSearchParams(calls[0]!.split('?')[1]);
    expect(q.get('from')).not.toBe(q.get('to'));
    expect(r.options[0]!.via).toBe('Arterial road');
  });
});

describe('websocket envelope', () => {
  it('translates aqi.update, fire and agent frames to realtime events', () => {
    const ts = '2026-10-23T10:00:00Z';
    expect(envelopeToEvents({ channel: 'aqi.update', ts, payload: { area_id: 'ito', name: 'ITO', aqi: 250, pm25: 99 } })[0]).toMatchObject({ type: 'aqi', areaId: 'ito', aqi: 250 });
    expect(envelopeToEvents({ channel: 'agent.status', ts, payload: { kind: 'fire', active_fires: 368, new_detections: 4 } })[0]).toMatchObject({ type: 'fire', activeFires: 368 });
    expect(envelopeToEvents({ channel: 'agent.status', ts, payload: { kind: 'agent', agent: 'risk_agent', status: 'ok', last_latency_ms: 3.2 } })[0]).toMatchObject({ type: 'agent', agent: { id: 'risk_agent' } });
    expect(envelopeToEvents({ channel: 'alert.fired', ts, payload: {} })).toEqual([]);
  });
});

describe('live adapter: supervisor portal', () => {
  it('maps work orders including the measured ROI', async () => {
    const { client } = fakeClient();
    const [w] = await createLiveApi('http://x/v1', client).listWorkOrders();
    expect(w).toMatchObject({ id: 'WO-1', areaId: 'ito', actionType: 'fog_cannons', status: 'completed', dueBy: '2026-10-24T10:00:00Z', roi: { deltaPm25: 31.5, controlArea: 'rk-puram' } });
  });

  it('sends photo, GPS and the client request id as multipart, as the supervisor role', async () => {
    const { client } = fakeClient();
    const post = client.post as unknown as ReturnType<typeof vi.fn>;
    post.mockResolvedValueOnce({ id: 'WO-1', area_id: 'ito', area: 'ITO', action_type: 'fog_cannons', status: 'completed', due_by: 'x', sla_breached: false, accepted_at: null, completed_at: 'c', roi: null, duplicate: true });
    const r = await createLiveApi('http://x/v1', client).completeWorkOrder({ workOrderId: 'WO-1', clientRequestId: 'req-12345678', photoDataUrl: 'data:image/jpeg;base64,AAAA', lat: 28.6, lng: 77.3, capturedAt: 'x' });
    const [path, role, body] = post.mock.calls[0]!;
    expect(path).toBe('/work-orders/WO-1/complete');
    expect(role).toBe('municipal_supervisor');
    expect((body as FormData).get('client_request_id')).toBe('req-12345678');
    expect((body as FormData).get('lat')).toBe('28.6');
    expect(r.duplicate).toBe(true);
  });

  it('keypad: sends the choice, then the confirming 1, as the farmer, in the call language', async () => {
    const { client } = fakeClient();
    const post = client.post as unknown as ReturnType<typeof vi.fn>;
    post.mockResolvedValueOnce({ key: '9', status: 'awaiting_confirmation', prompt: 'confirm_9', prompt_text: 'x' })
      .mockResolvedValueOnce({ key: '9', status: 'callback_unscheduled', reference_id: 'FPO-C-0001', slot: null });
    const api = createLiveApi('http://x/v1', client);
    const s = await api.getCallSession('pa');
    const r = await api.bookKey({ sessionId: s.sessionId, key: '9', lang: 'pa' });
    expect(post.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ['/calls/keypress', 'farmer', { parcel_id: 'PCL-SGR-0530', key: '9', lang: 'pa' }],
      ['/calls/keypress', 'farmer', { parcel_id: 'PCL-SGR-0530', key: '1', lang: 'pa' }],
    ]);
    expect(r).toEqual({ referenceId: 'FPO-C-0001', key: '9', status: 'callback_unscheduled', slot: null });
  });
});
