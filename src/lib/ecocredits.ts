/**
 * Eco-credit estimate used everywhere in the prototype (landing card and FPO console), so the numbers always agree.
 * Demo assumptions, not an official scheme:
 *  - a paddy acre leaves about 2.5 t of straw;
 *  - burning a tonne of straw releases about 1.5 t CO2-equivalent, so collecting it avoids that;
 *  - 10 credits per tonne of CO2e avoided.
 * Farmer income is separate: straw is bought at the Bio-CNG plant's floor price (BiomassStatus.floorPriceInrPerTonne).
 */
export const STRAW_T_PER_ACRE = 2.5;
export const CO2E_T_PER_STRAW_T = 1.5;
export const CREDITS_PER_CO2E_T = 10;

export interface CreditEstimate { strawT: number; co2eT: number; credits: number }

export function creditsForStraw(strawT: number): CreditEstimate {
  const co2eT = strawT * CO2E_T_PER_STRAW_T;
  return { strawT, co2eT, credits: Math.round(co2eT * CREDITS_PER_CO2E_T) };
}

export const creditsForAcres = (acres: number): CreditEstimate => creditsForStraw(acres * STRAW_T_PER_ACRE);
