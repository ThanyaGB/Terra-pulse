import type { VayuApi } from './contract';
import { createTokenProvider } from './auth';
import { createLiveApi } from './live';
import { createMockApi } from './mock/mockApi';

function storageKeyMode(): 'mock' | 'live' | null {
  try {
    const v = localStorage.getItem('vs.apiMode');
    if (v === 'mock' || v === 'live') return v;
  } catch {
    // private / unavailable storage — fall through to env
  }
  return null;
}

export const API_MODE: 'mock' | 'live' = storageKeyMode() ?? (import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock');
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
export const WS_URL: string | undefined = import.meta.env.VITE_WS_URL || undefined;
export const POLL_INTERVAL_MS: number = Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 15000);
export const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

/** Dev sign-in tokens (per role), shared by the REST adapter and the WebSocket. Unused in mock mode. */
export const tokens = createTokenProvider(API_BASE_URL);

/** WebSocket URL with the JWT the backend requires as `?token=` (it closes with 4401 otherwise). */
export async function liveSocketUrl(): Promise<string | undefined> {
  if (!WS_URL) return undefined;
  const token = await tokens.token('policy_officer');
  return `${WS_URL}${WS_URL.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/** The single API instance every component imports. Switching VITE_API_MODE swaps the whole backend. */
export const api: VayuApi = API_MODE === 'live' ? createLiveApi(API_BASE_URL, tokens) : createMockApi();
