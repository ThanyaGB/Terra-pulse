/** Exposure maths for the clean-commute planner. All functions are pure. */
export interface RouteSegment {
  minutes: number;
  aqi: number;
}

export interface RouteLike {
  id: string;
  segments: RouteSegment[];
}

export function totalMinutes(segments: RouteSegment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.minutes), 0);
}

/** Time-weighted average AQI actually breathed along the route. */
export function avgExposureAqi(segments: RouteSegment[]): number {
  const minutes = totalMinutes(segments);
  if (minutes === 0) return 0;
  const weighted = segments.reduce((sum, s) => sum + Math.max(0, s.minutes) * s.aqi, 0);
  return Math.round(weighted / minutes);
}

/** Percentage by which `alt` lowers exposure versus `baseline` (0 when it does not). */
export function exposureReductionPct(baselineAqi: number, altAqi: number): number {
  if (!(baselineAqi > 0) || altAqi >= baselineAqi) return 0;
  return Math.round(((baselineAqi - altAqi) / baselineAqi) * 100);
}

/**
 * The route to badge as "Recommended": lowest average exposure among routes that are no more than
 * `maxExtraMinutes` slower than the fastest one. Ties go to the faster route.
 */
export function pickRecommended(routes: RouteLike[], maxExtraMinutes = 10): string | null {
  if (routes.length === 0) return null;
  const scored = routes.map((r) => ({ id: r.id, minutes: totalMinutes(r.segments), exposure: avgExposureAqi(r.segments) }));
  const fastest = Math.min(...scored.map((s) => s.minutes));
  const eligible = scored.filter((s) => s.minutes - fastest <= maxExtraMinutes);
  eligible.sort((a, b) => a.exposure - b.exposure || a.minutes - b.minutes);
  return eligible[0]?.id ?? null;
}

export function formatReduction(pct: number): string {
  return pct > 0 ? `${pct}% less exposure` : 'Same exposure';
}
