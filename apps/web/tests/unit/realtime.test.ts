import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEvent } from '@/api/contract';
import { RealtimeClient, type ConnectionState, type SocketLike } from '@/api/realtime';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  closed = false;
  close() { this.closed = true; }
}

const aqi = (n: number): RealtimeEvent => ({ type: 'aqi', areaId: 'av-204', areaName: 'Anand Vihar', aqi: n, pm25: 100, ts: '2026-10-23T10:00:00Z' });

describe('RealtimeClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(fetchSnapshot = vi.fn(async () => [aqi(300)])) {
    const sockets: FakeSocket[] = [];
    const client = new RealtimeClient({ url: 'ws://x', createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; }, fetchSnapshot, pollIntervalMs: 1000, reconnectMs: 5000 });
    const states: ConnectionState[] = [];
    const events: RealtimeEvent[] = [];
    client.onState((s) => states.push(s));
    client.subscribe((e) => events.push(e));
    return { client, sockets, states, events, fetchSnapshot };
  }

  it('goes live when the socket opens and forwards messages', () => {
    const { client, sockets, states, events } = setup();
    client.start();
    sockets[0]!.onopen?.();
    sockets[0]!.onmessage?.({ data: JSON.stringify(aqi(362)) });
    sockets[0]!.onmessage?.({ data: JSON.stringify([aqi(1), aqi(2)]) });
    sockets[0]!.onmessage?.({ data: 'not json' });
    expect(states).toEqual(['connecting', 'live']);
    expect(events.map((e) => (e.type === 'aqi' ? e.aqi : 0))).toEqual([362, 1, 2]);
  });

  it('falls back to polling when the socket drops, then returns to the socket when it reconnects', async () => {
    const { client, sockets, states, events, fetchSnapshot } = setup();
    client.start();
    sockets[0]!.onopen?.();
    sockets[0]!.onclose?.();
    expect(client.state).toBe('polling');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchSnapshot.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(events.some((e) => e.type === 'aqi' && e.aqi === 300)).toBe(true);

    await vi.advanceTimersByTimeAsync(5000); // reconnect attempt opens a second socket
    expect(sockets).toHaveLength(2);
    sockets[1]!.onopen?.();
    expect(client.state).toBe('live');
    const callsAtLive = fetchSnapshot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSnapshot.mock.calls.length).toBe(callsAtLive); // polling stopped
    expect(states).toContain('polling');
  });

  it('falls back to polling if the socket errors before it ever opens', async () => {
    const { client, sockets } = setup();
    client.start();
    sockets[0]!.onerror?.();
    expect(client.state).toBe('polling');
  });

  it('reports offline when polling also fails, and recovers', async () => {
    const fetchSnapshot = vi.fn<() => Promise<RealtimeEvent[]>>().mockRejectedValueOnce(new Error('down')).mockResolvedValue([aqi(250)]);
    const { client, sockets } = setup(fetchSnapshot);
    client.start();
    sockets[0]!.onclose?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.state).toBe('offline');
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.state).toBe('polling');
  });

  it('polls straight away when no socket URL is configured', async () => {
    const fetchSnapshot = vi.fn(async () => [aqi(200)]);
    const client = new RealtimeClient({ fetchSnapshot, pollIntervalMs: 1000 });
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.state).toBe('polling');
    expect(fetchSnapshot).toHaveBeenCalled();
    client.stop();
  });

  it('stop() closes the socket and halts polling', async () => {
    const { client, sockets, fetchSnapshot } = setup();
    client.start();
    sockets[0]!.onopen?.();
    client.stop();
    expect(sockets[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });
});
