export type HealthStatus = 'ok' | 'degraded' | 'down';

/** Agent coordination latency thresholds (ms). */
export function latencyStatus(ms: number): HealthStatus {
  if (!Number.isFinite(ms)) return 'down';
  if (ms < 500) return 'ok';
  if (ms < 1500) return 'degraded';
  return 'down';
}

/** CPCB stations online: all = ok, >= 90 % = degraded, below = down. */
export function stationsStatus(online: number, total: number): HealthStatus {
  if (total <= 0) return 'down';
  const r = online / total;
  if (r >= 0.99) return 'ok';
  if (r >= 0.9) return 'degraded';
  return 'down';
}

export function worstStatus(list: HealthStatus[]): HealthStatus {
  if (list.includes('down')) return 'down';
  if (list.includes('degraded')) return 'degraded';
  return 'ok';
}
