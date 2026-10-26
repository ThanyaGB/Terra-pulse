import type { VayuApi } from './contract';
import { createLiveApi } from './live';
import { createMockApi } from './mock/mockApi';

export const API_MODE: 'mock' | 'live' = import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock';
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
export const WS_URL: string | undefined = import.meta.env.VITE_WS_URL || undefined;
export const POLL_INTERVAL_MS: number = Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 15000);
export const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

/** The single API instance every component imports. Switching VITE_API_MODE swaps the whole backend. */
export const api: VayuApi = API_MODE === 'live' ? createLiveApi(API_BASE_URL) : createMockApi();
