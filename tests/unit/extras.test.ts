import { beforeEach, describe, expect, it } from 'vitest';
import { betterWindow, forecast24 } from '@/lib/forecast';
import { clearOrders, getOrders, isGrapActive, recordOrder } from '@/lib/orders';
import { BASE_FILM_PX, BURN_FROM, BURN_TO, FILM_PX, slowBurn } from '@/features/home/film/pacing';
import { STAGES, STAGE_P, clamp01, dayAt, phaseOf } from '@/features/home/film/scene';

describe('forecast', () => {
  it('matches the live reading at the current time', () => {
    const pts = forecast24(300, 10 * 60);
    expect(pts).toHaveLength(25);
    expect(pts[10].aqi).toBe(300);
  });
  it('puts the cleanest window around early afternoon', () => {
    const w = betterWindow(forecast24(320, 9 * 60));
    expect(w.startMin).toBeGreaterThanOrEqual(11 * 60);
    expect(w.endMin).toBeLessThanOrEqual(16 * 60);
    expect(w.endMin - w.startMin).toBe(120);
  });
});

describe('shared orders state', () => {
  beforeEach(() => { localStorage.clear(); });
  it('logs orders newest first and flags GRAP only for grap_ii', () => {
    recordOrder({ id: 'D-1', type: 'fog_cannons', issuedAt: '2026-10-23T10:00:00Z' } as never, 'Fog cannons');
    expect(isGrapActive()).toBe(false);
    recordOrder({ id: 'D-2', type: 'grap_ii', issuedAt: '2026-10-23T11:00:00Z' } as never, 'GRAP-II');
    expect(isGrapActive()).toBe(true);
    expect(getOrders().map((o) => o.id)).toEqual(['D-2', 'D-1']);
    clearOrders();
    expect(getOrders()).toEqual([]);
    expect(isGrapActive()).toBe(false);
  });
});

describe('landing film maths', () => {
  it('clamps and maps scroll progress to crop days monotonically', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(dayAt(0)).toBe(0);
    expect(dayAt(1)).toBe(113);
    let prev = -1;
    for (let p = 0; p <= 1; p += 0.01) { const d = dayAt(p); expect(d).toBeGreaterThanOrEqual(prev); prev = d; }
  });
  it('has one scroll anchor per stage, in order', () => {
    expect(STAGE_P).toHaveLength(STAGES.length);
    expect([...STAGE_P].sort((a, b) => a - b)).toEqual(STAGE_P);
  });
  it('names the burning and smoke phases late in the film', () => {
    expect(phaseOf(112, 0.7)[1]).toBe('Burning');
    expect(phaseOf(113, 0.9)[1]).toBe('Smoke drift');
  });
});

describe('film pacing: the burning stretch gets the extra scroll', () => {
  const stage = 900, span = FILM_PX - stage, base = BASE_FILM_PX - stage;
  const at = (px: number) => slowBurn(px / span, span, base);
  it('keeps every stage before the fire at the old speed', () => {
    expect(at(base * 0.3)).toBeCloseTo(0.3, 5);
    expect(at(base * 0.6)).toBeCloseTo(0.6, 5);
  });
  it('spends all the extra pixels on the burning stretch, then ends at 1', () => {
    const burnStartPx = base * BURN_FROM;
    const burnPx = (BURN_TO - BURN_FROM) * base + (FILM_PX - BASE_FILM_PX);
    expect(at(burnStartPx + burnPx)).toBeCloseTo(BURN_TO, 5);
    expect(at(span)).toBe(1);
  });
});
