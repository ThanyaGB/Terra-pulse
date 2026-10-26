/**
 * Settings for the buyer-led straw offtake demo. Numbers and ids live here (or in the mock fixtures), never in components.
 * Demo settings, not an official scheme.
 */
export const SUPPLY_CONFIG = {
  /** the one buyer in the prototype; the mock only lets this buyer claim and record receipts */
  buyerId: 'BUYER-BIOCNG-SGR',
  /** a weighbridge net within this percentage of the claimed tonnes counts as matched */
  tolerancePct: 10,
  /** villages whose receipts are picked for a physical spot check */
  spotCheckVillages: ['sunam', 'moonak'],
} as const;

/** Village ids are the lower-case village name, so the buyer page can label them without a lookup. */
export const villageIdOf = (name: string): string => name.toLowerCase();
export const villageLabelOf = (id: string): string => (id ? id.charAt(0).toUpperCase() + id.slice(1) : id);
