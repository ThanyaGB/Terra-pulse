/** Plume timeline helpers shared by the map table and the particle layer. */
export interface StreetImpact {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** hours after t0 before the plume front reaches the street */
  etaHours: number;
  /** peak PM2.5 in µg/m³ */
  peakPm25: number;
  /** hours after arrival until the peak */
  hoursToPeak: number;
  /** PM2.5 before the plume arrives */
  baselinePm25: number;
}

export const HORIZON_HOURS = 72;

/** PM2.5 at the street at timeline hour `t`: baseline -> ramp to peak -> exponential decay (24 h half-life). */
export function pm25At(street: StreetImpact, t: number): number {
  if (t < street.etaHours) return street.baselinePm25;
  const since = t - street.etaHours;
  if (since <= street.hoursToPeak) {
    const k = street.hoursToPeak === 0 ? 1 : since / street.hoursToPeak;
    return Math.round(street.baselinePm25 + (street.peakPm25 - street.baselinePm25) * smooth(k));
  }
  const decay = 0.5 ** ((since - street.hoursToPeak) / 24);
  return Math.round(street.baselinePm25 + (street.peakPm25 - street.baselinePm25) * decay);
}

function smooth(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}

export type ArrivalState = 'arrived' | 'incoming';

export function arrivalState(street: StreetImpact, t: number): { state: ArrivalState; hours: number } {
  return t >= street.etaHours ? { state: 'arrived', hours: t - street.etaHours } : { state: 'incoming', hours: street.etaHours - t };
}

/** Wall-clock label for an offset from `start`, e.g. "Sat 24 Oct, 18:00". */
export function clockAt(start: Date, hours: number): string {
  const d = new Date(start.getTime() + hours * 3600_000);
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time}`;
}

/** Fraction (0..1) of the corridor the plume front has covered at hour t. */
export function frontFraction(t: number, hoursToReachNcr: number): number {
  if (hoursToReachNcr <= 0) return 1;
  return Math.min(1, Math.max(0, t / hoursToReachNcr));
}
