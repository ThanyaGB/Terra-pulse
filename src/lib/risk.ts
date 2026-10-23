export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface RiskTierStyle {
  id: RiskTier;
  label: string;
  min: number;
  /** badge colours, fg-on-bg >= 4.5:1 */
  bg: string;
  fg: string;
}

export const RISK_TIERS: readonly RiskTierStyle[] = [
  { id: 'low', label: 'Low', min: 0, bg: '#E3F8EE', fg: '#0B5C3E' },
  { id: 'medium', label: 'Medium', min: 40, bg: '#FFF3C4', fg: '#6B4E00' },
  { id: 'high', label: 'High', min: 70, bg: '#FFD9B8', fg: '#8A3A00' },
  { id: 'critical', label: 'Critical', min: 85, bg: '#C62828', fg: '#FFFFFF' },
];

export function riskTier(score: number): RiskTierStyle {
  const s = Number.isFinite(score) ? score : 0;
  let tier = RISK_TIERS[0]!;
  for (const t of RISK_TIERS) if (s >= t.min) tier = t;
  return tier;
}

export interface FarmerRowLike {
  name: string;
  village: string;
  acres: number;
  harvestDate: string;
  riskScore: number;
  lastContactAt: string | null;
}

export type SortKey = 'name' | 'village' | 'acres' | 'harvestDate' | 'riskScore' | 'lastContactAt';
export type SortDir = 'asc' | 'desc';

export interface FarmerFilters {
  village: string | 'all';
  tier: RiskTier | 'all';
}

export function filterFarmers<T extends FarmerRowLike>(rows: T[], f: FarmerFilters): T[] {
  return rows.filter((r) => (f.village === 'all' || r.village === f.village) && (f.tier === 'all' || riskTier(r.riskScore).id === f.tier));
}

export function sortFarmers<T extends FarmerRowLike>(rows: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    // nulls (never contacted) always sort last
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv), 'en', { numeric: true }) * sign;
  });
}
