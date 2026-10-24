import { describe, expect, it } from 'vitest';
import { AQI_BANDS, aqiGaugeFraction, describeAqi, formatAqi, formatPm25, getAqiBand, pm25ToAqi } from '@/lib/aqi';
import { contrastRatio } from '@/lib/color';

describe('getAqiBand', () => {
  it.each([
    [0, 'good'], [50, 'good'], [51, 'satisfactory'], [100, 'satisfactory'], [101, 'moderate'], [200, 'moderate'],
    [201, 'poor'], [300, 'poor'], [301, 'very-poor'], [362, 'very-poor'], [400, 'very-poor'], [401, 'severe'],
    [450, 'severe'], [451, 'severe-plus'], [499, 'severe-plus'], [650, 'severe-plus'],
  ])('AQI %i is %s', (aqi, id) => {
    expect(getAqiBand(aqi).id).toBe(id);
  });

  it('rounds before choosing the band (50.4 is still Good, 50.6 is Satisfactory)', () => {
    expect(getAqiBand(50.4).id).toBe('good');
    expect(getAqiBand(50.6).id).toBe('satisfactory');
  });

  it('treats missing or invalid readings as Good rather than crashing', () => {
    expect(getAqiBand(null).id).toBe('good');
    expect(getAqiBand(undefined).id).toBe('good');
    expect(getAqiBand(Number.NaN).id).toBe('good');
    expect(getAqiBand(-12).id).toBe('good');
  });

  it('bands are contiguous and cover the whole scale', () => {
    for (let i = 1; i < AQI_BANDS.length; i++) expect(AQI_BANDS[i]!.min).toBe(AQI_BANDS[i - 1]!.max + 1);
    expect(AQI_BANDS[0]!.min).toBe(0);
    expect(AQI_BANDS.at(-1)!.max).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('formatAqi', () => {
  it('rounds to a whole number', () => expect(formatAqi(361.6)).toBe('362'));
  it('caps the display at 500+', () => {
    expect(formatAqi(500)).toBe('500');
    expect(formatAqi(500.4)).toBe('500');
    expect(formatAqi(731)).toBe('500+');
  });
  it('shows a dash when there is no reading', () => {
    expect(formatAqi(null)).toBe('—');
    expect(formatAqi(Number.NaN)).toBe('—');
  });
  it('never shows a negative number', () => expect(formatAqi(-4)).toBe('0'));
});

describe('formatPm25', () => {
  it('uses whole numbers from 10 µg/m³ up', () => expect(formatPm25(214.4)).toBe('214 µg/m³'));
  it('keeps one decimal below 10', () => expect(formatPm25(7.26)).toBe('7.3 µg/m³'));
  it('handles missing values', () => expect(formatPm25(undefined)).toBe('—'));
});

describe('describeAqi', () => {
  it('reads naturally for a screen reader', () => expect(describeAqi(362)).toBe('AQI 362, Very Poor'));
  it('says so when there is no reading', () => expect(describeAqi(null)).toBe('AQI unavailable'));
});

describe('aqiGaugeFraction', () => {
  it('maps 0..500 to 0..1 and clamps', () => {
    expect(aqiGaugeFraction(0)).toBe(0);
    expect(aqiGaugeFraction(250)).toBe(0.5);
    expect(aqiGaugeFraction(900)).toBe(1);
    expect(aqiGaugeFraction(null)).toBe(0);
  });
});

describe('pm25ToAqi (CPCB sub-index)', () => {
  it.each([[0, 0], [30, 50], [60, 100], [90, 200], [120, 300], [250, 400], [380, 500]])('PM2.5 %i -> AQI %i at the breakpoints', (pm, aqi) => {
    expect(pm25ToAqi(pm)).toBe(aqi);
  });
  it('interpolates inside a band', () => expect(pm25ToAqi(75)).toBe(150));
  it('keeps climbing beyond 380 so Severe+ stays visible', () => expect(pm25ToAqi(462)).toBeGreaterThan(500));
  it('is monotonic', () => {
    let prev = -1;
    for (let pm = 0; pm <= 600; pm += 5) { const v = pm25ToAqi(pm); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });
});

describe('colour tokens meet WCAG AA (4.5:1)', () => {
  it.each(AQI_BANDS.map((b) => [b.label, b] as const))('%s badge text on its fill', (_label, b) => {
    expect(contrastRatio(b.fg, b.bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(AQI_BANDS.map((b) => [b.label, b] as const))('%s colour as text on white', (_label, b) => {
    expect(contrastRatio(b.text, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
  it('primary button (white on leaf-700)', () => expect(contrastRatio('#FFFFFF', '#0B7A53')).toBeGreaterThanOrEqual(4.5));
});
