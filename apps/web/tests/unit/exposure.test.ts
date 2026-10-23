import { describe, expect, it } from 'vitest';
import { avgExposureAqi, exposureReductionPct, formatReduction, pickRecommended, totalMinutes } from '@/lib/exposure';
import { buildRouteViews } from '@/routes/citizen/CommutePlanner';
import type { RouteOption } from '@/api/contract';

const A = [{ minutes: 5, aqi: 410 }, { minutes: 7, aqi: 375 }];
const B = [{ minutes: 4, aqi: 300 }, { minutes: 7, aqi: 250 }, { minutes: 4, aqi: 260 }];

describe('avgExposureAqi', () => {
  it('weights each segment by the time spent in it', () => {
    expect(totalMinutes(A)).toBe(12);
    expect(avgExposureAqi(A)).toBe(390); // (5*410 + 7*375) / 12 = 389.6
    expect(avgExposureAqi(B)).toBe(266); // (1200 + 1750 + 1040) / 15
  });
  it('is not just the plain mean of the segments', () => {
    expect(avgExposureAqi([{ minutes: 1, aqi: 100 }, { minutes: 9, aqi: 300 }])).toBe(280);
  });
  it('is 0 for an empty route', () => expect(avgExposureAqi([])).toBe(0));
  it('ignores negative minutes', () => expect(avgExposureAqi([{ minutes: -5, aqi: 999 }, { minutes: 10, aqi: 200 }])).toBe(200));
});

describe('exposureReductionPct', () => {
  it('is the percentage drop versus the baseline', () => expect(exposureReductionPct(390, 266)).toBe(32));
  it('is 0 when the alternative is no better', () => {
    expect(exposureReductionPct(200, 200)).toBe(0);
    expect(exposureReductionPct(200, 260)).toBe(0);
  });
  it('is 0 for a nonsense baseline', () => {
    expect(exposureReductionPct(0, 0)).toBe(0);
    expect(exposureReductionPct(-5, 3)).toBe(0);
  });
  it('formats for display', () => {
    expect(formatReduction(32)).toBe('32% less exposure');
    expect(formatReduction(0)).toBe('Same exposure');
  });
});

describe('pickRecommended', () => {
  it('prefers the cleaner route when it is only a little slower', () => {
    expect(pickRecommended([{ id: 'A', segments: A }, { id: 'B', segments: B }])).toBe('B');
  });
  it('ignores a cleaner route that is far too slow', () => {
    const slow = [{ minutes: 40, aqi: 90 }];
    expect(pickRecommended([{ id: 'A', segments: A }, { id: 'S', segments: slow }])).toBe('A');
  });
  it('breaks ties toward the faster route', () => {
    expect(pickRecommended([{ id: 'x', segments: [{ minutes: 20, aqi: 200 }] }, { id: 'y', segments: [{ minutes: 15, aqi: 200 }] }])).toBe('y');
  });
  it('returns null when there are no routes', () => expect(pickRecommended([])).toBeNull());
});

describe('buildRouteViews (what the cards display)', () => {
  const options: RouteOption[] = [
    { id: 'A', name: 'Route A', via: 'Main road', segments: A.map((s) => ({ ...s, label: 'a' })) },
    { id: 'B', name: 'Route B', via: 'Greenway', segments: B.map((s) => ({ ...s, label: 'b' })) },
  ];
  const [a, b] = buildRouteViews(options);
  it('flags the fastest and the recommended route', () => {
    expect(a!.fastest).toBe(true);
    expect(a!.recommended).toBe(false);
    expect(b!.recommended).toBe(true);
  });
  it('shows time, exposure and the 32% reduction for the cleaner route', () => {
    expect(b!.minutes).toBe(15);
    expect(b!.extraMinutes).toBe(3);
    expect(b!.exposure).toBe(266);
    expect(b!.reductionPct).toBe(32);
    expect(a!.reductionPct).toBe(0);
  });
  it('handles no options', () => expect(buildRouteViews([])).toEqual([]));
});
