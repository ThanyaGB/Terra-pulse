// k6: 1,000 REST requests per minute against the read endpoints; p95 must stay under 300 ms (T6.3).
//   BASE=http://localhost:8010 k6 run tests/load/rest.js
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:8010';

export const options = {
  scenarios: {
    rest: { executor: 'constant-arrival-rate', rate: 1000, timeUnit: '1m', duration: '3m', preAllocatedVUs: 20, maxVUs: 60 },
  },
  thresholds: { http_req_duration: ['p(95)<300'], http_req_failed: ['rate<0.01'] },
};

export function setup() {
  const roles = ['citizen', 'policy_officer', 'fpo_coordinator'];
  const tokens = {};
  for (const role of roles) {
    const r = http.post(`${BASE}/v1/auth/dev-token`, JSON.stringify({ role }), { headers: { 'Content-Type': 'application/json' } });
    tokens[role] = r.json('access_token');
  }
  return tokens;
}

const reads = [
  ['citizen', '/v1/aqi/community/anand-vihar'],
  ['citizen', '/v1/health/advice?profile=asthma&community_id=anand-vihar'],
  ['citizen', '/v1/routes/clean?from=ito&to=anand-vihar'],
  ['policy_officer', '/v1/attribution/summary?region=delhi_ncr'],
  ['policy_officer', '/v1/plume/projection'],
  ['policy_officer', '/v1/pipeline/health'],
  ['fpo_coordinator', '/v1/risk/parcels?limit=50'],
  ['fpo_coordinator', '/v1/machinery/status'],
];

export default function (tokens) {
  const [role, path] = reads[Math.floor(Math.random() * reads.length)];
  const res = http.get(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tokens[role]}` } });
  check(res, { 'status 200': (r) => r.status === 200 });
}
