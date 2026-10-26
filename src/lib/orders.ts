import type { DirectiveReceipt, DirectiveType } from '@/api/contract';
import { createWorkOrdersFor } from './workorders';

/** Session-shared state between /policy (writes), /citizen (reads the GRAP banner) and /ops (gets the work orders). */
const ORDERS_KEY = 'vayuswachh.orders';
const GRAP_KEY = 'vayuswachh.grap';
const EVENT = 'vayuswachh:orders';

export interface OrderEntry { id: string; type: DirectiveType; title: string; issuedAt: string }

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } }

export const getOrders = (): OrderEntry[] => read<OrderEntry[]>(ORDERS_KEY, []);
export const isGrapActive = (): boolean => read<boolean>(GRAP_KEY, false);

/** Logs the directive and hands its on-the-ground tasks to the supervisor portal. Returns the number of work orders created. */
export function recordOrder(receipt: DirectiveReceipt, title: string): number {
  write(ORDERS_KEY, [{ id: receipt.id, type: receipt.type, title, issuedAt: receipt.issuedAt }, ...getOrders()].slice(0, 20));
  if (receipt.type === 'grap_ii') write(GRAP_KEY, true);
  const made = createWorkOrdersFor(receipt);
  window.dispatchEvent(new Event(EVENT));
  return made;
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
