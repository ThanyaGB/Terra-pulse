import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { PublicConfig } from '@/api/contract';
import { readJson, writeJson } from '@/routes/citizen/storage';

/** What a client may do until the server says otherwise: nothing external is on (ADR-19). */
export const SAFE_DEFAULTS: PublicConfig = {
  flags: { TELEPHONY_ENABLED: false, PUBLIC_ALERTS_ENABLED: false, ADVISORY_EXPORT_ENABLED: false, TTS_PROVIDER: 'prerecorded' },
  disclaimers: { citizen_advice: { en: 'This is environmental exposure guidance, not medical advice. If you feel unwell, speak to a doctor.' } },
};
const KEY = 'vs.publicConfig';

/** Flags and disclaimer wording from config/ via GET /config/public. The last answer is kept for offline use. */
export function usePublicConfig(): PublicConfig {
  const [cfg, setCfg] = useState<PublicConfig>(() => readJson<PublicConfig>(KEY) ?? SAFE_DEFAULTS);
  useEffect(() => {
    let cancelled = false;
    api.getPublicConfig().then((c) => { if (!cancelled) { setCfg(c); writeJson(KEY, c); } }, () => undefined);
    return () => { cancelled = true; };
  }, []);
  return cfg;
}

export function disclaimerText(cfg: PublicConfig, kind: string, lang: string): string {
  const d = cfg.disclaimers[kind] ?? SAFE_DEFAULTS.disclaimers[kind] ?? {};
  return d[lang] ?? d.en ?? '';
}
