import { describeAqi, formatAqi, getAqiBand } from '@/lib/aqi';

export function AqiBadge({ aqi, size = 'md', showLabel = true }: { aqi: number | null | undefined; size?: 'sm' | 'md' | 'lg'; showLabel?: boolean }) {
  const band = getAqiBand(aqi);
  const pad = size === 'lg' ? 'px-4 py-2 text-lg' : size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span role="img" aria-label={describeAqi(aqi)} className={`inline-flex items-center gap-2 rounded-full font-bold ${pad}`} style={{ background: band.bg, color: band.fg }}>
      <span className="mono">{formatAqi(aqi)}</span>
      {showLabel && <span className="font-semibold">{band.label}</span>}
    </span>
  );
}
