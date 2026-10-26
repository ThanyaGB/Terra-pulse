/* Procedural paddy-season scene for the scroll story (Canvas 2D).
 * Ported from the design's "Website — scroll story" artboard. All data here is simulated. */
export type RGB = [number, number, number];
export interface Flame { x: number; y: number; vx: number; vy: number; life: number; max: number; sz: number }
export interface Smoke { x: number; y: number; vx: number; vy: number; life: number; max: number; sz0: number; sz1: number; a: number }
export interface TitlePt { tx: number; ty: number; sx: number; sy: number; dl: number; ox: number; oy: number; ph: number }
export interface Sprites {
  clouds: HTMLCanvasElement[][]; puff: HTMLCanvasElement; flame: HTMLCanvasElement; dot: HTMLCanvasElement; shade: HTMLCanvasElement; ember: HTMLCanvasElement;
  green: HTMLCanvasElement[]; gold: HTMLCanvasElement[]; stub: HTMLCanvasElement[]; char: HTMLCanvasElement[]; bale: HTMLCanvasElement; farmer: HTMLCanvasElement[];
}
export interface View {
  cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; o: { fx?: boolean; title?: boolean; fixedPan?: number };
  W: number; H: number; dpr: number; tier: number; pend: number;
  flames: Flame[]; smoke: Smoke[]; embers: Flame[]; title: TitlePt[] | null; titleStep: number; titleImg?: HTMLCanvasElement;
  mx: number | null; my: number; reduce?: boolean;
}
export function makeView(cv: HTMLCanvasElement | null, o: View['o']): View | null {
  if (!cv) return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = cv.getContext('2d'); } catch { /* no canvas */ }
  return ctx ? { cv, ctx, o, W: 0, H: 0, dpr: 1, tier: 0, pend: 0, flames: [], smoke: [], embers: [], title: null, titleStep: 4, mx: null, my: 0 } : null;
}
export const QUALITY = { dpr: [2, 1.5, 1], titleDesktop: 3200, titleMobile: 1400, flames: 420, smoke: 150, embers: 220, minTuftPx: 10 };
export const STAGES = [
  { day: 0, short: 'Transplant', name: 'Transplanting', note: 'Seedlings go into flooded paddies. The satellite logs a baseline for every plot.', ndvi: 0.18, m: 0.04 },
  { day: 28, short: 'Tillering', name: 'Tillering', note: 'Shoots multiply and the canopy closes. Greenness climbs fast.', ndvi: 0.46, m: 0.3 },
  { day: 60, short: 'Peak green', name: 'Panicle initiation', note: 'Peak greenness. The model learns each plot’s rhythm to forecast its harvest date.', ndvi: 0.82, m: 0.52 },
  { day: 88, short: 'Grain fill', name: 'Grain filling', note: 'Chlorophyll fades and NDVI turns. Harvest forecast tightens to ±3 days.', ndvi: 0.58, m: 0.74 },
  { day: 104, short: 'Ripe', name: 'Harvest-ready', note: 'Alert window opens 7–10 days before harvest. Machines are booked now, not after.', ndvi: 0.34, m: 0.92 },
  { day: 115, short: 'Harvested', name: 'Harvested — stubble left', note: 'About 2.5 t of straw per acre. Burn it, or bale it: this is the decision point.', ndvi: 0.21, m: 1 }
];
export const STAGE_P = [0.225, 0.335, 0.45, 0.545, 0.59, 0.655];
var DAY_KEYS: [number, number][] = [[0.215, 0], [0.33, 30], [0.44, 60], [0.53, 95], [0.6, 110], [0.68, 112], [0.8, 112], [0.89, 113]];
var PHASES: [number, string, string][] = [[0, 'Transplanting', '#34D399'], [20, 'Tillering', '#34D399'], [50, 'Peak green', '#34D399'], [85, 'Ripening', '#FBBF24'], [110, 'Harvested', '#FBBF24'], [112, 'Burning', '#FF8A3D'], [113, 'Smoke drift', '#E6D5BE']];

// ===== 5 · Procedural scene (Canvas 2D): sky, clouds, field, fire, smoke, particle title =====
export function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function sm(a: number, b: number, x: number): number { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function h2r(h: string): RGB { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mixc(a: RGB, b: RGB, t: number): RGB { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgba(c: RGB, a?: number | null): string { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')'; }
function hash(n: number): number { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function noise1(x: number): number { var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u); }
function rng(s: number): () => number { return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function mk(w: number, h: number): HTMLCanvasElement { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// sky grade keyframes: [progress, zenith, horizon, sun]
var SKY_RAW: [number, string, string, string][] = [
  [0, '#2F86D6', '#DFF3FF', '#FFFFFF'], [0.44, '#2F86D6', '#DFF3FF', '#FFFFFF'],
  [0.56, '#3577BE', '#FFE4BC', '#FFF1D6'], [0.64, '#2B5C98', '#FFC68A', '#FFD9A0'],
  [0.72, '#16294A', '#E0773A', '#FF9A55'], [0.82, '#231F21', '#6E4A34', '#FF6A3D'],
  [0.885, '#2A2624', '#5E4838', '#FF7A45'], [0.95, '#4FB3FF', '#F4FAFF', '#FFFFFF'], [1, '#4FB3FF', '#F4FAFF', '#FFFFFF']
];
var SKY: [number, RGB, RGB, RGB][] = SKY_RAW.map(function (k): [number, RGB, RGB, RGB] { return [k[0], h2r(k[1]), h2r(k[2]), h2r(k[3])]; });
function skyAt(P: number): RGB[] {
  for (var i = 1; i < SKY.length; i++) if (P <= SKY[i][0]) { var a = SKY[i - 1], b = SKY[i], t = sm(a[0], b[0], P); return [mixc(a[1], b[1], t), mixc(a[2], b[2], t), mixc(a[3], b[3], t)]; }
  var l = SKY[SKY.length - 1]; return [l[1], l[2], l[3]];
}
function rowY(d: number, hz: number, H: number): number { return hz + (H * 1.08 - hz) * Math.pow(1 - d, 1.9); }
function rowS(d: number): number { return 0.04 + 0.96 * Math.pow(1 - d, 1.9); }
function frontD(u: number, t: number, f: number): number { return 1.02 - f * 1.3 + (noise1(u * 6 + 3) - 0.5) * 0.16 + Math.sin(u * 9 + t * 0.6) * 0.012; }

export let SPR: Sprites | null = null;
export function setSprites(s: Sprites | null): void { SPR = s; }
function radial(size: number, stops: [number, string][]): HTMLCanvasElement { var c = mk(size, size), x = c.getContext('2d')!, g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); stops.forEach(function (s) { g.addColorStop(s[0], s[1]); }); x.fillStyle = g; x.fillRect(0, 0, size, size); return c; }
function cloudSprite(seed: number, tn: RGB[]): HTMLCanvasElement {
  var w = 600, h = 260, c = mk(w, h), x = c.getContext('2d')!, r = rng(seed);
  for (var i = 0; i < 58; i++) {
    var u = r(), px = w * (0.1 + 0.8 * u), hump = Math.sin(u * Math.PI), rad = 30 + r() * 60 * (0.45 + hump * 0.75);
    var py = h * 0.72 - hump * h * 0.36 * r() - rad * 0.12;
    var lit = mixc(tn[1], tn[0], clamp01(1.3 - py / h));
    var g = x.createRadialGradient(px, py - rad * 0.3, rad * 0.1, px, py, rad);
    g.addColorStop(0, rgba(lit, 0.5)); g.addColorStop(0.55, rgba(lit, 0.22)); g.addColorStop(1, rgba(lit, 0));
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 6.2832); x.fill();
  }
  return c;
}
function puffSprite(): HTMLCanvasElement {
  var s = 256, c = mk(s, s), x = c.getContext('2d')!, r = rng(77);
  for (var i = 0; i < 28; i++) {
    var a = r() * 6.283, d = r() * 62, px = 128 + Math.cos(a) * d, py = 128 + Math.sin(a) * d * 0.8, rad = 36 + r() * 54, sh = 140 + r() * 46;
    var g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(' + Math.round(sh) + ',' + Math.round(sh - 12) + ',' + Math.round(sh - 26) + ',.16)'); g.addColorStop(1, 'rgba(' + Math.round(sh) + ',' + Math.round(sh - 12) + ',' + Math.round(sh - 26) + ',0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 6.2832); x.fill();
  }
  return c;
}
function tuftSprite(kind: string, seed: number): HTMLCanvasElement {
  var c = mk(60, 112), x = c.getContext('2d')!, r = rng(seed), bx = 30, by = 110;
  x.lineCap = 'round';
  if (kind === 'green' || kind === 'gold') {
    var n = 11;
    for (var j = 0; j < n; j++) {
      var a = (-0.62 + 1.24 * j / (n - 1)) + (r() - 0.5) * 0.18, L = 62 + r() * 42, droop = Math.abs(a) * 0.9;
      var ex = bx + Math.sin(a) * L * 0.75 + (a < 0 ? -1 : 1) * droop * 14, ey = by - Math.cos(a) * L + droop * 20;
      var col = kind === 'green' ? mixc([12, 96, 60], [118, 232, 166], r()) : mixc([156, 108, 26], [248, 204, 96], r());
      var g = x.createLinearGradient(bx, by, ex, ey); g.addColorStop(0, rgba(mixc(col, [18, 36, 28], 0.5))); g.addColorStop(1, rgba(col));
      x.strokeStyle = g; x.lineWidth = 2.2 + r() * 1.3;
      x.beginPath(); x.moveTo(bx + (j - n / 2) * 0.9, by); x.quadraticCurveTo(bx + Math.sin(a) * L * 0.25, by - L * 0.7, ex, ey); x.stroke();
    }
    if (kind === 'gold') for (var q = 0; q < 4; q++) {
      var a2 = -0.5 + q * 0.33, px = bx + Math.sin(a2) * 36, py = by - 80 - r() * 12, dir = a2 < 0 ? -1 : 1;
      x.fillStyle = 'rgba(238,184,62,.95)';
      for (var k = 0; k < 7; k++) { x.beginPath(); x.ellipse(px + dir * k * 2.6, py + k * 3.4, 2.4, 3.4, 0.5 * dir, 0, 6.2832); x.fill(); }
    }
  } else {
    var n2 = 14;
    for (var m = 0; m < n2; m++) {
      var sx = bx + (m - n2 / 2) * 2.4 + (r() - 0.5) * 3, hh = 16 + r() * 14, ang = (r() - 0.5) * 0.3;
      x.strokeStyle = kind === 'stub' ? rgba(mixc([172, 126, 62], [236, 200, 124], r())) : rgba(mixc([26, 22, 20], [60, 50, 44], r()));
      x.lineWidth = 2.2; x.beginPath(); x.moveTo(sx, by); x.lineTo(sx + Math.sin(ang) * hh, by - hh); x.stroke();
      if (kind === 'char' && r() < 0.35) { x.fillStyle = 'rgba(255,138,61,.9)'; x.beginPath(); x.arc(sx + Math.sin(ang) * hh, by - hh, 1.6, 0, 6.2832); x.fill(); }
    }
    if (kind === 'stub') { x.strokeStyle = 'rgba(226,194,124,.85)'; x.lineWidth = 1.6; for (var s2 = 0; s2 < 5; s2++) { var lx = bx - 22 + r() * 44, ly = by - 2 - r() * 6; x.beginPath(); x.moveTo(lx, ly); x.lineTo(lx + 10 + r() * 10, ly - 3 + r() * 6); x.stroke(); } }
  }
  return c;
}
function baleSprite(): HTMLCanvasElement {
  var c = mk(72, 52), x = c.getContext('2d')!;
  x.fillStyle = 'rgba(40,30,10,.25)'; x.beginPath(); x.ellipse(40, 47, 30, 4, 0, 0, 6.2832); x.fill();
  var g = x.createLinearGradient(0, 4, 0, 48); g.addColorStop(0, '#F5D27A'); g.addColorStop(1, '#A77A2E');
  x.fillStyle = g; x.fillRect(22, 6, 40, 42); x.beginPath(); x.ellipse(62, 27, 7, 21, 0, 0, 6.2832); x.fill();
  x.fillStyle = '#F8DD92'; x.beginPath(); x.ellipse(22, 27, 12, 21, 0, 0, 6.2832); x.fill();
  x.strokeStyle = 'rgba(160,112,40,.6)'; x.lineWidth = 1.2;
  for (var i = 1; i < 4; i++) { x.beginPath(); x.ellipse(22, 27, 12 * i / 4, 21 * i / 4, 0, 0, 6.2832); x.stroke(); }
  return c;
}
function farmerSprite(hat: string): HTMLCanvasElement {
  var c = mk(30, 40), x = c.getContext('2d')!;
  x.fillStyle = 'rgba(20,40,50,.25)'; x.beginPath(); x.ellipse(15, 37, 9, 2.5, 0, 0, 6.2832); x.fill();
  x.strokeStyle = '#2B3A48'; x.lineWidth = 2.2; x.beginPath(); x.moveTo(11, 37); x.lineTo(12, 27); x.moveTo(18, 37); x.lineTo(17, 27); x.stroke();
  x.fillStyle = '#41556A'; x.beginPath(); x.ellipse(16, 23, 5.5, 8, 1.0, 0, 6.2832); x.fill();
  x.fillStyle = hat; x.beginPath(); x.moveTo(22, 11); x.lineTo(30, 18); x.lineTo(14, 18); x.closePath(); x.fill();
  return c;
}
export function buildSprites(): Sprites {
  var tints: RGB[][] = [[[255, 255, 255], [188, 210, 234]], [[255, 228, 196], [214, 160, 140]], [[116, 102, 92], [58, 50, 46]]];
  var S = { clouds: tints.map(function (tn) { var a: HTMLCanvasElement[] = []; for (var k = 0; k < 4; k++) a.push(cloudSprite(1009 + k * 97, tn)); return a; }) } as unknown as Sprites;
  S.puff = puffSprite();
  S.flame = radial(64, [[0, 'rgba(255,251,226,1)'], [0.22, 'rgba(255,214,120,.95)'], [0.5, 'rgba(255,138,61,.55)'], [1, 'rgba(180,83,9,0)']]);
  S.dot = radial(32, [[0, 'rgba(8,24,46,1)'], [0.78, 'rgba(11,45,80,1)'], [0.9, 'rgba(11,45,80,.6)'], [1, 'rgba(11,45,80,0)']]);
  S.shade = radial(16, [[0, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']]);
  S.ember = radial(16, [[0, 'rgba(255,240,200,1)'], [0.4, 'rgba(255,150,70,.85)'], [1, 'rgba(255,110,40,0)']]);
  ['green', 'gold', 'stub', 'char'].forEach(function (k, i) { (S as unknown as Record<string, HTMLCanvasElement[]>)[k] = [tuftSprite(k, 31 + i * 11), tuftSprite(k, 57 + i * 13), tuftSprite(k, 83 + i * 17)]; });
  S.bale = baleSprite();
  S.farmer = ['#F9A8D4', '#93C5FD', '#FDE68A'].map(farmerSprite);
  return S;
}
var CLOUDS = [
  { n: 6, alt: [0.06, 1.0], s: 0.55, par: 0.6, spd: 4, a: 0.75 },
  { n: 5, alt: [0.5, 1.45], s: 0.9, par: 1.0, spd: 9, a: 0.85 },
  { n: 4, alt: [0.9, 1.85], s: 1.5, par: 1.7, spd: 16, a: 0.92 }
];
var FARMERS: number[][] = [[0.22, -0.18, 0], [0.25, 0.05, 1], [0.3, 0.22, 2], [0.18, 0.32, 0], [0.34, -0.32, 1], [0.27, -0.05, 2], [0.4, 0.12, 0]];
var BALES: number[][] = [];
for (var bi = 0; bi < 16; bi++) BALES.push([0.06 + hash(bi * 4.1) * 0.5, (hash(bi * 7.3) - 0.5) * 1.4]);
BALES.sort(function (a, b) { return b[0] - a[0]; });
var BURN_COLS = [0.16, 0.34, 0.55, 0.83];

export function drawScene(v: View, P: number, t: number, dt: number): void {
  var ctx = v.ctx, W = v.W, H = v.H, dpr = v.dpr, S = SPR as Sprites, o = v.o;
  var pan = o.fixedPan != null ? o.fixedPan : sm(0.06, 0.205, P);
  var lift = o.fixedPan != null ? 0 : sm(0.865, 0.95, P);
  var hz = lerp(lerp(H * 1.5, H * 0.4, pan), H * 1.55, lift);
  var sky = skyAt(P), top = sky[0], hor = sky[1], sunC = sky[2];
  var golden = sm(0.48, 0.62, P), smoke = sm(0.7, 0.84, P) * (1 - sm(0.885, 0.95, P));
  var vpX = W * 0.5 + Math.sin(t * 0.05) * W * 0.01;
  var sway = v.reduce || v.tier >= 2 ? 0 : 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

  // sky gradient (zenith → horizon)
  var g = ctx.createLinearGradient(0, hz - H * 1.3, 0, hz);
  g.addColorStop(0, rgba(top)); g.addColorStop(1, rgba(hor)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // sun: bloom, god-rays, lens ghosts
  var sunX = W * 0.72, sunY = hz - lerp(H * 0.62, H * 0.07, sm(0.46, 0.76, P));
  var rayA = (1 - sm(0.4, 0.58, P)) + sm(0.93, 1, P);
  if (sunY < H + 300) {
    ctx.globalCompositeOperation = 'lighter';
    var br = H * lerp(0.55, 0.85, golden), sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, br);
    sg.addColorStop(0, rgba(sunC, 0.9)); sg.addColorStop(0.05, rgba(sunC, 0.5)); sg.addColorStop(0.28, rgba(sunC, 0.13 + golden * 0.08)); sg.addColorStop(1, rgba(sunC, 0));
    ctx.fillStyle = sg; ctx.fillRect(sunX - br, sunY - br, br * 2, br * 2);
    if (rayA > 0.01) {
      ctx.fillStyle = rgba([255, 255, 255], 0.045 * rayA);
      for (var ri = 0; ri < 14; ri++) {
        var an = ri / 14 * 6.2832 + t * 0.02, w2 = 0.035 + hash(ri) * 0.03, L = H * (0.6 + hash(ri + 9) * 0.6);
        ctx.beginPath(); ctx.moveTo(sunX, sunY); ctx.lineTo(sunX + Math.cos(an - w2) * L, sunY + Math.sin(an - w2) * L); ctx.lineTo(sunX + Math.cos(an + w2) * L, sunY + Math.sin(an + w2) * L); ctx.closePath(); ctx.fill();
      }
      var gx = W / 2 - sunX, gy = H / 2 - sunY, GH: [number, number, string][] = [[0.45, 34, '#8FD3FF'], [0.75, 14, '#FFFFFF'], [1.15, 52, '#DFF3FF'], [1.55, 22, '#8FD3FF']];
      for (var gi = 0; gi < GH.length; gi++) { ctx.fillStyle = rgba(h2r(GH[gi][2]), 0.07 * rayA); ctx.beginPath(); ctx.arc(sunX + gx * GH[gi][0] * 2, sunY + gy * GH[gi][0] * 2, GH[gi][1] * H / 900, 0, 6.2832); ctx.fill(); }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(mixc(sunC, [255, 255, 255], 0.4)); ctx.beginPath(); ctx.arc(sunX, sunY, 16 * H / 900 * (1 + smoke * 0.6), 0, 6.2832); ctx.fill();
  }

  // three parallax cloud layers (white → warm → smoke-dark tint)
  var cloudVis = 1 - smoke * 0.55, warm = golden * (1 - smoke), dark = smoke;
  for (var li = 0; li < CLOUDS.length; li++) {
    var Lr = CLOUDS[li];
    for (var ci = 0; ci < Lr.n; ci++) {
      var seed = li * 31 + ci, sw2 = 600 * Lr.s * (W / 1440) * (0.8 + hash(seed * 2.1) * 0.5), sh2 = sw2 * 260 / 600;
      var span = W + sw2 * 2, cx = ((hash(seed) * span + t * Lr.spd * (W / 1440)) % span) - sw2;
      var alt = lerp(Lr.alt[0], Lr.alt[1], hash(seed * 5.7));
      var cy = H * 0.4 - alt * H + (hz - H * 0.4) * Lr.par;
      if (cy > H || cy + sh2 < 0) continue;
      if (o.fixedPan != null && cy + sh2 * 0.8 > hz) continue;
      var sp = ci % 4, A = Lr.a * cloudVis;
      if (1 - warm - dark > 0.01) { ctx.globalAlpha = A * (1 - warm - dark); ctx.drawImage(S.clouds[0][sp], cx, cy, sw2, sh2); }
      if (warm > 0.01) { ctx.globalAlpha = A * warm; ctx.drawImage(S.clouds[1][sp], cx, cy, sw2, sh2); }
      if (dark > 0.01) { ctx.globalAlpha = A * dark; ctx.drawImage(S.clouds[2][sp], cx, cy, sw2, sh2); }
    }
  }
  ctx.globalAlpha = 1;

  if (hz < H) {
    var water = 1 - sm(0.25, 0.37, P), cut = sm(0.6, 0.645, P), burnG = sm(0.68, 0.86, P);
    var gc = mixc(h2r('#0E5E40'), h2r('#9C7330'), sm(0.5, 0.6, P)); gc = mixc(gc, h2r('#B8935A'), cut); gc = mixc(gc, h2r('#221C19'), burnG);
    var gg = ctx.createLinearGradient(0, hz, 0, H); gg.addColorStop(0, rgba(mixc(gc, hor, 0.55))); gg.addColorStop(1, rgba(mixc(gc, [0, 0, 0], 0.25)));
    ctx.fillStyle = gg; ctx.fillRect(0, hz, W, H - hz);
    if (water > 0.01) {
      var wg = ctx.createLinearGradient(0, hz, 0, H); wg.addColorStop(0, rgba(hor, 0.95 * water)); wg.addColorStop(1, rgba(mixc(top, [80, 140, 160], 0.45), 0.9 * water));
      ctx.fillStyle = wg; ctx.fillRect(0, hz, W, H - hz);
      ctx.globalCompositeOperation = 'lighter';
      var gy2 = hz + (H - hz) * 0.35, gr = ctx.createRadialGradient(sunX, gy2, 0, sunX, gy2, (H - hz) * 0.7);
      gr.addColorStop(0, rgba(sunC, 0.3 * water)); gr.addColorStop(1, rgba(sunC, 0));
      ctx.save(); ctx.translate(sunX, gy2); ctx.scale(0.3, 1); ctx.translate(-sunX, -gy2); ctx.fillStyle = gr; ctx.fillRect(sunX - (H - hz), hz, (H - hz) * 2, H - hz); ctx.restore();
      ctx.strokeStyle = rgba([255, 255, 255], 0.22 * water); ctx.lineWidth = 1; ctx.beginPath();
      for (var wi = 0; wi < 46; wi++) { var dd = hash(wi * 3.1) * 0.9, yy = rowY(dd, hz, H), ss = rowS(dd), xx = (hash(wi * 7.7) * W + t * 8 * ss) % W; ctx.moveTo(xx, yy); ctx.lineTo(xx + 40 * ss + 6, yy); }
      ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
    }
    // tree line + aerial haze
    var tc = mixc(mixc(h2r('#1F4D43'), hor, 0.45), [32, 28, 26], smoke * 0.6), ts = H / 900;
    ctx.fillStyle = rgba(tc); ctx.beginPath(); ctx.moveTo(0, hz + 2);
    for (var tx = 0; tx <= W + 8; tx += 8) ctx.lineTo(tx, hz - (6 + noise1(tx * 0.011 + 2) * 22 + noise1(tx * 0.05) * 9 + (noise1(tx * 0.004 + 9) > 0.62 ? 16 : 0)) * ts);
    ctx.lineTo(W, hz + 2); ctx.closePath(); ctx.fill();
    // bunds (field boundaries) converging to the vanishing point
    ctx.strokeStyle = water > 0.3 ? rgba([235, 248, 255], 0.16 + water * 0.14) : rgba(mixc([16, 46, 32], [92, 64, 30], sm(0.5, 0.6, P)), 0.2 * (1 - burnG * 0.6));
    ctx.lineWidth = 1.5; ctx.beginPath();
    for (var k = -9; k <= 9; k++) { var bwx = k * 0.24 + 0.07; ctx.moveTo(vpX, hz); ctx.lineTo(vpX + bwx * W * 1.25 * 1.12, H * 1.12); }
    [0.06, 0.16, 0.29, 0.45, 0.62].forEach(function (d) { var y = rowY(d, hz, H); ctx.moveTo(0, y); ctx.lineTo(W, y); });
    ctx.stroke();

    // fire: charred ground behind the advancing front
    var fireOn = o.fx && P > 0.655, f = sm(0.665, 0.8, P);
    if (fireOn && f > 0) {
      ctx.beginPath(); ctx.moveTo(-10, hz);
      for (var u = -0.05; u <= 1.05; u += 0.02) { var fd = Math.min(0.999, Math.max(0, frontD(u, t, f))); ctx.lineTo(u * W, rowY(fd, hz, H)); }
      ctx.lineTo(W + 10, hz); ctx.closePath(); ctx.fillStyle = 'rgba(28,22,20,.85)'; ctx.fill();
    }

    // rice field: rows of tufts, far → near (grow, sway, ripen, cut, burn)
    var growth = sm(0.215, 0.55, P), plantH = lerp(0.2, 1, growth), widthF = lerp(0.55, 1, sm(0.215, 0.36, P)), dens = lerp(0.55, 1, sm(0.215, 0.3, P));
    var goldT = sm(0.49, 0.585, P), minPx = QUALITY.minTuftPx * (v.tier >= 2 ? 1.7 : 1) * (W < 768 ? 1.4 : 1);
    var ROWS = 38, maxD = 0.63, spawnBudget = fireOn ? 6 : 0;
    for (var rI = ROWS - 1; rI >= 0; rI--) {
      var d = rI / (ROWS - 1) * maxD, y = rowY(d, hz, H), s = rowS(d), size = H * 0.19 * s;
      if (y - size > H) continue;
      var spanX = W * 1.25 * s, stepW = Math.max(0.034, minPx / spanX), range = (W * 0.62) / spanX + stepW;
      var j0 = Math.floor(-range / stepW), j1 = Math.ceil(range / stepW), sc = size / 110;
      for (var j = j0; j <= j1; j++) {
        var hs = hash(j * 12.9898 + rI * 78.233);
        if (hs > dens) continue;
        var x = vpX + (j + hs * 0.7 - 0.35) * stepW * spanX, kk = Math.floor(hs * 997) % 3;
        if (fireOn) {
          var fdx = frontD(x / W, t, f);
          if (d > fdx) { ctx.globalAlpha = 1; ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * x, dpr * y); ctx.drawImage(S.char[kk], -30, -110); continue; }
          if (d > fdx - 0.04 && spawnBudget > 0 && Math.random() < 0.06) { spawnFire(v, x, y, s, H); spawnBudget--; }
        }
        if (cut < 1) {
          var swy = sway * (Math.sin(t * 1.6 + x * 0.012 + rI * 0.5) * 0.06 + (noise1(t * 0.35 + x * 0.002) - 0.5) * 0.18) * growth;
          var sx = sc * widthF, sy = sc * plantH * (1 - cut * 0.75);
          ctx.setTransform(dpr * sx, 0, -dpr * swy * sx, dpr * sy, dpr * x, dpr * y);
          if (goldT < 1) { ctx.globalAlpha = 1 - cut; ctx.drawImage(S.green[kk], -30, -110); }
          if (goldT > 0) { ctx.globalAlpha = (1 - cut) * goldT; ctx.drawImage(S.gold[kk], -30, -110); }
        }
        if (cut > 0) { ctx.globalAlpha = cut; ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * x, dpr * y); ctx.drawImage(S.stub[kk], -30, -110); }
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;

    // farmers transplanting seedlings
    var fa = sm(0.17, 0.215, P) * (1 - sm(0.285, 0.32, P));
    if (fa > 0.01) {
      ctx.globalAlpha = fa;
      for (var fi = 0; fi < FARMERS.length; fi++) {
        var F = FARMERS[fi], fs = rowS(F[0]), fy = rowY(F[0], hz, H) + Math.sin(t * 2 + fi) * 1.5 * fs, fx = vpX + F[1] * W * 1.25 * fs, fz = 72 * fs * H / 900;
        ctx.drawImage(S.farmer[F[2]], fx - fz * 0.37, fy - fz, fz * 0.75, fz);
      }
    }
    // straw bales after harvest
    var ba = sm(0.625, 0.655, P);
    if (ba > 0.01) {
      for (var bj = 0; bj < BALES.length; bj++) {
        var B = BALES[bj], bs = rowS(B[0]), by = rowY(B[0], hz, H), bx = vpX + B[1] * W * 1.25 * bs, bw = 140 * bs * H / 900;
        if (fireOn && B[0] > frontD(bx / W, t, f) - 0.02) continue;
        ctx.globalAlpha = ba; ctx.drawImage(S.bale, bx - bw / 2, by - bw * 0.68, bw, bw * 0.72);
      }
    }
    ctx.globalAlpha = 1;

    // aerial-perspective fog over the far field
    var fg2 = ctx.createLinearGradient(0, hz, 0, rowY(0.42, hz, H)); fg2.addColorStop(0, rgba(hor, 0.8)); fg2.addColorStop(1, rgba(hor, 0));
    ctx.fillStyle = fg2; ctx.fillRect(0, hz - 1, W, rowY(0.42, hz, H) - hz + 1);

    // glowing fire front line
    if (fireOn && f > 0) {
      ctx.globalCompositeOperation = 'lighter';
      var LINES: [number, string][] = [[18, 'rgba(255,120,40,.16)'], [8, 'rgba(255,150,60,.4)'], [2.5, 'rgba(255,236,170,.9)']];
      for (var lk = 0; lk < LINES.length; lk++) {
        ctx.strokeStyle = LINES[lk][1]; ctx.lineWidth = LINES[lk][0] * H / 900; ctx.beginPath();
        for (var u2 = -0.05; u2 <= 1.05; u2 += 0.015) { var fd2 = frontD(u2, t, f); if (fd2 > 0.999 || fd2 < 0) continue; var yy2 = rowY(fd2, hz, H) + Math.sin(u2 * 80 + t * 9) * 2; if (u2 <= -0.04) ctx.moveTo(u2 * W, yy2); else ctx.lineTo(u2 * W, yy2); }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      // distant columns of smoke on the horizon (other farms burning)
      for (var bc = 0; bc < BURN_COLS.length; bc++) if (Math.random() < 0.25 * f) pushSmoke(v, { x: BURN_COLS[bc] * W + (Math.random() - 0.5) * 10, y: hz - 2, vx: 6, vy: -(28 + Math.random() * 18) * H / 900, sz0: 18 * H / 900, sz1: 170 * H / 900, max: 7, a: 0.55 });
    }
  }

  if (o.fx) stepParticles(v, P, t, dt);
  if (o.title) drawTitle(v, P, t);
}

function spawnFire(v: View, x: number, y: number, s: number, H: number): void {
  var k = H / 900;
  if (v.flames.length < QUALITY.flames / (v.tier >= 2 ? 2 : 1)) v.flames.push({ x: x + (Math.random() - 0.5) * 14 * s, y: y, vx: (8 + Math.random() * 18) * s * k, vy: -(70 + Math.random() * 90) * s * k, life: 0, max: 0.5 + Math.random() * 0.7, sz: (46 + Math.random() * 60) * s * k });
  if (Math.random() < 0.25 && v.embers.length < QUALITY.embers) v.embers.push({ x: x, y: y - 20 * s * k, vx: (20 + Math.random() * 50) * k, vy: -(60 + Math.random() * 110) * k, life: 0, max: 2 + Math.random() * 2.5, sz: (3 + Math.random() * 4) * k });
  if (Math.random() < 0.35) pushSmoke(v, { x: x, y: y - 30 * s * k, vx: (22 + Math.random() * 20) * k, vy: -(26 + Math.random() * 26) * k, sz0: 60 * s * k, sz1: (260 + Math.random() * 200) * k, max: 6 + Math.random() * 4, a: 0.5 });
}
function pushSmoke(v: View, p: Omit<Smoke, 'life'>): void { if (v.smoke.length < QUALITY.smoke / (v.tier >= 2 ? 2 : 1)) { v.smoke.push({ ...p, life: 0 }); } }
function stepParticles(v: View, P: number, t: number, dt: number): void {
  var ctx = v.ctx, S = SPR as Sprites, W = v.W, H = v.H, fxA = sm(0.64, 0.69, P), clear = 1 - sm(0.885, 0.94, P);
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  // engulfing smoke bank rolling in on the north-west wind
  var eng = sm(0.76, 0.84, P) * (1 - sm(0.875, 0.9, P));
  if (eng > 0 && Math.random() < 0.6 * eng) pushSmoke(v, { x: -W * 0.2 + Math.random() * W * 0.5, y: H * (0.2 + Math.random() * 0.9), vx: (70 + Math.random() * 60) * H / 900, vy: -8, sz0: H * 0.35, sz1: H * 1.2, max: 6, a: 0.7 });
  ctx.globalCompositeOperation = 'lighter';
  var F = v.flames, n = 0;
  for (var i = 0; i < F.length; i++) {
    var p = F[i]; p.life += dt; if (p.life > p.max) continue;
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 0.985;
    var k = p.life / p.max, sz = p.sz * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) * 0.9);
    ctx.globalAlpha = (1 - k) * 0.9 * fxA * clear; ctx.drawImage(S.flame, p.x - sz / 2, p.y - sz * 0.75, sz, sz * 1.3); F[n++] = p;
  }
  F.length = n;
  var E = v.embers; n = 0;
  for (var e = 0; e < E.length; e++) {
    var q = E[e]; q.life += dt; if (q.life > q.max) continue;
    q.x += q.vx * dt + Math.sin(t * 3 + e) * 0.4; q.y += q.vy * dt; q.vy *= 0.995;
    ctx.globalAlpha = (1 - q.life / q.max) * (0.6 + Math.sin(t * 20 + e) * 0.4) * fxA * clear; ctx.drawImage(S.ember, q.x - q.sz, q.y - q.sz, q.sz * 2, q.sz * 2); E[n++] = q;
  }
  E.length = n;
  ctx.globalCompositeOperation = 'source-over';
  var M = v.smoke; n = 0;
  for (var m = 0; m < M.length; m++) {
    var s = M[m]; s.life += dt; if (s.life > s.max) continue;
    s.x += s.vx * dt; s.y += s.vy * dt; s.vy *= 0.997;
    var kk = s.life / s.max, sz2 = lerp(s.sz0, s.sz1, Math.sqrt(kk)), al = (kk < 0.15 ? kk / 0.15 : 1 - (kk - 0.15) / 0.85) * s.a * fxA * clear;
    if (al > 0.005) { ctx.globalAlpha = al; ctx.drawImage(S.puff, s.x - sz2 / 2, s.y - sz2 / 2, sz2, sz2); }
    M[n++] = s;
  }
  M.length = n;
  ctx.globalAlpha = 1;
  // haze: the inversion layer fills the frame
  var hzA = 0.62 * sm(0.74, 0.86, P) * clear;
  if (hzA > 0.01) { var hg = ctx.createLinearGradient(0, 0, W, H); hg.addColorStop(0, 'rgba(84,70,60,' + hzA + ')'); hg.addColorStop(1, 'rgba(58,46,40,' + (hzA * 0.85) + ')'); ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H); }
}

export function buildTitle(v: View): void {
  var W = v.W, H = v.H, c = mk(Math.max(1, Math.ceil(W)), Math.max(1, Math.ceil(H))), x = c.getContext('2d')!;
  var fs = Math.min(W * 0.16, H * 0.26, 240), cy = H * 0.4;
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '400 ' + fs + 'px "Bebas Neue", Impact, "Arial Narrow", sans-serif';
  x.fillText('VAYU.', W / 2, cy - fs * 0.44); x.fillText('SWACHH.', W / 2, cy + fs * 0.44);
  // the same words as a solid wordmark at full screen resolution: the particles settle into it, so the title ends sharp
  var d = v.dpr || 1, img = mk(Math.max(1, Math.ceil(W * d)), Math.max(1, Math.ceil(H * d))), ix = img.getContext('2d')!;
  ix.scale(d, d); ix.fillStyle = '#0B2D50'; ix.textAlign = 'center'; ix.textBaseline = 'middle'; ix.font = x.font;
  ix.fillText('VAYU.', W / 2, cy - fs * 0.44); ix.fillText('SWACHH.', W / 2, cy + fs * 0.44);
  v.titleImg = img;
  var data = x.getImageData(0, 0, c.width, c.height).data, pts: number[][] = [], step = Math.max(2, Math.round(fs / 44));
  for (var yy = 0; yy < c.height; yy += step) for (var xx = 0; xx < c.width; xx += step) if (data[(yy * c.width + xx) * 4 + 3] > 128) pts.push([xx, yy]);
  var maxN = (W < 768 ? QUALITY.titleMobile : QUALITY.titleDesktop) / (v.tier >= 2 ? 2 : 1);
  if (pts.length > maxN) { var r = maxN / pts.length, keep: number[][] = []; for (var i = 0; i < pts.length; i++) if (hash(i * 1.37) < r) keep.push(pts[i]); pts = keep; }
  v.titleStep = step;
  v.title = pts.map(function (p, i) { return { tx: p[0], ty: p[1], sx: hash(i * 3.3) * W, sy: H * (0.2 + hash(i * 5.1) * 0.9), dl: hash(i * 9.7) * 0.4, ox: 0, oy: 0, ph: hash(i * 2.2) * 6.28 }; });
}
function drawTitle(v: View, P: number, t: number): void {
  if (!v.title) return;
  var ta = sm(0.885, 0.92, P); if (ta <= 0) return;
  var tt = v.reduce ? 1 : sm(0.9, 0.985, P), ctx = v.ctx, S = SPR as Sprites, base = Math.max(2.8, v.titleStep * 1.5);
  // solid: how far the letters have firmed up into the crisp wordmark (dots arrive first, then the letters solidify)
  var solid = v.reduce ? 1 : sm(0.55, 0.95, tt);
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0); ctx.globalCompositeOperation = 'source-over';
  for (var pass = 0; pass < 2; pass++) {
    if (pass === 1 && v.titleImg && solid > 0) {
      // crisp wordmark with a soft white glow behind it, drawn 1:1 with device pixels
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = ta * solid; ctx.shadowColor = 'rgba(255,255,255,0.8)'; ctx.shadowBlur = 22 * v.dpr;
      ctx.drawImage(v.titleImg, 0, 0);
      ctx.shadowBlur = 0; ctx.drawImage(v.titleImg, 0, 0);
      ctx.restore();
    }
    for (var i = 0; i < v.title.length; i++) {
      var p = v.title[i], k = clamp01((tt - p.dl) / 0.6), e = 1 - Math.pow(1 - k, 3), wob = 1 - e;
      var x = lerp(p.sx + Math.sin(t * 0.4 + p.ph) * 40 * wob, p.tx, e), y = lerp(p.sy + Math.cos(t * 0.3 + p.ph) * 24 * wob, p.ty, e);
      if (pass === 1) {
        if (v.mx != null) { var dx = x + p.ox - v.mx, dy = y + p.oy - v.my, d2 = dx * dx + dy * dy; if (d2 < 14400 && d2 > 1) { var dd = Math.sqrt(d2), fo = (120 - dd) / 120 * 6; p.ox += dx / dd * fo; p.oy += dy / dd * fo; } }
        p.ox *= 0.9; p.oy *= 0.9;
        // settled dots melt into the solid letters; dots pushed away by the cursor stay visible
        var off = Math.min(1, (Math.abs(p.ox) + Math.abs(p.oy)) / 6);
        var sz = lerp(base * 1.8, base, e); ctx.globalAlpha = ta * lerp(0.45, 1, e) * (1 - solid * (1 - off)); ctx.drawImage(S.dot, x + p.ox - sz / 2, y + p.oy - sz / 2, sz, sz);
      } else if (e > 0.5 && solid < 1) {
        var sh = base * 2.2; ctx.globalAlpha = ta * (e - 0.5) * 1.2 * (1 - solid); ctx.drawImage(S.shade, x + p.ox - sh / 2, y + p.oy - sh / 2, sh, sh);
      }
    }
  }
  ctx.globalAlpha = 1;
}

// resize with debounce; returns true when the backing store was rebuilt
export function fitView(v: View, r: DOMRect, tier: number, now: number): boolean {
  var dpr = Math.min(window.devicePixelRatio || 1, QUALITY.dpr[tier]);
  if (Math.abs(r.width - v.W) < 1 && Math.abs(r.height - v.H) < 1 && dpr === v.dpr) { v.pend = 0; return false; }
  if (v.W > 0 && !v.pend) { v.pend = now; return false; }
  if (v.W > 0 && now - v.pend < 160) return false;
  v.W = r.width; v.H = r.height; v.dpr = dpr; v.tier = tier; v.pend = 0;
  v.cv.width = Math.round(r.width * dpr); v.cv.height = Math.round(r.height * dpr);
  return true;
}

export function dayAt(p: number): number {
  if (p <= DAY_KEYS[0][0]) return 0;
  for (var i = 1; i < DAY_KEYS.length; i++) if (p <= DAY_KEYS[i][0]) { var a = DAY_KEYS[i - 1], b = DAY_KEYS[i]; return Math.round(a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0])); }
  return 113;
}
export function phaseOf(d: number, p: number): [number, string, string] { var ph = PHASES[0]; for (var i = 0; i < PHASES.length; i++) if (d >= PHASES[i][0]) ph = PHASES[i]; if (p > 0.67 && p < 0.8) ph = PHASES[5]; if (p >= 0.8) ph = PHASES[6]; return ph; }

export function mix(a: string, b: string, t: number): string { var x = h2r(a), y = h2r(b); return 'rgb(' + x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); }).join(',') + ')'; }
var RAMP: [number, string][] = [[0, '#7C9A93'], [0.3, '#34D399'], [0.52, '#10B981'], [0.78, '#FBBF24'], [1, '#C79A5B']];
export function ramp(m: number): string {
  m = clamp01(m);
  for (var i = 1; i < RAMP.length; i++) if (m <= RAMP[i][0]) { var a = RAMP[i - 1], b = RAMP[i]; return mix(a[1], b[1], (m - a[0]) / (b[0] - a[0])); }
  return RAMP[RAMP.length - 1][1];
}
export function words(s: string): { t: string; d: number }[] { return s.split(' ').map(function (t, i) { return { t: t, d: i * 80 }; }); }
