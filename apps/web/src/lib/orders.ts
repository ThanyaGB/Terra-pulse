import type { DirectiveReceipt, DirectiveType } from '@/api/contract';

/** Session-shared state between /policy (writes) and /citizen (reads the GRAP banner). */
const ORDERS_KEY = 'vayu.orders';
const GRAP_KEY = 'vayu.grap';
const EVENT = 'vayu:orders';

export interface OrderEntry { id: string; type: DirectiveType; title: string; issuedAt: string }

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } }

export const getOrders = (): OrderEntry[] => read<OrderEntry[]>(ORDERS_KEY, []);
export const isGrapActive = (): boolean => read<boolean>(GRAP_KEY, false);

export function recordOrder(receipt: DirectiveReceipt, title: string) {
  write(ORDERS_KEY, [{ id: receipt.id, type: receipt.type, title, issuedAt: receipt.issuedAt }, ...getOrders()].slice(0, 20));
  if (receipt.type === 'grap_ii') write(GRAP_KEY, true);
  window.dispatchEvent(new Event(EVENT));
}

export function clearOrders() {
  write(ORDERS_KEY, []); write(GRAP_KEY, false);
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeOrders(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); };
}
