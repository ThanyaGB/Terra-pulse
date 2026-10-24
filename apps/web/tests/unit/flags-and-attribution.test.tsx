import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@/api/contract';
import { I18nProvider } from '@/i18n';

const state = vi.hoisted(() => ({ cfg: null as null | PublicConfig, fail: false }));
vi.mock('@/api/client', () => ({
  api: {
    getPublicConfig: () => (state.fail ? Promise.reject(new Error('offline')) : Promise.resolve(state.cfg)),
    getBiomass: () => Promise.resolve({}),
  },
}));

import { SAFE_DEFAULTS, disclaimerText } from '@/api/usePublicConfig';
import { ATTRIBUTION } from '@/design-system/DataAttribution';
import { Disclaimer } from '@/routes/citizen/Disclaimer';
import { PushAlerts } from '@/routes/citizen/PushAlerts';
import { canExport } from '@/routes/policy/DirectiveBar';

const cfg = (over: Partial<PublicConfig['flags']> = {}): PublicConfig => ({
  flags: { ...SAFE_DEFAULTS.flags, ...over },
  disclaimers: { citizen_advice: { en: 'Config wording EN', hi: 'Config wording HI' } },
});
const wrap = (ui: React.ReactElement, lang: 'en' | 'hi' = 'en') => render(<I18nProvider initial={lang}>{ui}</I18nProvider>);

beforeEach(() => { localStorage.clear(); state.fail = false; state.cfg = cfg(); });

describe('feature flags in the apps', () => {
  it('safe defaults switch every external feature off', () => {
    expect(SAFE_DEFAULTS.flags).toMatchObject({ TELEPHONY_ENABLED: false, WHATSAPP_ENABLED: false, PUBLIC_ALERTS_ENABLED: false, ADVISORY_EXPORT_ENABLED: false });
  });

  it('push alerts are hidden while PUBLIC_ALERTS_ENABLED is off, and shown when it is on', async () => {
    state.cfg = cfg({ PUBLIC_ALERTS_ENABLED: false });
    const off = wrap(<PushAlerts />);
    await new Promise((r) => setTimeout(r, 30));
    expect(off.container.querySelector('[data-testid="push-alerts"]')).toBeNull();
    off.unmount();
    state.cfg = cfg({ PUBLIC_ALERTS_ENABLED: true });
    wrap(<PushAlerts />);
    await waitFor(() => expect(screen.getByTestId('push-alerts')).toBeInTheDocument());
  });

  it('push alerts stay hidden if the config cannot be fetched', async () => {
    state.fail = true;
    const r = wrap(<PushAlerts />);
    await new Promise((res) => setTimeout(res, 30));
    expect(r.container.querySelector('[data-testid="push-alerts"]')).toBeNull();
  });

  it('export is possible only for an approved directive and only while the export switch is on', () => {
    expect(canExport({ status: 'pending_approval' }, true)).toBe(false);
    expect(canExport({ status: 'approved' }, false)).toBe(false);
    expect(canExport({ status: 'approved' }, true)).toBe(true);
  });
});

describe('disclaimer from config (ADR-18)', () => {
  it('renders the wording the server sends, in the chosen language', async () => {
    state.cfg = cfg();
    wrap(<Disclaimer />, 'hi');
    await waitFor(() => expect(screen.getByTestId('disclaimer')).toHaveTextContent('Config wording HI'));
  });
  it('falls back to English, then to the bundled text when offline', async () => {
    expect(disclaimerText(cfg(), 'citizen_advice', 'pa')).toBe('Config wording EN');
    state.fail = true;
    wrap(<Disclaimer />);
    await waitFor(() => expect(screen.getByTestId('disclaimer')).toHaveTextContent('not medical advice'));
  });
});

describe('attribution footer (ADR-20)', () => {
  it('uses exactly the attribution text of the data_source registry', () => {
    const doc = readFileSync(resolve(__dirname, '../../../../docs/data-licences.md'), 'utf8');
    for (const [id, text] of Object.entries(ATTRIBUTION)) expect(doc, `${id}: ${text}`).toContain(text);
  });
});
