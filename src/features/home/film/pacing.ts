/**
 * Scroll length of the film. The base story is paced for 7200 px; the extra pixels all go to the burning stretch
 * (the match, dusk fires and smoke leaving), so it no longer flashes past. Every other stage scrolls as before.
 */
export const BASE_FILM_PX = 7200;
export const FILM_PX = 9000;
export const BURN_FROM = 0.665, BURN_TO = 0.83;

/** Raw scroll fraction (0..1) → film progress, with the burning stretch slowed down by the extra scroll length. */
export function slowBurn(u: number, span: number, baseSpan: number): number {
  if (baseSpan <= 0 || span <= baseSpan) return u;
  const len = BURN_TO - BURN_FROM;
  const k = 1 + (span / baseSpan - 1) / len;          // how many times longer the burning stretch lasts
  const x = u * (span / baseSpan);
  if (x < BURN_FROM) return x;
  if (x < BURN_FROM + len * k) return BURN_FROM + (x - BURN_FROM) / k;
  return Math.min(1, x - len * (k - 1));
}
