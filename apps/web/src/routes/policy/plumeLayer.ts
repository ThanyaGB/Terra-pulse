import * as THREE from 'three';
import type { LngLat } from '@/api/contract';
import { frontFraction } from '@/lib/plume';

export type Project = (lng: number, lat: number) => { x: number; y: number };

export interface PlumeLayerConfig {
  corridor: LngLat[];
  hoursToReachNcr: number;
  /** number of particles */
  count?: number;
}

export interface PlumeLayer {
  setProject(fn: Project): void;
  setHour(hour: number): void;
  resize(width: number, height: number): void;
  /** render one frame at `timeSec` (called from the layer's own loop unless `animate` is false) */
  renderFrame(timeSec?: number): void;
  dispose(): void;
}

/** Plume strength over the 72 h horizon: builds as the front travels, lingers, then disperses. */
export function plumeIntensity(hour: number, hoursToReachNcr: number): number {
  const build = Math.min(1, 0.25 + (hour / Math.max(1, hoursToReachNcr)) * 0.75);
  const decayStart = hoursToReachNcr + 10;
  if (hour <= decayStart) return build;
  return build * 0.5 ** ((hour - decayStart) / 28);
}

interface Seg { a: LngLat; b: LngLat; start: number; len: number }

function buildPath(points: LngLat[]) {
  const segs: Seg[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, start: total, len });
    total += len;
  }
  return {
    total,
    /** position + unit normal at fraction s (0..1) along the corridor */
    at(s: number): { lng: number; lat: number; nx: number; ny: number } {
      const d = Math.min(1, Math.max(0, s)) * total;
      const seg = segs.find((g) => d <= g.start + g.len) ?? segs[segs.length - 1]!;
      const k = seg.len === 0 ? 0 : (d - seg.start) / seg.len;
      const dx = seg.b[0] - seg.a[0];
      const dy = seg.b[1] - seg.a[1];
      const l = Math.hypot(dx, dy) || 1;
      return { lng: seg.a[0] + dx * k, lat: seg.a[1] + dy * k, nx: -dy / l, ny: dx / l };
    },
  };
}

const VERT = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  uniform float uPx;
  void main() {
    vAlpha = aAlpha;
    gl_PointSize = aSize * uPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  uniform vec3 uColor;
  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, vAlpha * soft);
  }
`;

/**
 * Three.js particle layer. Particles stream along the Sangrur -> NCR corridor; the scrubber hour sets
 * how far the front has travelled and how dense the plume is. Throws if WebGL is unavailable.
 */
export function createPlumeLayer(canvas: HTMLCanvasElement, cfg: PlumeLayerConfig, opts: { animate?: boolean } = {}): PlumeLayer {
  const animate = opts.animate ?? true;
  const N = cfg.count ?? 2600;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  let width = canvas.clientWidth || 600;
  let height = canvas.clientHeight || 360;
  const camera = new THREE.OrthographicCamera(0, width, 0, height, -10, 10); // y grows downward, like screen px
  const path = buildPath(cfg.corridor);

  const pos = new Float32Array(N * 3);
  const alpha = new Float32Array(N);
  const size = new Float32Array(N);
  // fixed random attributes per particle
  const seedU = new Float32Array(N);
  const seedV = new Float32Array(N);
  const speed = new Float32Array(N);
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < N; i++) {
    seedU[i] = rnd();
    seedV[i] = (rnd() + rnd() + rnd() - 1.5) / 1.5; // roughly gaussian, -1..1
    speed[i] = 0.6 + rnd() * 0.8;
    size[i] = 5 + rnd() * 9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: { uColor: { value: new THREE.Color('#9A7B4F') }, uPx: { value: Math.min(window.devicePixelRatio || 1, 2) } },
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let project: Project = (lng, lat) => ({ x: lng, y: lat });
  let hour = 0;
  let raf = 0;
  let disposed = false;

  function resize(w: number, h: number) {
    width = Math.max(1, w);
    height = Math.max(1, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.right = width;
    camera.bottom = height;
    camera.updateProjectionMatrix();
    mat.uniforms.uPx!.value = Math.min(window.devicePixelRatio || 1, 2);
  }

  function renderFrame(timeSec = 0) {
    if (disposed) return;
    const front = Math.max(0.02, frontFraction(hour, cfg.hoursToReachNcr));
    const strength = plumeIntensity(hour, cfg.hoursToReachNcr);
    for (let i = 0; i < N; i++) {
      const phase = (seedU[i]! + timeSec * 0.045 * speed[i]!) % 1;
      const along = phase * front;
      const p = path.at(along);
      // the plume widens with distance; lateral spread is in degrees
      const spread = (0.05 + 0.32 * along) * seedV[i]!;
      const pt = project(p.lng + p.nx * spread, p.lat + p.ny * spread);
      pos[i * 3] = pt.x;
      pos[i * 3 + 1] = pt.y;
      pos[i * 3 + 2] = 0;
      const edge = 1 - Math.abs(seedV[i]!);
      const tail = Math.min(1, (1 - phase) * 1.6);
      alpha[i] = Math.max(0, strength * 0.55 * edge * tail);
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    renderer.render(scene, camera);
  }

  const t0 = performance.now();
  function loop() {
    if (disposed) return;
    if (!document.hidden) renderFrame((performance.now() - t0) / 1000);
    raf = requestAnimationFrame(loop);
  }
  resize(width, height);
  if (animate) raf = requestAnimationFrame(loop);
  else renderFrame(2);

  return {
    setProject(fn) { project = fn; if (!animate) renderFrame(2); },
    setHour(h) { hour = h; if (!animate) renderFrame(2); },
    resize(w, h) { resize(w, h); if (!animate) renderFrame(2); },
    renderFrame,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
    },
  };
}
