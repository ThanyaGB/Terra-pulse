import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const STEPS = [
  { path: '/fpo', title: 'FPO console', body: 'Select a high-risk farmer, trigger a voice alert, assign a machine, and add a truck to watch eco-credits move.' },
  { path: '/farmer', title: 'Farmer call', body: 'Answer the call, press 1, 2 or 9 on the big keypad, then 1 to confirm or 0 to go back. Key 9 reaches an FPO worker.' },
  { path: '/citizen', title: 'Citizen app', body: 'Check AQI and the better window, plan a cleaner commute, and report smoke with a photo.' },
  { path: '/policy', title: 'CAQM dashboard', body: 'Pick a street, scrub the 72 h plume, then issue a directive (nothing is sent until you confirm). A GRAP-II order lights the citizen banner and sends work orders to the next step.' },
  { path: '/ops', title: 'Supervisor portal', body: 'The GRAP-II order from the CAQM dashboard arrived here as work orders. Accept one, then complete it with a photo and GPS (demo photo and location work too).' },
] as const;

/** Panel position and minimised state survive step changes and reloads. */
const UI_KEY = 'vayuswachh.tour.ui';
type Pos = { x: number; y: number };
type Ui = { pos: Pos | null; min: boolean };
const MARGIN = 8;
const NUDGE = 24;

function loadUi(): Ui {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Ui>;
      const pos = v.pos && Number.isFinite(v.pos.x) && Number.isFinite(v.pos.y) ? v.pos : null;
      return { pos, min: !!v.min };
    }
  } catch { /* storage blocked: fall back to defaults */ }
  return { pos: null, min: false };
}

function saveUi(ui: Ui) {
  try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* ignore */ }
}

function clampPos(p: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0;
  return {
    x: Math.min(Math.max(MARGIN, p.x), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: Math.min(Math.max(MARGIN, p.y), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  };
}

const GripIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    {[3, 7, 11].map((y) => [4, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}
  </svg>
);

/**
 * Judge demo mode: `?tour=1..5` shows a floating stepper over the five prototypes
 * (FPO → farmer call → citizen → CAQM → municipal). Drag it by its header, minimise it
 * to a pill so it never covers a dashboard, and double-click the header to dock it again.
 */
export function TourBar() {
  const { pathname, search } = useLocation();
  const nav = useNavigate();
  const q = new URLSearchParams(search).get('tour');
  const step = q ? Number(q) : 0;
  const active = step >= 1 && step <= STEPS.length;

  const [ui, setUi] = useState<Ui>(loadUi);
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);

  const update = useCallback((next: Partial<Ui>) => {
    setUi((cur) => { const v = { ...cur, ...next }; saveUi(v); return v; });
  }, []);

  // keep the panel on screen after a resize or after minimise/maximise changes its size
  useEffect(() => {
    if (!active || !ui.pos) return;
    const fit = () => {
      const c = clampPos(ui.pos as Pos, ref.current);
      if (c.x !== ui.pos?.x || c.y !== ui.pos?.y) update({ pos: c });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [active, ui.pos, ui.min, update]);

  if (!active) return null;
  const s = STEPS[step - 1];
  // Pages are lazy-loaded and router navigations run as transitions, so `step` can still be the
  // previous one while the next page loads. Read the live URL at click time so a quick second
  // click advances instead of repeating the same step.
  const go = (delta: number) => {
    const live = Number(new URLSearchParams(window.location.search).get('tour')) || step;
    const n = Math.min(STEPS.length, Math.max(1, live + delta));
    if (n !== live || !window.location.pathname.startsWith(STEPS[n - 1].path)) nav(`${STEPS[n - 1].path}?tour=${n}`);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, a')) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setUi((cur) => ({ ...cur, pos: clampPos({ x: e.clientX - d.dx, y: e.clientY - d.dy }, ref.current) }));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    setUi((cur) => { saveUi(cur); return cur; });
  };
  // keyboard: arrow keys move the panel, Home docks it back to the default spot
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] };
    if (e.key === 'Home') { e.preventDefault(); update({ pos: null }); return; }
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    update({ pos: clampPos({ x: r.left + m[0], y: r.top + m[1] }, ref.current) });
  };

  const placed = ui.pos
    ? { left: ui.pos.x, top: ui.pos.y }
    : undefined;
  const dock = ui.pos ? '' : ui.min ? 'bottom-3 right-3 sm:bottom-6 sm:right-6' : 'bottom-3 left-3 right-3 mx-auto sm:bottom-24';
  const handleProps = {
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
    onDoubleClick: () => update({ pos: null }),
    onKeyDown: onHandleKey,
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': 'Move the tour panel: drag, or use arrow keys. Home or double-click docks it.',
    style: { touchAction: 'none' as const },
  };

  if (ui.min) {
    return (
      <aside ref={ref} aria-label="Judge demo tour" style={placed} className={`fixed z-50 flex items-center gap-1 rounded-full bg-navy py-1 pl-1 pr-1 text-white shadow-2xl ${dock}`}>
        <div {...handleProps} className="flex cursor-grab items-center gap-2 rounded-full px-3 py-2 text-air-400 active:cursor-grabbing">
          <GripIcon />
          <span className="mono text-xs">TOUR {step}/{STEPS.length}</span>
        </div>
        <button type="button" className="btn !min-h-10 !bg-white/15 !px-3 !text-white" disabled={step === 1} onClick={() => go(-1)} aria-label="Previous tour step">‹</button>
        {step < STEPS.length
          ? <button type="button" className="btn btn-primary !min-h-10 !px-3" onClick={() => go(1)} aria-label="Next tour step">›</button>
          : <Link to="/" className="btn btn-primary !min-h-10 !px-3" aria-label="Finish the tour">✓</Link>}
        <button type="button" className="btn !min-h-10 !bg-white/15 !px-3 !text-white" onClick={() => update({ min: false })} aria-label="Expand the tour panel" title="Expand">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 5 V2 H5 M9 2 H12 V5 M12 9 V12 H9 M5 12 H2 V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </aside>
    );
  }

  return (
    <aside ref={ref} aria-label="Judge demo tour" style={placed} className={`fixed z-50 flex w-[calc(100vw-24px)] max-w-[640px] flex-col gap-2 rounded-3xl bg-navy p-3 text-white shadow-2xl ${dock}`}>
      <div className="flex items-center gap-2">
        <div {...handleProps} className="flex flex-1 cursor-grab items-center gap-2 rounded-xl py-1 text-air-400 active:cursor-grabbing">
          <GripIcon />
          <span className="mono text-xs">TOUR {step}/{STEPS.length}{pathname !== s.path ? ' Â· use Next to continue' : ''}</span>
        </div>
        <button type="button" className="btn !min-h-9 !bg-white/15 !px-3 !text-white" onClick={() => update({ min: true })} aria-label="Minimise the tour panel" title="Minimise">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 10 H11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[200px] flex-1 text-sm"><b>{s.title}.</b> {s.body}</div>
        <div className="flex gap-2">
          <button type="button" className="btn !min-h-10 !bg-white/15 !text-white" disabled={step === 1} onClick={() => go(-1)}>Back</button>
          {step < STEPS.length
            ? <button type="button" className="btn btn-primary !min-h-10" onClick={() => go(1)}>Next</button>
            : <Link to="/" className="btn btn-primary !min-h-10">Finish</Link>}
          <Link to={pathname} className="btn !min-h-10 !bg-white/15 !text-white">Exit</Link>
        </div>
      </div>
    </aside>
  );
}
