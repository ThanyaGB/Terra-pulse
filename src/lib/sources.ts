import type { SourceId } from '@/api/contract';

/** Colours differ in lightness as well as hue so the four sources stay distinguishable without colour vision. */
export const SOURCE_META: Record<SourceId, { label: string; short: string; color: string }> = {
  straw_plume: { label: 'Cross-regional straw plume', short: 'Straw plume', color: '#E8710A' },
  vehicle: { label: 'Vehicle exhaust', short: 'Vehicles', color: '#1F6FBF' },
  dust: { label: 'Road & construction dust', short: 'Dust', color: '#A8885C' },
  industrial_waste: { label: 'Industrial / waste burning', short: 'Industry & waste', color: '#6D3FC9' },
};

export const SOURCE_ORDER: SourceId[] = ['straw_plume', 'vehicle', 'dust', 'industrial_waste'];

/** Look up a share by source, 0 when absent. */
export function shareOf(shares: { source: SourceId; pct: number }[], id: SourceId): number {
  return shares.find((s) => s.source === id)?.pct ?? 0;
}
