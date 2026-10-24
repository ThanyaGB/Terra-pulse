/**
 * Attribution footer (ADR-20): every screen that shows derived data names its sources. The text mirrors the `data_source`
 * registry (docs/data-licences.md); tests/unit/attribution.test.ts fails if the two drift apart.
 */
export const ATTRIBUTION = {
  firms: 'NASA FIRMS',
  sentinel2: 'Contains modified Copernicus Sentinel data',
  cpcb: 'Source: CPCB via data.gov.in',
  cams: 'Copernicus Atmosphere Monitoring Service',
  era5: 'Copernicus Climate Change Service',
  nwp: 'Weather data by Open-Meteo.com',
  osm: '© OpenStreetMap contributors',
} as const;
export type AttributionSource = keyof typeof ATTRIBUTION;

export function DataAttribution({ sources, className = '' }: { sources: AttributionSource[]; className?: string }) {
  return (
    <footer className={`px-4 pb-6 pt-2 text-center text-xs text-ink-soft ${className}`} data-testid="data-attribution" aria-label="Data sources">
      {sources.map((s) => ATTRIBUTION[s]).join(' · ')}
    </footer>
  );
}
