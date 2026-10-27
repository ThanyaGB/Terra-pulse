import { ApiError } from './errors';

/** The backend issues one JWT per role; each endpoint only accepts its own roles. */
export type Role = 'policy_officer' | 'fpo_coordinator' | 'farmer' | 'citizen' | 'municipal_supervisor' | 'admin';

interface Cached {
  token: string;
  /** epoch ms after which the token is refreshed */
  refreshAt: number;
}

/** JWT `exp` (seconds) → ms, or null if the token cannot be decoded. */
function expiryMs(jwt: string): number | null {
  try {
    const part = jwt.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Development sign-in (`POST /v1/auth/dev-token`, only when the backend runs with VAYU_ENV=dev). Tokens are fetched lazily
 * per role, cached, and refreshed a minute before they expire. Production swaps this for the real identity provider.
 */
export function createTokenProvider(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '');
  const cache = new Map<Role, Cached>();
  const inflight = new Map<Role, Promise<string>>();

  async function fetchToken(role: Role): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${base}/auth/dev-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    } catch {
      throw new ApiError('Network unreachable', 0);
    }
    if (!res.ok) throw new ApiError('Sign-in unavailable', res.status);
    const token = ((await res.json()) as { access_token: string }).access_token;
    const exp = expiryMs(token);
    cache.set(role, { token, refreshAt: (exp ?? Date.now() + 15 * 60_000) - 60_000 });
    return token;
  }

  return {
    token(role: Role): Promise<string> {
      const hit = cache.get(role);
      if (hit && Date.now() < hit.refreshAt) return Promise.resolve(hit.token);
      let p = inflight.get(role);
      if (!p) {
        p = fetchToken(role).finally(() => inflight.delete(role));
        inflight.set(role, p);
      }
      return p;
    },
    /** Drop a rejected token so the next call signs in again. */
    invalidate(role: Role): void {
      cache.delete(role);
    },
  };
}

export type TokenProvider = ReturnType<typeof createTokenProvider>;
