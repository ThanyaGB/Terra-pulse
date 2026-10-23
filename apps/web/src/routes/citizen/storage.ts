import type { ReportRequest } from '@/api/contract';

/** Tiny localStorage helpers that never throw (private mode, quota, blocked storage). */
export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export interface Cached<T> { data: T; at: string }

export function cacheSet<T>(key: string, data: T): void {
  writeJson(`vs.cache.${key}`, { data, at: new Date().toISOString() } satisfies Cached<T>);
}
export function cacheGet<T>(key: string): Cached<T> | null {
  return readJson<Cached<T>>(`vs.cache.${key}`);
}

/** Try the network, remember the answer, and fall back to the last saved copy when offline. */
export async function withCache<T>(key: string, load: () => Promise<T>): Promise<{ data: T; stale: boolean; at: string | null }> {
  try {
    const data = await load();
    cacheSet(key, data);
    return { data, stale: false, at: null };
  } catch (e) {
    const hit = cacheGet<T>(key);
    if (hit) return { data: hit.data, stale: true, at: hit.at };
    throw e;
  }
}

/* ----- outbox for reports made while offline ----- */
const OUTBOX = 'vs.outbox';
export function outboxList(): ReportRequest[] {
  return readJson<ReportRequest[]>(OUTBOX) ?? [];
}
export function outboxAdd(req: ReportRequest): void {
  const list = outboxList();
  // keep at most 5 and drop oversized photos so we never blow the storage quota
  const slim = req.photoDataUrl && req.photoDataUrl.length > 1_200_000 ? { ...req, photoDataUrl: null } : req;
  writeJson(OUTBOX, [...list, slim].slice(-5));
}
export function outboxReplace(list: ReportRequest[]): void {
  writeJson(OUTBOX, list);
}
