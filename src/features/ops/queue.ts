import type { CompletionReceipt, CompletionRequest } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { readJson, writeJson } from '@/features/citizen/storage';

/**
 * Offline queue for work-order completions (ADR-15). A completion made without a connection waits here and is sent when the
 * device is online again. Each entry carries the `clientRequestId` made when the supervisor pressed Complete, so the server
 * treats a second send of the same entry as a duplicate and never records a second completion.
 */
const KEY = 'vayuswachh.ops.queue';
const MAX_QUEUED = 10;

export function queueList(): CompletionRequest[] {
  return readJson<CompletionRequest[]>(KEY) ?? [];
}
export function queueAdd(item: CompletionRequest): CompletionRequest[] {
  const list = queueList().filter((q) => q.clientRequestId !== item.clientRequestId && q.workOrderId !== item.workOrderId);   // one pending completion per order
  const next = [...list, item].slice(-MAX_QUEUED);
  writeJson(KEY, next);
  return next;
}
export function queueRemove(clientRequestId: string): void {
  writeJson(KEY, queueList().filter((q) => q.clientRequestId !== clientRequestId));
}

export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The server already has this completion (done earlier, or by the same request): drop it from the queue. */
function isSettled(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 409 || e.status === 404 || e.status === 410);
}

let inFlight: Promise<SyncResult> | null = null;
export interface SyncResult { sent: CompletionReceipt[]; dropped: string[]; remaining: number }

/**
 * Send queued completions one at a time. Overlapping calls (the `online` event and a page effect firing together) share one run,
 * so an entry is never sent by two loops at once. Network failures keep the entry for the next attempt.
 */
export function syncQueue(submit: (r: CompletionRequest) => Promise<CompletionReceipt>): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const sent: CompletionReceipt[] = [];
    const dropped: string[] = [];
    for (const item of queueList()) {
      try {
        sent.push(await submit(item));
        queueRemove(item.clientRequestId);
      } catch (e) {
        if (isSettled(e)) { queueRemove(item.clientRequestId); dropped.push(item.workOrderId); continue; }
        break;   // offline or server trouble: keep the rest, in order
      }
    }
    return { sent, dropped, remaining: queueList().length };
  })().finally(() => { inFlight = null; });
  return inFlight;
}
