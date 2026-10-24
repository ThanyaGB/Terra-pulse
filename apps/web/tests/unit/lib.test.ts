import { describe, expect, it } from 'vitest';
import { maskPhone } from '@/lib/phone';
import { RISK_TIERS, filterFarmers, riskTier, sortFarmers } from '@/lib/risk';
import { arrivalState, frontFraction, pm25At, type StreetImpact } from '@/lib/plume';
import { latencyStatus, stationsStatus, worstStatus } from '@/lib/health';
import { formatInr, mmss, timeAgo } from '@/lib/format';
import { alertTiming, hhmm, humanDuration } from '@/routes/citizen/time';
import { buildAdvice, periodFor } from '@/mocks/advice';
import { detectLang, translate } from '@/i18n';

describe('maskPhone', () => {
  it('keeps the first five digits: 98721-XXXXX', () => expect(maskPhone('9872112345')).toBe('98721-XXXXX'));
  it('copes with country codes and punctuation', () => {
    expect(maskPhone('+91 98721 12345')).toBe('98721-XXXXX');
    expect(maskPhone('098721-12345')).toBe('98721-XXXXX');
  });
  it('never leaks a short or missing number', () => {
    expect(maskPhone('12345')).toBe('XXXXX-XXXXX');
    expect(maskPhone(null)).toBe('XXXXX-XXXXX');
  });
});

describe('riskTier', () => {
  it.each([[0, 'low'], [34, 'low'], [35, 'medium'], [59, 'medium'], [60, 'high'], [79, 'high'], [80, 'critical'], [100, 'critical']])('score %i is %s (spec 6.1: 35, 60, 80, mirrored from config/risk_weights.yaml)', (s, id) => {
    expect(riskTier(s).id).toBe(id);
  });
  it('has all four tiers in ascending order', () => expect(RISK_TIERS.map((t) => t.id)).toEqual(['low', 'medium', 'high', 'critical']));
});

describe('filter and sort farmers', () => {
  const rows = [
    { name: 'B', village: 'Sunam', acres: 5, harvestDate: '2026-11-02', riskScore: 90, lastContactAt: null },
    { name: 'A', village: 'Dhuri', acres: 12, harvestDate: '2026-11-05', riskScore: 72, lastContactAt: '2026-10-22T08:00:00Z' },
    { name: 'C', village: 'Sunam', acres: 8, harvestDate: '2026-11-01', riskScore: 45, lastContactAt: '2026-10-21T08:00:00Z' },
  ];
  it('filters by village and tier together', () => {
    expect(filterFarmers(rows, { village: 'Sunam', tier: 'all' }).map((r) => r.name)).toEqual(['B', 'C']);
    expect(filterFarmers(rows, { village: 'Sunam', tier: 'critical' }).map((r) => r.name)).toEqual(['B']);
    expect(filterFarmers(rows, { village: 'all', tier: 'all' })).toHaveLength(3);
  });
  it('sorts numbers numerically, strings alphabetically, both directions', () => {
    expect(sortFarmers(rows, 'riskScore', 'desc').map((r) => r.name)).toEqual(['B', 'A', 'C']);
    expect(sortFarmers(rows, 'acres', 'asc').map((r) => r.name)).toEqual(['B', 'C', 'A']);
    expect(sortFarmers(rows, 'name', 'asc').map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
  it('always puts never-contacted farmers last', () => {
    expect(sortFarmers(rows, 'lastContactAt', 'asc').at(-1)!.name).toBe('B');
    expect(sortFarmers(rows, 'lastContactAt', 'desc').at(-1)!.name).toBe('B');
  });
  it('does not mutate its input', () => {
    const copy = [...rows];
    sortFarmers(rows, 'name', 'desc');
    expect(rows).toEqual(copy);
  });
});

describe('plume timeline', () => {
  const s: StreetImpact = { id: 'x', name: 'X', lat: 0, lng: 0, etaHours: 12, peakPm25: 460, hoursToPeak: 8, baselinePm25: 120 };
  it('stays at baseline until the plume arrives', () => expect(pm25At(s, 11)).toBe(120));
  it('peaks hoursToPeak after arrival', () => expect(pm25At(s, 20)).toBe(460));
  it('rises monotonically between arrival and peak', () => {
    let prev = 0;
    for (let t = 12; t <= 20; t++) { const v = pm25At(s, t); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });
  it('decays after the peak, never below baseline', () => {
    expect(pm25At(s, 44)).toBeLessThan(460);
    expect(pm25At(s, 72)).toBeGreaterThanOrEqual(120);
  });
  it('reports arrival state and hours', () => {
    expect(arrivalState(s, 4)).toEqual({ state: 'incoming', hours: 8 });
    expect(arrivalState(s, 15)).toEqual({ state: 'arrived', hours: 3 });
  });
  it('front fraction is clamped', () => {
    expect(frontFraction(-3, 12)).toBe(0);
    expect(frontFraction(6, 12)).toBe(0.5);
    expect(frontFraction(40, 12)).toBe(1);
  });
});

describe('pipeline health thresholds', () => {
  it('39 of 40 stations is amber, all online is green, half is red', () => {
    expect(stationsStatus(39, 40)).toBe('degraded');
    expect(stationsStatus(40, 40)).toBe('ok');
    expect(stationsStatus(20, 40)).toBe('down');
  });
  it('latency bands', () => {
    expect(latencyStatus(320)).toBe('ok');
    expect(latencyStatus(880)).toBe('degraded');
    expect(latencyStatus(2200)).toBe('down');
  });
  it('worst status wins', () => expect(worstStatus(['ok', 'degraded', 'ok'])).toBe('degraded'));
});

describe('format helpers', () => {
  it('formats rupees with Indian grouping', () => {
    expect(formatInr(1650)).toBe('₹1,650');
    expect(formatInr(750)).toBe('₹750');
    expect(formatInr(1234567)).toBe('₹12,34,567');
  });
  it('mm:ss', () => { expect(mmss(0)).toBe('00:00'); expect(mmss(75)).toBe('01:15'); });
  it('timeAgo', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('2026-10-23T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-23T09:00:00Z', now)).toBe('3 h ago');
  });
});

describe('time-windowed alerts', () => {
  const inversion = { startMin: 360, endMin: 630 }; // 06:00-10:30
  it('is upcoming before, active during, passed after the window', () => {
    expect(alertTiming(inversion, 300)).toEqual({ state: 'upcoming', startsInMin: 60 });
    expect(alertTiming(inversion, 360)).toEqual({ state: 'active', endsInMin: 270 });
    expect(alertTiming(inversion, 629).state).toBe('active');
    expect(alertTiming(inversion, 630).state).toBe('passed');
  });
  it('formats clock and durations', () => {
    expect(hhmm(630)).toBe('10:30');
    expect(humanDuration(45)).toBe('45 min');
    expect(humanDuration(135)).toBe('2 h 15 min');
  });
});

describe('health advice depends on profile and time of day', () => {
  it('maps hours to periods', () => {
    expect(periodFor(7)).toBe('early_morning');
    expect(periodFor(10.5)).toBe('midday');
    expect(periodFor(14)).toBe('afternoon');
    expect(periodFor(19)).toBe('evening');
    expect(periodFor(23)).toBe('night');
    expect(periodFor(2)).toBe('night');
  });
  it('warns against exercise during the morning inversion', () => {
    const a = buildAdvice('asthma', 7);
    expect(a.items[0]!.level).toBe('avoid');
    expect(a.items[0]!.title).toMatch(/10:30/);
  });
  it('points to the ventilation window in the afternoon', () => {
    expect(buildAdvice('general', 14).items[0]!.title).toMatch(/13:30/);
  });
  it('differs by profile for the same hour', () => {
    expect(buildAdvice('child', 14).items.map((i) => i.id)).not.toEqual(buildAdvice('outdoor', 14).items.map((i) => i.id));
  });
});

describe('i18n', () => {
  it('detects Punjabi for Punjab locales, Hindi for Hindi, else English', () => {
    expect(detectLang(['pa-IN', 'en-US'])).toBe('pa');
    expect(detectLang(['pa'])).toBe('pa');
    expect(detectLang(['hi-IN'])).toBe('hi');
    expect(detectLang(['en-GB'])).toBe('en');
    expect(detectLang(['fr-FR'])).toBe('en');
    expect(detectLang([])).toBe('en');
  });
  it('interpolates variables and falls back to English for untranslated keys', () => {
    expect(translate('en', 'farmer.key1.sub', { price: 750 })).toBe('₹750 per acre');
    expect(translate('pa', 'farmer.key1.sub', { price: 750 })).toBe('₹750 ਪ੍ਰਤੀ ਏਕੜ');
    expect(translate('pa', 'cz.install.title')).toBe(translate('en', 'cz.install.title'));
  });
  it('the farmer interface is fully translated into Punjabi and Hindi', async () => {
    const { en } = await import('@/i18n/en');
    const { pa } = await import('@/i18n/pa');
    const { hi } = await import('@/i18n/hi');
    const farmerKeys = Object.keys(en).filter((k) => k.startsWith('farmer.') || k.startsWith('common.') || k.startsWith('nav.'));
    for (const k of farmerKeys) {
      expect(pa, `pa missing ${k}`).toHaveProperty(k);
      expect(hi, `hi missing ${k}`).toHaveProperty(k);
    }
  });
});
