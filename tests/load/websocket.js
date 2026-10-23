// k6: 200 concurrent /ws/live clients; message delivery p95 under 1 s (T6.3).
// The server stamps each frame's `ts`; latency is now - ts, so run k6 on a host with a synced clock.
//   BASE_WS=ws://localhost:8010 BASE=http://localhost:8010 k6 run tests/load/websocket.js
import http from 'k6/http';
import ws from 'k6/ws';
import { Trend } from 'k6/metrics';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:8010';
const BASE_WS = __ENV.BASE_WS || 'ws://localhost:8010';
const delivery = new Trend('ws_delivery_ms', true);

export const options = {
  scenarios: { sockets: { executor: 'constant-vus', vus: 200, duration: '2m' } },
  thresholds: { ws_delivery_ms: ['p(95)<1000'], checks: ['rate>0.99'] },
};

export function setup() {
  const r = http.post(`${BASE}/v1/auth/dev-token`, JSON.stringify({ role: 'policy_officer' }), { headers: { 'Content-Type': 'application/json' } });
  return { token: r.json('access_token') };
}

export default function ({ token }) {
  const res = ws.connect(`${BASE_WS}/ws/live?token=${token}`, {}, (socket) => {
    socket.on('open', () => socket.send(JSON.stringify({ action: 'subscribe', channels: ['aqi.update', 'alert.fired', 'agent.status'] })));
    socket.on('message', (data) => {
      const m = JSON.parse(data);
      if (m.channel !== 'system' && m.ts) delivery.add(Date.now() - Date.parse(m.ts));
    });
    socket.setTimeout(() => socket.close(), 60000);
  });
  check(res, { 'upgraded to websocket': (r) => r && r.status === 101 });
}
