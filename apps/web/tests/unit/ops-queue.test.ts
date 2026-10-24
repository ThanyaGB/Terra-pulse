import { beforeEach, describe, expect, it } from 'vitest';
import type { CompletionReceipt, CompletionRequest, WorkOrder } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { createMockApi } from '@/mocks/mockApi';
import { newRequestId, queueAdd, queueList, syncQueue } from '@/routes/ops/queue';

const req = (id: string, wo = 'WO-C90E11'): CompletionRequest => ({ workOrderId: wo, clientRequestId: id, photoDataUrl: 'data:image/jpeg;base64,AAAA', lat: 28.6469, lng: 77.3152, capturedAt: '2026-10-24T10:00:00Z' });
const receipt = (duplicate = false): CompletionReceipt => ({ duplicate, workOrder: { id: 'WO-C90E11', status: 'completed' } as WorkOrder });

describe('supervisor offline queue', () => {
  beforeEach(() => { localStorage.clear(); });

  it('keeps one pending completion per work order and per request id', () => {
    queueAdd(req('req-aaaaaaaa'));
    queueAdd(req('req-aaaaaaaa'));
    queueAdd(req('req-bbbbbbbb'));            // same order again: replaces the earlier entry
    expect(queueList().map((q) => q.clientRequestId)).toEqual(['req-bbbbbbbb']);
  });

  it('sends a queued completion once, even when two triggers fire together', async () => {
    queueAdd(req('req-aaaaaaaa'));
    const sent: string[] = [];
    const submit = async (r: CompletionRequest) => { sent.push(r.clientRequestId); await new Promise((res) => setTimeout(res, 20)); return receipt(); };
    const [a, b] = await Promise.all([syncQueue(submit), syncQueue(submit)]);
    expect(sent).toEqual(['req-aaaaaaaa']);
    expect(b).toBe(a);                          // both callers got the same run
    expect(a.sent).toHaveLength(1);
    expect(queueList()).toEqual([]);
    await syncQueue(submit);                    // a later sync finds nothing to send
    expect(sent).toHaveLength(1);
  });

  it('keeps the entry when offline and retries later with the SAME request id', async () => {
    queueAdd(req('req-aaaaaaaa'));
    let online = false;
    const seen: string[] = [];
    const submit = async (r: CompletionRequest) => { seen.push(r.clientRequestId); if (!online) throw new ApiError('Network unreachable', 0); return receipt(); };
    expect((await syncQueue(submit)).remaining).toBe(1);
    online = true;
    expect((await syncQueue(submit)).remaining).toBe(0);
    expect(seen).toEqual(['req-aaaaaaaa', 'req-aaaaaaaa']);
  });

  it('drops an entry the server already has (409) instead of retrying forever', async () => {
    queueAdd(req('req-aaaaaaaa'));
    const r = await syncQueue(async () => { throw new ApiError('Already completed', 409); });
    expect(r.dropped).toEqual(['WO-C90E11']);
    expect(queueList()).toEqual([]);
  });

  it('makes distinct, valid request ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('mock work-order API', () => {
  it('refuses completion before acceptance and treats a repeated request id as a duplicate', async () => {
    const api = createMockApi();
    const orders = await api.listWorkOrders();
    const fresh = orders.find((o) => o.status === 'created')!;
    await expect(api.completeWorkOrder(req('req-cccccccc', fresh.id))).rejects.toMatchObject({ status: 409 });
    await api.acceptWorkOrder(fresh.id);
    const first = await api.completeWorkOrder(req('req-cccccccc', fresh.id));
    const again = await api.completeWorkOrder(req('req-cccccccc', fresh.id));
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.workOrder.completedAt).toBe(first.workOrder.completedAt);
    await expect(api.completeWorkOrder(req('req-dddddddd', fresh.id))).rejects.toMatchObject({ status: 409 });
  });

  it('shows the ROI only on orders where it was measured', async () => {
    const api = createMockApi();
    const done = (await api.listWorkOrders()).filter((o) => o.status === 'completed');
    expect(done.length).toBeGreaterThan(0);
    expect(done[0]!.roi?.deltaPm25).toBeGreaterThan(0);
  });
});
