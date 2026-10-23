/**
 * AQI categories. Boundaries follow the CPCB National AQI up to 400, then split the
 * 401-500 band at 450 so "Severe+" matches the GRAP Stage-IV trigger used by CAQM.
 *
 * Every band carries three colours:
 *  - bg / fg : a filled badge, chosen so fg-on-bg is >= 4.5:1 (checked in tests)
 *  - text    : the band colour as *text on white*, also >= 4.5:1
 */
export type AqiBandId = 'good' | 'satisfactory' | 'moderate' | 'poor' | 'very-poor' | 'severe' | 'severe-plus';

export interface AqiBand {
  id: AqiBandId;
  label: string;
  /** inclusive lower bound of the (rounded) AQI */
  min: number;
  /** inclusive upper bound; Infinity for the open-ended top band */
  max: number;
  bg: string;
  fg: string;
  text: string;
}

export const AQI_BANDS: readonly AqiBand[] = [
  { id: 'good', label: 'Good', min: 0, max: 50, bg: '#10B981', fg: '#04281B', text: '#0B7A53' },
  { id: 'satisfactory', label: 'Satisfactory', min: 51, max: 100, bg: '#9CD84E', fg: '#0B1D33', text: '#3F7D20' },
  { id: 'moderate', label: 'Moderate', min: 101, max: 200, bg: '#F4C430', fg: '#0B1D33', text: '#7A5A00' },
  { id: 'poor', label: 'Poor', min: 201, max: 300, bg: '#FF8A3D', fg: '#2A1300', text: '#B45309' },
  { id: 'very-poor', label: 'Very Poor', min: 301, max: 400, bg: '#C62828', fg: '#FFFFFF', text: '#B91C1C' },
  { id: 'severe', label: 'Severe', min: 401, max: 450, bg: '#7F1D1D', fg: '#FFFFFF', text: '#7F1D1D' },
  { id: 'severe-plus', label: 'Severe+', min: 451, max: Number.POSITIVE_INFINITY, bg: '#3B0A45', fg: '#FFFFFF', text: '#3B0A45' },
];

export const AQI_SCALE_MAX = 500;

export function getAqiBand(aqi: number | null | undefined): AqiBand {
  if (aqi == null || !Number.isFinite(aqi)) return AQI_BANDS[0]!;
  const v = Math.round(aqi);
  return AQI_BANDS.find((b) => v <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1]!;
}

/** "362", "500+" for anything beyond the scale, "—" when there is no reading. */
export function formatAqi(aqi: number | null | undefined): string {
  if (aqi == null || !Number.isFinite(aqi)) return '—';
  const v = Math.max(0, Math.round(aqi));
  return v > AQI_SCALE_MAX ? `${AQI_SCALE_MAX}+` : String(v);
}

/** "214 µg/m³" - one decimal only when the reading is below 10 (where it matters). */
export function formatPm25(pm: number | null | undefined): string {
  if (pm == null || !Number.isFinite(pm)) return '—';
  const v = Math.max(0, pm);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} µg/m³`;
}

/** Screen-reader friendly: "AQI 362, Very Poor". */
export function describeAqi(aqi: number | null | undefined): string {
  if (aqi == null || !Number.isFinite(aqi)) return 'AQI unavailable';
  return `AQI ${formatAqi(aqi)}, ${getAqiBand(aqi).label}`;
}

/** 0..1 position on the 0-500 gauge. */
export function aqiGaugeFraction(aqi: number | null | undefined): number {
  if (aqi == null || !Number.isFinite(aqi)) return 0;
  return Math.min(1, Math.max(0, aqi / AQI_SCALE_MAX));
}

/**
 * CPCB PM2.5 sub-index: converts a 24 h PM2.5 concentration (µg/m³) to the AQI scale by linear
 * interpolation inside each breakpoint band. Above 380 µg/m³ the index is capped at 500+.
 */
const PM25_BREAKPOINTS: readonly [number, number, number, number][] = [
  // [pmLow, pmHigh, aqiLow, aqiHigh]
  [0, 30, 0, 50],
  [30, 60, 50, 100],
  [60, 90, 100, 200],
  [90, 120, 200, 300],
  [120, 250, 300, 400],
  [250, 380, 400, 500],
];

export function pm25ToAqi(pm: number | null | undefined): number {
  if (pm == null || !Number.isFinite(pm) || pm <= 0) return 0;
  for (const [pl, ph, al, ah] of PM25_BREAKPOINTS) {
    if (pm <= ph) return Math.round(al + ((pm - pl) / (ph - pl)) * (ah - al));
  }
  // beyond the table: keep climbing slowly so Severe+ is distinguishable from a flat 500
  return Math.round(500 + (pm - 380) * 0.5);
}
