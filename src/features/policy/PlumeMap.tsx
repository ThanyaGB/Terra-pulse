import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAPBOX_TOKEN } from '@/api/client';
import type { PlumeResponse } from '@/api/contract';
import { getAqiBand, pm25ToAqi } from '@/lib/aqi';
import { pm25At } from '@/lib/plume';
import { prefersReducedMotion } from '@/hooks/useReducedMotion';
import { createPlumeLayer, type PlumeLayer, type Project } from './plumeLayer';

const BOUNDS = { minLng: 75.4, maxLng: 77.7, minLat: 28.3, maxLat: 30.85 };
const CITIES = [
  { name: 'Sangrur', lng: 75.8421, lat: 30.2458 },
  { name: 'Patiala', lng: 76.3869, lat: 30.3398 },
  { name: 'Ambala', lng: 76.7794, lat: 30.3782 },
  { name: 'Karnal', lng: 76.9905, lat: 29.6857 },
  { name: 'Panipat', lng: 76.9635, lat: 29.3909 },
  { name: 'Delhi', lng: 77.1025, lat: 28.7041 },
];

/** Equirectangular projection (cos-lat corrected) that fits the corridor inside w x h. */
function makeFallbackProject(w: number, h: number): Project {
  const lat0 = (BOUNDS.minLat + BOUNDS.maxLat) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const spanX = (BOUNDS.maxLng - BOUNDS.minLng) * kx;
  const spanY = BOUNDS.maxLat - BOUNDS.minLat;
  const scale = Math.min(w / spanX, h / spanY) * 0.94;
  const cx = (BOUNDS.minLng + BOUNDS.maxLng) / 2;
  return (lng, lat) => ({ x: w / 2 + (lng - cx) * kx * scale, y: h / 2 - (lat - lat0) * scale });
}

type MapboxMap = {
  project(l: [number, number]): { x: number; y: number };
  on(ev: string, fn: () => void): void;
  remove(): void;
  resize(): void;
};

interface Props {
  data: PlumeResponse;
  hour: number;
  selectedId: string;
  onSelect: (id: string) => void;
}

export function PlumeMap({ data, hour, selectedId, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<PlumeLayer | null>(null);
  const map = useRef<MapboxMap | null>(null);
  const [size, setSize] = useState({ w: 600, h: 340 });
  const [moveTick, setMoveTick] = useState(0);
  const [glFailed, setGlFailed] = useState(false);
  const [mapError, setMapError] = useState(false);
  const useMapbox = MAPBOX_TOKEN.length > 0 && !mapError;

  const project = useMemo<Project>(() => {
    void moveTick; // re-derive when the Mapbox viewport moves
    if (useMapbox && map.current) {
      const m = map.current;
      return (lng, lat) => m.project([lng, lat]);
    }
    return makeFallbackProject(size.w, size.h);
  }, [size, moveTick, useMapbox]);

  // track container size
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) });
      map.current?.resize();
    });
    ro.observe(el);
    setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  // optional Mapbox basemap (dynamic import keeps ~800 kB out of the other routes)
  useEffect(() => {
    if (!MAPBOX_TOKEN || !mapEl.current) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ default: mapboxgl }] = await Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')]);
        if (cancelled || !mapEl.current) return;
        mapboxgl.accessToken = MAPBOX_TOKEN;
        const m = new mapboxgl.Map({
          container: mapEl.current,
          style: 'mapbox://styles/mapbox/light-v11',
          bounds: [[BOUNDS.minLng, BOUNDS.minLat], [BOUNDS.maxLng, BOUNDS.maxLat]],
          fitBoundsOptions: { padding: 24 },
          attributionControl: true,
          cooperativeGestures: true,
        }) as unknown as MapboxMap;
        m.on('move', () => setMoveTick((n) => n + 1));
        m.on('load', () => setMoveTick((n) => n + 1));
        m.on('error', () => setMapError(true));
        map.current = m;
        setMoveTick((n) => n + 1);
      } catch {
        if (!cancelled) setMapError(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Three.js layer lifecycle
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    try {
      layer.current = createPlumeLayer(c, { corridor: data.corridor, hoursToReachNcr: data.hoursToReachNcr }, { animate: !prefersReducedMotion() });
    } catch {
      setGlFailed(true);
      return;
    }
    return () => {
      layer.current?.dispose();
      layer.current = null;
    };
  }, [data.corridor, data.hoursToReachNcr]);

  useEffect(() => { layer.current?.resize(size.w, size.h); }, [size]);
  useEffect(() => { layer.current?.setProject(project); }, [project]);
  useEffect(() => { layer.current?.setHour(hour); }, [hour]);

  const xy = useCallback((lng: number, lat: number) => project(lng, lat), [project]);
  const corridorPath = data.corridor.map(([lng, lat], i) => { const p = xy(lng, lat); return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(' ');

  return (
    <div ref={wrap} className="relative h-full min-h-[300px] w-full overflow-hidden rounded-2xl border border-line bg-map" data-testid="plume-map">
      <div ref={mapEl} className="absolute inset-0" aria-hidden={!useMapbox} />
      {!useMapbox && (
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
          <defs>
            <linearGradient id="vs-ground" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: 'var(--color-map)' }} /><stop offset="1" style={{ stopColor: 'var(--color-map-2)' }} /></linearGradient>
          </defs>
          <rect width={size.w} height={size.h} fill="url(#vs-ground)" />
          {[28.5, 29, 29.5, 30, 30.5].map((lat) => { const a = xy(BOUNDS.minLng, lat); const b = xy(BOUNDS.maxLng, lat); return <line key={lat} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: 'var(--color-gridline)' }} strokeWidth="1" strokeDasharray="2 5" />; })}
          {[75.5, 76, 76.5, 77, 77.5].map((lng) => { const a = xy(lng, BOUNDS.minLat); const b = xy(lng, BOUNDS.maxLat); return <line key={lng} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: 'var(--color-gridline)' }} strokeWidth="1" strokeDasharray="2 5" />; })}
        </svg>
      )}

      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />

      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${size.w} ${size.h}`} role="group" aria-label="Plume corridor map">
        <path d={corridorPath} fill="none" style={{ stroke: 'var(--color-corridor)' }} strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="5 5" />
        {data.sources.map((s) => {
          const p = xy(s.lng, s.lat);
          return (
            <g key={s.id}>
              <circle cx={p.x} cy={p.y} r={7} fill="#FF8A3D" stroke="#2A1300" strokeWidth="1.5" />
              <text x={p.x} y={p.y - 11} textAnchor="middle" fontSize="11" fontWeight="700" style={{ fill: 'var(--color-ink)' }}>{s.name.replace(' cluster', '')} · {s.fires} fires</text>
            </g>
          );
        })}
        {!useMapbox && CITIES.filter((c) => !data.sources.some((s) => s.name.startsWith(c.name))).map((c) => {
          const p = xy(c.lng, c.lat);
          return (
            <g key={c.name}>
              <circle cx={p.x} cy={p.y} r={3} style={{ fill: 'var(--color-ink-soft)' }} />
              <text x={p.x + 6} y={p.y + 4} fontSize="11" style={{ fill: 'var(--color-ink-soft)' }}>{c.name}</text>
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {data.streets.map((st) => {
          const p = xy(st.lng, st.lat);
          const pm = pm25At(st, hour);
          const band = getAqiBand(pm25ToAqi(pm));
          const on = st.id === selectedId;
          return (
            <button
              key={st.id}
              type="button"
              aria-label={`${st.name}, PM2.5 ${pm} micrograms per cubic metre`}
              aria-pressed={on}
              onClick={() => onSelect(st.id)}
              className="pointer-events-auto absolute flex h-8 w-8 items-center justify-center rounded-full border-2 bg-transparent p-0"
              style={{ left: p.x, top: p.y, transform: 'translate(-50%, -50%)', borderColor: on ? 'var(--color-ink)' : 'transparent' }}
            >
              <span className="block h-4 w-4 rounded-full border-2 border-white shadow" style={{ background: band.bg }} />
              {on && <span className="absolute -top-5 whitespace-nowrap rounded bg-dialog/95 px-1.5 text-xs font-bold text-ink shadow">{st.name}</span>}
            </button>
          );
        })}
      </div>

      {glFailed && (
        <div role="status" className="absolute right-3 top-3 max-w-[200px] rounded-xl bg-dialog/90 px-3 py-2 text-xs font-semibold text-warn-fg">
          Animated plume needs WebGL, which is unavailable here. Street arrival times below are unaffected.
        </div>
      )}
      <span className="tag absolute bottom-2 left-2 bg-dialog/90 text-ink-mute">{useMapbox ? 'Mapbox basemap' : 'Schematic basemap · set VITE_MAPBOX_TOKEN'}</span>
    </div>
  );
}
