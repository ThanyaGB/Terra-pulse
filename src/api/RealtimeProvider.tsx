import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { API_MODE, POLL_INTERVAL_MS, api, liveSocketUrl } from './client';
import type { AgentStatus, RealtimeEvent } from './contract';
import { RealtimeClient, type ConnectionState } from './realtime';

export interface LiveAqi {
  areaId: string;
  areaName: string;
  aqi: number;
  pm25: number;
  ts: string;
}

export interface RealtimeSnapshot {
  connection: ConnectionState;
  aqi: Record<string, LiveAqi>;
  activeFires: number | null;
  newDetections: number;
  agents: Record<string, AgentStatus>;
  lastEventAt: string | null;
}

const empty: RealtimeSnapshot = { connection: 'connecting', aqi: {}, activeFires: null, newDetections: 0, agents: {}, lastEventAt: null };

type Action = { type: 'event'; event: RealtimeEvent } | { type: 'conn'; state: ConnectionState };

function reduce(s: RealtimeSnapshot, a: Action): RealtimeSnapshot {
  if (a.type === 'conn') return { ...s, connection: a.state };
  const e = a.event;
  switch (e.type) {
    case 'aqi':
      return { ...s, lastEventAt: e.ts, aqi: { ...s.aqi, [e.areaId]: { areaId: e.areaId, areaName: e.areaName, aqi: e.aqi, pm25: e.pm25, ts: e.ts } } };
    case 'fire':
      return { ...s, lastEventAt: e.ts, activeFires: e.activeFires, newDetections: e.newDetections };
    case 'agent':
      return { ...s, lastEventAt: e.ts, agents: { ...s.agents, [e.agent.id]: e.agent } };
  }
}

const Ctx = createContext<RealtimeSnapshot>(empty);

/** Mock mode: no socket exists, so a small simulator jitters the values while "live". */
function startMockStream(push: (e: RealtimeEvent) => void): () => void {
  let n = 0;
  const id = setInterval(() => {
    n += 1;
    const ts = new Date().toISOString();
    void api.getRealtimeSnapshot().then((events) => {
      for (const e of events) {
        if (e.type === 'aqi') push({ ...e, aqi: Math.round(e.aqi + Math.sin(n / 2 + e.areaId.length) * 9), pm25: Math.round(e.pm25 + Math.sin(n / 2) * 5), ts });
        else if (e.type === 'fire') push({ ...e, activeFires: e.activeFires + (n % 4 === 0 ? 3 : 0), newDetections: n % 4 === 0 ? 3 : 0, ts });
        else if (e.type === 'agent') push({ ...e, agent: { ...e.agent, latencyMs: Math.max(90, Math.round(e.agent.latencyMs + Math.sin(n + e.agent.name.length) * 60)) }, ts });
      }
    });
  }, 5000);
  return () => clearInterval(id);
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [snap, dispatch] = useReducer(reduce, empty);
  const [client] = useState(() => new RealtimeClient({
    getUrl: API_MODE === 'live' ? liveSocketUrl : undefined,
    fetchSnapshot: () => api.getRealtimeSnapshot(),
    pollIntervalMs: API_MODE === 'live' ? POLL_INTERVAL_MS : 60_000,
  }));

  useEffect(() => {
    const offE = client.subscribe((event) => dispatch({ type: 'event', event }));
    const offS = client.onState((state) => dispatch({ type: 'conn', state }));
    client.start();
    // In mock mode there is no socket: present the stream as live and drive it from the simulator.
    let stopMock: (() => void) | undefined;
    if (API_MODE === 'mock') {
      dispatch({ type: 'conn', state: 'live' });
      stopMock = startMockStream((event) => dispatch({ type: 'event', event }));
    }
    return () => {
      offE();
      offS();
      stopMock?.();
      client.stop();
    };
  }, [client]);

  const value = useMemo(() => (API_MODE === 'mock' && snap.connection !== 'offline' ? { ...snap, connection: 'live' as const } : snap), [snap]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRealtime(): RealtimeSnapshot {
  return useContext(Ctx);
}
