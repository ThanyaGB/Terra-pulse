/* Copy and seed data for the landing page. Everything here is simulated, as the on-page disclaimer says. */
import { words } from './film/scene';

export const caps = [
  { a: -1, b: 0.085, ec: '#DFF3FF', eyebrow: 'Delhi-NCR · every October', title: 'It starts with a clear sky.', body: 'Scroll to follow one paddy season, from seedling to smoke.' },
  { a: 0.1, b: 0.2, ec: '#DFF3FF', eyebrow: '230 km upwind · Sangrur, Punjab', title: 'Down below, a rice field.', body: 'Millions of small plots like this one feed India, and shape the air of its capital.' },
  { a: 0.225, b: 0.31, ec: '#6EE7B7', eyebrow: 'Day 0 · Transplanting', title: 'Seedlings go into flooded paddies.', body: 'Each plot gets a satellite baseline the day it is planted.' },
  { a: 0.335, b: 0.42, ec: '#6EE7B7', eyebrow: 'Day 30 · Tillering', title: 'The canopy closes.', body: 'Greenness (NDVI) climbs. The forecast agent learns this plot’s rhythm.' },
  { a: 0.44, b: 0.505, ec: '#6EE7B7', eyebrow: 'Day 60 · Peak green', title: 'The field at its fullest.', body: 'Harvest date forecast: within about five days (estimate).' },
  { a: 0.52, b: 0.585, ec: '#FCD34D', eyebrow: 'Day 95 · Ripening', title: 'Gold means 7–10 days to harvest.', body: 'This is the window where Vayu-Swachh acts.' },
  { a: 0.6, b: 0.66, ec: '#FCD34D', eyebrow: 'Day 110 · Harvested', title: 'The grain leaves. The straw stays.', body: 'About 2.5 tonnes per acre, and only weeks to sow wheat.' },
  { a: 0.675, b: 0.735, ec: '#FFB27D', eyebrow: 'Day 112 · The match', title: 'Burning is free. And fast.', body: 'Machines are scarce at the peak. Fire clears a field in an afternoon.' },
  { a: 0.745, b: 0.82, ec: '#FFB27D', eyebrow: 'Day 112 · Dusk', title: 'Thousands of fields. One sky.', body: 'Satellites see the heat. Nobody downwind feels it yet.' },
  { a: 0.83, b: 0.885, ec: '#E6D5BE', eyebrow: 'Day 113 · Downwind', title: 'The smoke rides the north-west wind.', body: 'A low winter inversion traps it over Delhi-NCR, where tens of millions breathe it.' }
];

export const facts = [
  { v: '2–3 wk', label: 'between rice harvest and wheat sowing', note: 'The squeeze that makes burning tempting.', bg: '#0F2A47', fg: '#F4FAFF' },
  { v: '~20 Mt', label: 'paddy straw left each year in Punjab alone', note: 'Commonly cited estimate; varies by season.', bg: '#FFF1E6', fg: '#5A2E05' },
  { v: 'Hours', label: 'of warning Delhi streets get today, at best', note: 'City-wide AQI reacts after the smoke arrives.', bg: '#E3F8EE', fg: '#063D2A' }
];

export const gaps = [
  { n: '01', title: 'Prediction', today: 'Fires are counted after they are lit.', fix: 'NDVI forecasts each plot’s harvest 7–10 days ahead.' },
  { n: '02', title: 'Logistics', today: 'Machines idle in one village, missing in the next.', fix: 'FPO dispatch routes the nearest Super Seeder to the riskiest plot.' },
  { n: '03', title: 'Communication', today: 'Advisories arrive as English PDFs.', fix: 'Voice calls in Punjabi, Hindi or English. Press 1 to book.' },
  { n: '04', title: 'Health', today: 'One AQI number for a whole city.', fix: 'Street-level alerts, clean routes and advice for sensitive groups.' }
];

export const loop = [
  { num: '1', color: '#10B981', d: 0, agent: 'Forecast agent', title: 'Fire-risk forecast', body: 'NDVI and harvest dates predict which plots will burn, 7–10 days early.' },
  { num: '2', color: '#0E8F62', d: 400, agent: 'Dispatch agent', title: 'Machinery & buy-back', body: 'FPOs route Super Seeders, balers and Bio-CNG trucks to the riskiest plots.' },
  { num: '3', color: '#4FB3FF', d: 800, agent: 'Voice agent', title: 'Farmer calls', body: 'Outbound calls in Punjabi, Hindi or English. Press 1 to book a machine.' },
  { num: '4', color: '#FF8A3D', d: 1200, agent: 'Plume agent', title: 'Satellite & plume', body: 'Fire points and wind fields forecast where smoke lands, hours ahead.' },
  { num: '5', color: '#0F6FB8', d: 1600, agent: 'Health agent', title: 'Street-level alerts', body: 'Ward-level AQI advice, cleaner routes and dust reports for citizens.' }
];

export const acts = [
  { href: '#problem', label: 'Problem', aria: 'Go to the problem', color: '#B45309' },
  { href: '#act1', label: 'Sky watch', aria: 'Go to act 1, high-altitude watch', color: '#4FB3FF' },
  { href: '#act2', label: 'Field', aria: 'Go to act 2, field early warning', color: '#34D399' },
  { href: '#act3', label: 'Plume', aria: 'Go to act 3, fire points and smoke plume', color: '#FF8A3D' },
  { href: '#act4', label: 'Response', aria: 'Go to act 4, response loop', color: '#10B981' },
];

export const s0 = words('Every autumn, the cheapest way to clear a field is a match.');
export const s1 = words('Let every breath be traceable.');
export const s2 = words('We know 7–10 days before harvest.');
export const s3 = words('Smoke knows no borders. Warnings must come first.');
export const s4 = words('From warning to action — a single click.');

export const nodes = [{ x: 190, y: 268, c: '#34D399', d: 0 }, { x: 276, y: 348, c: '#10B981', d: 500 }, { x: 326, y: 258, c: '#FF8A3D', d: 1000 }, { x: 360, y: 380, c: '#4FB3FF', d: 1500 }];

export const villages = [
  { name: 'Bhawanigarh', risk: 92, acres: 6, status: 'Machine dispatched', ok: true },
  { name: 'Sunam', risk: 88, acres: 9, status: 'To contact', ok: false },
  { name: 'Dhuri', risk: 81, acres: 4, status: 'To contact', ok: false },
  { name: 'Lehragaga', risk: 74, acres: 7, status: 'Machine dispatched', ok: true },
].map((v) => ({ ...v, rc: v.risk >= 85 ? '#B45309' : '#0B1D33', sbg: v.ok ? '#E3F8EE' : '#FFF1E6', sfg: v.ok ? '#0B7A53' : '#8A4B0F' }));

export const inventory = [{ name: 'Super Seeder', n: 4, max: 6 }, { name: 'Baler', n: 2, max: 4 }, { name: 'Happy Seeder', n: 3, max: 5 }].map((x) => ({ ...x, pct: Math.round((x.n / x.max) * 100) }));

export const arrows: { x: number; y: number; x2: number; y2: number; d: number }[] = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const x = 80 + c * 110 + (r % 2) * 40, y = 70 + r * 95; arrows.push({ x, y, x2: x + 26, y2: y + 16, d: (r * 6 + c) * 110 }); }

export const fires = ([[120, 110, 1], [170, 150, 1], [210, 100, 1], [150, 200, 1], [240, 170, 1], [95, 160, 0], [260, 220, 0], [200, 230, 0], [330, 200, 1]] as [number, number, number][])
  .map((f, j) => ({ x: f[0], y: f[1], d: j * 220, fill: f[2] ? '#FF8A3D' : 'none', dash: f[2] ? 'none' : '3 3', glow: f[2] ? 0.8 : 0 }));

export const plumes = Array.from({ length: 8 }, (_, q) => ({ x: 140 + (q % 4) * 40, y: 120 + (q % 3) * 40, rx: 34 + (q % 3) * 8, ry: 20 + (q % 2) * 6, d: q * 880 }));

export const city = Array.from({ length: 9 }, (_, b) => { const h = 18 + ((b * 13) % 5) * 9; return { x: 584 + b * 13, y: 392 - h, h }; });

const waText = 'Vayu-Swachh demo booking: Super Seeder for farm PB-SGR-1142 (6 acres), Bhawanigarh. Rate Rs 750/acre (demo).';
/** Placeholder number: replace before any real use. */
export const WA_BASE = 'https://wa.me/910000000000'; // placeholder number
export const waLink = WA_BASE + '?text=' + encodeURIComponent(waText);
