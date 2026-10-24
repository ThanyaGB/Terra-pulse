/**
 * Typed HTTP client. `schema.d.ts` is generated from packages/contracts/openapi.json (`npm run gen:api`), so a path
 * that does not exist in the backend contract is a compile error here. Bodies are JSON or multipart.
 */
import type { paths } from './schema';
import { ApiError } from '../api/errors';

export type ApiPath = keyof paths & string;
export type Role = 'policy_officer' | 'fpo_coordinator' | 'farmer' | 'citizen' | 'municipal_supervisor' | 'admin';

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  trace_id?: string;
}

export interface Client {
  get<T>(path: string, role: Role, query?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, role: Role, body?: unknown | FormData): Promise<T>;
  /** GET a binary body (the signed advisory PDF) */
  download(path: string, role: Role): Promise<{ blob: Blob; filename: string | null }>;
  token(role: Role): Promise<string>;
}

export function createClient(baseUrl: string): Client {
  const base = baseUrl.replace(/\/$/, '');
  const tokens = new Map<Role, Promise<string>>();

  /** Development sign-in: the backend issues role tokens only when VAYU_ENV=dev. Production uses the real IdP. */
  function token(role: Role): Promise<string> {
    let t = tokens.get(role);
    if (!t) {
      t = fetch(`${base}/auth/dev-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
        .then(async (r) => {
          if (!r.ok) throw new ApiError('Sign-in unavailable', r.status);
          return ((await r.json()) as { access_token: string }).access_token;
        })
        .catch((e) => {
          tokens.delete(role);
          throw e instanceof ApiError ? e : new ApiError('Network unreachable', 0);
        });
      tokens.set(role, t);
    }
    return t;
  }

  async function request<T>(method: 'GET' | 'POST', path: string, role: Role, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v));
    const url = `${base}${path}${qs.size ? `?${qs}` : ''}`;
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${await token(role)}` };
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) });
    } catch {
      throw new ApiError('Network unreachable', 0);
    }
    if (res.status === 401) tokens.delete(role); // expired: next call signs in again
    if (!res.ok) {
      let p: ProblemDetails = {};
      try {
        p = (await res.json()) as ProblemDetails;
      } catch {
        /* non-JSON error */
      }
      throw new ApiError(p.detail || p.title || `Request failed (${res.status})`, res.status);
    }
    return (await res.json()) as T;
  }

  return {
    get: (path, role, query) => request('GET', path, role, undefined, query),
    post: (path, role, body) => request('POST', path, role, body),
    async download(path, role) {
      let res: Response;
      try {
        res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${await token(role)}` } });
      } catch {
        throw new ApiError('Network unreachable', 0);
      }
      if (!res.ok) {
        let detail = '';
        try { detail = ((await res.json()) as ProblemDetails).detail ?? ''; } catch { /* not JSON */ }
        throw new ApiError(detail || `Request failed (${res.status})`, res.status);
      }
      return { blob: await res.blob(), filename: /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? null };
    },
    token,
  };
}
