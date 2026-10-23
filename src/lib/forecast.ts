/** Illustrative 24 h AQI curve for the citizen app: the live reading scaled by a typical Delhi daily cycle
 *  (morning rush, afternoon mixing-height dip, evening inversion). It is an estimate, not model output. */
const g = (h: number, mu: number, sd: number) => Math.exp(-((h - mu) ** 2) / (2 * sd * sd));
const shape = (h: number) => 1 + 0.18 * g(h, 8, 2.5) + 0.3 * g(h, 20.5, 3) - 0.24 * g(h, 13.5, 3);

export interface ForecastPoint { hour: number; aqi: number }

export function forecast24(aqiNow: number, nowMin: number): ForecastPoint[] {
  const k = aqiNow / shape(nowMin / 60);
  return Array.from({ length: 25 }, (_, i) => ({ hour: i, aqi: Math.round(k * shape(i)) }));
}

/** Cleanest 2-hour stretch of the day, as start/end minutes. */
export function betterWindow(points: ForecastPoint[]): { startMin: number; endMin: number; aqi: number } {
  let best = 0;
  for (let i = 1; i < points.length - 1; i++) if (points[i].aqi < points[best].aqi) best = i;
  const mid = points[best].hour * 60;
  // centre of the minimum is ~13:30, not on the hour: refine with the shape function
  let bestMin = mid;
  let bestVal = Infinity;
  for (let m = Math.max(0, mid - 60); m <= Math.min(24 * 60, mid + 60); m += 15) { const v = shape(m / 60); if (v < bestVal) { bestVal = v; bestMin = m; } }
  return { startMin: Math.max(0, bestMin - 60), endMin: Math.min(24 * 60, bestMin + 60), aqi: points[best].aqi };
}
