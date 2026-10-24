import { Fragment, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import '@fontsource/bebas-neue/400.css';
import './landing.css';
import { prefersReducedMotion } from '@/hooks/useReducedMotion';
import { tweenNumber } from '@/design/motion';
import { createAmbient, type Ambient } from './film/ambient';
import { SPR, STAGES, STAGE_P, buildSprites, buildTitle, dayAt, drawScene, fitView, makeView, mix, phaseOf, ramp, setSprites, type View } from './film/scene';
import { acts, arrows, caps, city, facts, fires, gaps, inventory, loop, nodes, plumes, s0, s1, s2, s3, s4, villages } from './content';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pad3 = (n: number) => ('00' + n).slice(-3);

/**
 * "Scroll story" landing page. A canvas film (one paddy season, clear sky → smoke → clear sky) is driven by scroll
 * position: the film section is 7200 px tall with a sticky stage, and `--p` (0..1) on the stage drives both the
 * canvas and the CSS caption overlays. All figures are simulated, as the footer says.
 */
export default function Landing() {
  const rootRef = useRef<HTMLElement>(null);
  const filmRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const filmCanvas = useRef<HTMLCanvasElement>(null);
  const lapseCanvas = useRef<HTMLCanvasElement>(null);
  const act4Canvas = useRef<HTMLCanvasElement>(null);
  const views = useRef<(View | null)[]>([]);
  const stageNow = useRef(0);
  const ambient = useRef<Ambient | null>(null);

  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [sound, setSound] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [k, setK] = useState(0);
  const [day, setDay] = useState(0);
  const [band, setBand] = useState(0);
  const [noCanvas, setNoCanvas] = useState(false);
  stageNow.current = stage;

  // scroll → --p, one requestAnimationFrame for all three canvases
  useEffect(() => {
    let raf = 0, lastP = -1, lapseP = STAGE_P[0], tier = 0, fpsT = 0, fpsN = 0, alive = true;
    try { if (!SPR) setSprites(buildSprites()); } catch { setSprites(null); }
    const vs = [makeView(filmCanvas.current, { fx: true, title: true }), makeView(lapseCanvas.current, { fixedPan: 1 }), makeView(act4Canvas.current, { fixedPan: 1 })];
    views.current = vs;
    if (!vs[0] || !SPR) setNoCanvas(true);
    const reduce = prefersReducedMotion();
    const fontP = document.fonts?.load ? document.fonts.load('400 120px "Bebas Neue"') : Promise.resolve([]);
    let fontReady = false;
    const onFont = () => { fontReady = true; const v = vs[0]; if (v && v.W) buildTitle(v); };
    fontP.then(onFont, onFont);
    let last = performance.now();
    const t0 = last;
    const tick = () => {
      const f = filmRef.current, s = stageRef.current;
      if (!f || !s) return;
      const r = f.getBoundingClientRect(), span = r.height - s.offsetHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
      if (Math.abs(p - lastP) < 0.0003) return;
      lastP = p; s.style.setProperty('--p', p.toFixed(4));
      setDay(dayAt(p)); setBand(Math.floor(p * 40));
    };
    const loopFn = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loopFn);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = (now - t0) / 1000;
      tick();
      if (!SPR) return;
      const ih = window.innerHeight;
      for (let i = 0; i < 3; i++) {
        const v = vs[i]; if (!v) continue;
        const r = v.cv.getBoundingClientRect(); if (r.bottom < 0 || r.top > ih || r.width < 2) continue;
        if (fitView(v, r, tier, now) && v.o.title && fontReady) buildTitle(v);
        if (!v.W) continue;
        const P = i === 0 ? Math.max(0, lastP) : (i === 1 ? (lapseP += (STAGE_P[stageNow.current] - lapseP) * Math.min(1, dt * 2.4)) : 0.43);
        v.reduce = reduce;
        drawScene(v, P, reduce ? 0 : t, dt);
        if (i === 0) { fpsT += dt; fpsN++; }
      }
      // adaptive quality: T0 (DPR 2) → T1 (DPR 1.5) → T2 (DPR 1, half particles, no sway)
      if (fpsT >= 2) { const fps = fpsN / fpsT; fpsT = 0; fpsN = 0; if (fps < 45 && tier < 2) tier++; }
    };
    raf = requestAnimationFrame(loopFn);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);

  // season time-lapse player (Act 2) auto-advances until the visitor takes over
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 3200);
    return () => clearInterval(id);
  }, [playing]);

  // reveal-on-scroll for headings and cards; headline counters start when Act 1 comes into view
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const els = root.querySelectorAll('.lp-reveal, .lp-word');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('lp-in')); setK(1); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('lp-in'); io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach((e) => io.observe(e));
    let stopCount = () => {};
    const act1 = root.querySelector('#act1');
    const io2 = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { stopCount = tweenNumber(0, 1, setK, 1.6); io2.disconnect(); }
    }, { threshold: 0.25 });
    if (act1) io2.observe(act1);
    return () => { io.disconnect(); io2.disconnect(); stopCount(); };
  }, []);

  useEffect(() => () => { ambient.current?.dispose(); }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const toggleMenu = () => setMenuOpen((o) => !o);
  const toggleSound = () => {
    if (!ambient.current) ambient.current = createAmbient();
    ambient.current.set(!sound); setSound(!sound);
  };
  const togglePlay = () => setPlaying((p) => !p);
  const onScrub = (ev: ChangeEvent<HTMLInputElement>) => { setStage(Number(ev.target.value)); setPlaying(false); };
  const onFilmMove = (e: MouseEvent<HTMLDivElement>) => {
    const v = views.current[0]; if (!v) return;
    const r = v.cv.getBoundingClientRect(); v.mx = e.clientX - r.left; v.my = e.clientY - r.top;
  };
  const onFilmLeave = () => { const v = views.current[0]; if (v) v.mx = null; };

  const st = STAGES[stage];
  const soundOff = !sound, paused = !playing;
  const soundLabel = sound ? 'Mute ambient sound' : 'Turn on ambient sound';
  const playLabel = playing ? 'Pause the time-lapse' : 'Play the time-lapse';
  const dayStr = pad3(day);
  const [, phaseName, phaseColor] = phaseOf(day, band / 40);
  const stages = STAGES.map((x, i) => {
    const on = i === stage, past = i < stage;
    return {
      day: x.day, short: x.short, on, aria: 'Jump to day ' + x.day + ', ' + x.name,
      bg: on ? '#0E8F62' : (past ? '#E3F8EE' : '#FFFFFF'), fg: on ? '#FFFFFF' : '#0B1D33', border: on ? '#0E8F62' : 'rgba(11,29,51,.14)',
      pick: () => { setStage(i); setPlaying(false); },
    };
  });
  const cells = Array.from({ length: 240 }, (_, i) => {
    const off = (((i * 37) % 17) / 17 - 0.5) * 0.28 + (((i * 11) % 7) / 7 - 0.5) * 0.1;
    return { bg: i === 113 ? '#FF8A3D' : ramp(st.m + off), cls: i === 113 ? 'lp-hot' : '' };
  });
  const lapseDay = pad3(st.day), stageName = st.name, stageNote = st.note;
  const lapseAria = 'Rendered rice field at the ' + st.name.toLowerCase() + ' stage, NDVI ' + st.ndvi.toFixed(2);
  const alertOn = stage >= 4, alertText = stage === 4 ? 'Burn-risk alert issued' : 'Residue decision now';
  const ndviStr = st.ndvi.toFixed(2);
  const daysLeft = 110 - st.day;
  const countStr = stage < 4 ? (daysLeft + ' d') : (stage === 4 ? '7–10 d' : 'Now');
  const countColor = stage >= 4 ? '#B45309' : '#0B1D33';
  const countNote = stage < 4 ? 'to forecast harvest. Monitoring only; no alert yet.' : (stage === 4 ? 'to harvest. Farmer called, Super Seeder held for this plot.' : 'Straw on the field. Bale it for Bio-CNG instead of burning.');
  const maturePct = Math.round(st.m * 100), matureEnd = mix('#34D399', '#FBBF24', Math.min(1, st.m * 1.2));
  const metrics = [
    { label: 'Fire points monitored', value: fmt(1284 * k), unit: '' },
    { label: 'Villages on early warning', value: fmt(2317 * k), unit: '' },
    { label: 'Downstream residents covered', value: (34.6 * k).toFixed(1), unit: ' M' },
  ];
  const firesObs = fmt(47 * k), firesPred = fmt(18 * k);

  return (
    <main id="main" ref={rootRef} className="lp" style={{ width: '100%', overflow: 'clip', background: '#F4FAFF' }}>
      {/* ===== Top glass navigation ===== */}
      <header style={{ position: 'sticky', top: '12px', zIndex: '50', padding: '0 16px', height: '0' }}>
        <nav className="lp-glass" aria-label="Primary" style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '8px 12px 8px 16px', borderRadius: '20px' }}>
          <a href="#top" aria-label="TerraPulse, back to top" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: '#0B1D33' }}>
            <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="19" fill="#DFF3FF"></circle>
              <path d="M11 28 C 11 16, 20 10, 30 10 C 30 21, 23 29, 11 28 Z" fill="none" stroke="#0E8F62" strokeWidth="2.4" strokeLinejoin="round"></path>
              <path d="M11 28 L 24 15" stroke="#0E8F62" strokeWidth="2" strokeLinecap="round"></path>
              <path d="M6 16 H 15 M 8 21 H 13" stroke="#4FB3FF" strokeWidth="2" strokeLinecap="round"></path>
            </svg>
            <span className="lp-pop" style={{ fontSize: '18px' }}>TerraPulse</span>
          </a>
          <div style={{ display: 'flex', gap: '2px', margin: '0 auto', flexWrap: 'wrap' }}>
            {acts.map((a, _i) => (<Fragment key={_i}>
              <a className="lp-dotlink" href={a.href} aria-label={a.aria}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: a.color }}></span>
                <span>{a.label}</span>
              </a>
            </Fragment>))}
          </div>
          <div style={{ position: 'relative' }}>
            <button className="lp-btn lp-btn-w" style={{ minHeight: '40px', padding: '0 14px' }} onClick={toggleMenu} aria-expanded={menuOpen} aria-label="System prototypes menu">
              System prototypes
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"></path></svg>
            </button>
            {menuOpen && (<>
              <div className="lp-glass lp-menu" style={{ position: 'absolute', right: '0', top: '48px', width: '280px', padding: '8px', borderRadius: '16px', background: 'rgba(255,255,255,.92)' }}>
                <Link to="/policy"><b className="lp-mono" style={{ color: '#0F6FB8' }}>D1</b>  CAQM decision dashboard</Link>
                <Link to="/fpo"><b className="lp-mono" style={{ color: '#0F6FB8' }}>D2</b>  FPO dispatch console</Link>
                <Link to="/farmer"><b className="lp-mono" style={{ color: '#0F6FB8' }}>D3</b>  Farmer voice-call simulator</Link>
                <Link to="/citizen"><b className="lp-mono" style={{ color: '#0F6FB8' }}>D4</b>  Citizen &amp; sensitive-groups app</Link>
              </div>
            </>)}
          </div>
          <button className="lp-btn lp-btn-w" style={{ minHeight: '40px', width: '44px', padding: '0', justifyContent: 'center' }} onClick={toggleSound} aria-pressed={sound} aria-label={soundLabel}>
            <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
              <path d="M2 6 H6 L11 2 V16 L6 12 H2 Z" fill="#0B1D33"></path>
              {sound && (<>
                <rect className="lp-sbar" x="14" y="5" width="2" height="8" rx="1" fill="#0E8F62"></rect>
                <rect className="lp-sbar" x="18" y="3" width="2" height="12" rx="1" fill="#0E8F62" style={{ animationDelay: '300ms' }}></rect>
              </>)}
              {soundOff && (<>
                <path d="M14 6 L20 12 M20 6 L14 12" stroke="#0B1D33" strokeWidth="1.6" strokeLinecap="round"></path>
              </>)}
            </svg>
          </button>
          <Link className="lp-btn lp-btn-g" to="/policy?tour=1" style={{ minHeight: '40px' }} aria-label="Start judge demo mode, a guided tour of the four prototypes">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2 L12 7 L3 12 Z" fill="#fff"></path></svg>
            Judge demo mode
          </Link>
        </nav>
      </header>

      {/* ===== Opening film: a procedural scene painted on canvas, driven by scroll ===== */}
      <section id="top" ref={filmRef} aria-label="Opening film: one paddy season, from clear sky to smoke" style={{ position: 'relative', height: '7200px', background: '#0B1D33' }}>
        <div className="lp-stage" ref={stageRef} onMouseMove={onFilmMove} onMouseLeave={onFilmLeave} style={{ position: 'sticky', top: '0', height: 'min(100vh, 1000px)', overflow: 'hidden', background: 'linear-gradient(180deg, #2F86D6 0%, #8FD3FF 62%, #DFF3FF 100%)' }}>
          <canvas ref={filmCanvas} aria-hidden="true" style={{ position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' }}></canvas>

          {/* cinematic grade: letterbox gradients, vignette, film grain */}
          <div className="lp-fill lp-lb" aria-hidden="true" style={{ pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(5,12,22,.5) 0%, transparent 20%, transparent 58%, rgba(5,12,22,.78) 100%)' }}></div>
          <div className="lp-fill" aria-hidden="true" style={{ pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 45%, transparent 58%, rgba(5,12,22,.42) 100%)' }}></div>
          <svg className="lp-fill" aria-hidden="true" style={{ width: '100%', height: '100%', pointerEvents: 'none', opacity: '.08', mixBlendMode: 'overlay' }}>
            <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"></feTurbulence></filter>
            <rect width="100%" height="100%" filter="url(#grain)"></rect>
          </svg>

          {/* HUD: season clock */}
          <div className="lp-win" style={{ '--a': '.2', '--b': '.885', '--k': '20', position: 'absolute', top: '104px', left: '0', right: '0', padding: '0 32px', pointerEvents: 'none' } as CSSProperties}>
            <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap' }}>
              <div style={{ color: '#FFFFFF', textShadow: '0 2px 20px rgba(0,0,0,.35)' }}>
                <div className="lp-eyebrow" style={{ fontSize: '11px', color: '#DFF3FF' }}>Season 2026 · Sangrur, Punjab · plot PB-SGR-1142</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginTop: '6px' }}>
                  <span className="lp-mono" style={{ fontSize: '56px', fontWeight: '700', lineHeight: '1' }}>DAY {dayStr}</span>
                  <span className="lp-pop" style={{ fontSize: '20px', color: phaseColor }}>{phaseName}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', pointerEvents: 'auto' }}>
                <span className="lp-tag" style={{ color: '#FFFFFF', background: 'rgba(11,29,51,.35)' }}>Simulated reconstruction</span>
                <a href="#problem" className="lp-btn lp-btn-o" style={{ minHeight: '36px', padding: '0 14px', fontSize: '12px' }}>Skip intro</a>
              </div>
            </div>
            <div style={{ maxWidth: '1240px', margin: '18px auto 0' }}>
              <div style={{ height: '3px', borderRadius: '999px', background: 'rgba(255,255,255,.22)', overflow: 'hidden' }}>
                <div className="lp-track" style={{ height: '100%', background: 'linear-gradient(90deg, #34D399, #10B981 35%, #FBBF24 60%, #FF8A3D 82%, #A8977F)' }}></div>
              </div>
              <div className="lp-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', letterSpacing: '.1em', color: 'rgba(255,255,255,.78)', marginTop: '8px' }}>
                <span>TRANSPLANT</span><span>TILLER</span><span>PEAK</span><span>RIPE</span><span>HARVEST</span><span>FIRE</span><span>SMOKE</span>
              </div>
            </div>
          </div>

          {/* chapter captions */}
          <div className="lp-cap lp-scrim" aria-hidden="true" style={{ '--a': '-1', '--b': '.89', position: 'absolute', left: '0', right: '0', bottom: '0', height: '58%', pointerEvents: 'none' } as CSSProperties}></div>
          <div style={{ position: 'absolute', left: '0', right: '0', bottom: '56px', padding: '0 32px', pointerEvents: 'none' }}>
            <div style={{ maxWidth: '1240px', margin: '0 auto', position: 'relative', height: '240px' }}>
              {caps.map((c, _i) => (<Fragment key={_i}>
                <div className="lp-cap" style={{ '--a': c.a, '--b': c.b, position: 'absolute', left: '0', bottom: '0', maxWidth: '900px', color: '#FFFFFF' } as CSSProperties}>
                  <div className="lp-eyebrow" style={{ color: c.ec, marginBottom: '12px' }}>{c.eyebrow}</div>
                  <div className="lp-pop" style={{ fontSize: 'clamp(32px, 4.6vw, 66px)', lineHeight: '1.05', textShadow: '0 2px 4px rgba(0,0,0,.35), 0 6px 40px rgba(0,0,0,.55)' }}>{c.title}</div>
                  <div style={{ fontSize: '18px', color: '#E6F1FB', marginTop: '12px', maxWidth: '560px', fontWeight: 500, textShadow: '0 1px 3px rgba(0,0,0,.6), 0 2px 16px rgba(0,0,0,.6)' }}>{c.body}</div>
                </div>
              </Fragment>))}
            </div>
          </div>

          {/* scroll hint */}
          <div className="lp-hint" aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '46%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: '#FFFFFF', pointerEvents: 'none' }}>
            <span className="lp-eyebrow" style={{ fontSize: '11px', textShadow: '0 2px 12px rgba(0,0,0,.4)' }}>Scroll to ride one paddy season</span>
            <svg width="20" height="30" viewBox="0 0 20 30" style={{ animation: 'lp-bob 2s ease-in-out infinite' }}><rect x="1" y="1" width="18" height="28" rx="9" fill="none" stroke="#FFFFFF" strokeWidth="1.5"></rect><circle cx="10" cy="9" r="2.5" fill="#FFFFFF"></circle></svg>
          </div>

          {/* the air clears → particle title (drawn on canvas) + subtitle */}
          <h1 className="lp-sr">TerraPulse.</h1>
          <div className="lp-cap lp-ftitle" style={{ '--a': '.925', '--b': '3', position: 'absolute', left: '0', right: '0', display: 'flex', justifyContent: 'center', pointerEvents: 'none' } as CSSProperties}>
            <span className="lp-glass lp-eyebrow" style={{ padding: '8px 14px', borderRadius: '999px', background: 'rgba(255,255,255,.72)' }}>Multi-agent · orchestrated by IBM Bob</span>
          </div>
          {noCanvas && (<>
            <div className="lp-cap" aria-hidden="true" style={{ '--a': '.9', '--b': '3', position: 'absolute', left: '0', right: '0', top: '22%', textAlign: 'center' } as CSSProperties}>
              <div className="lp-disp" style={{ fontSize: 'clamp(92px, 15vw, 232px)', lineHeight: '.84', color: '#0B2D50', textShadow: '0 6px 30px rgba(255,255,255,.7)' }}>TERRA.<br />PULSE.</div>
            </div>
          </>)}
          <div className="lp-cap lp-fsub" style={{ '--a': '.945', '--b': '3', position: 'absolute', left: '16px', right: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px', textAlign: 'center' } as CSSProperties}>
            <p className="lp-pop" style={{ margin: '0', fontSize: 'clamp(22px, 2.6vw, 34px)', color: '#0B1D33' }}>Catch the fire before it starts.</p>
            <a href="#problem" className="lp-btn lp-btn-g">See the problem</a>
          </div>
        </div>
      </section>

      {/* ===== The problem ===== */}
      <section id="problem" style={{ position: 'relative', padding: '120px 16px 104px', background: 'linear-gradient(180deg, #F4FAFF 0%, #FFFFFF 100%)' }}>
        <div style={{ maxWidth: '1240px', margin: '0 auto' }}>
          <p className="lp-eyebrow" style={{ margin: '0 0 16px', color: '#B45309' }}>The problem</p>
          <h2 className="lp-pop" style={{ margin: '0 0 24px', fontSize: 'clamp(40px, 5.6vw, 72px)', lineHeight: '1.02', maxWidth: '1040px' }}>
            {s0.map((w, _i) => (<Fragment key={_i}><span className="lp-word" style={{ animationDelay: `${w.d}ms` }}>{w.t}</span></Fragment>))}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '48px', marginBottom: '56px' }}>
            <p className="lp-reveal" style={{ flex: '1 1 420px', margin: '0', fontSize: '19px', color: '#23405E' }}>After the paddy harvest in Punjab and Haryana, farmers have only a short window to clear the straw and sow wheat. Machines cost money and are booked out at the peak. A match is free and clears a field in an afternoon.</p>
            <p className="lp-reveal" style={{ flex: '1 1 420px', margin: '0', fontSize: '19px', color: '#23405E' }}>The smoke rides north-west winds across the plains. A low winter inversion traps it over Delhi-NCR, where it adds to traffic and dust. By the time city-wide AQI turns red, the fires that caused it are already ash.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '72px' }}>
            {facts.map((f, _i) => (<Fragment key={_i}>
              <div className="lp-card lp-reveal" style={{ padding: '28px', background: f.bg, color: f.fg }}>
                <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px 12px' }}><span className="lp-mono" style={{ fontSize: '56px', fontWeight: '700', lineHeight: '1' }}>{f.v}</span><span style={{ fontSize: '20px', fontWeight: '700' }}>{f.unit}</span></div>
                <div style={{ fontSize: '16px', fontWeight: '600', marginTop: '12px' }}>{f.label}</div>
                <div style={{ fontSize: '12px', marginTop: '8px', opacity: '.8' }}>{f.note}</div>
              </div>
            </Fragment>))}
          </div>
          <p className="lp-eyebrow" style={{ margin: '0 0 20px', color: '#0F6FB8' }}>Four gaps we close</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            {gaps.map((g, _i) => (<Fragment key={_i}>
              <div className="lp-card lp-glass lp-reveal" style={{ padding: '24px', background: '#FFFFFF' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <span className="lp-mono" style={{ width: '32px', height: '32px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '13px', background: '#FFF1E6', color: '#8A4B0F' }}>{g.n}</span>
                  <h3 className="lp-pop" style={{ margin: '0', fontSize: '19px' }}>{g.title}</h3>
                </div>
                <p style={{ margin: '0 0 14px', fontSize: '14px', color: '#3B526B' }}><b style={{ color: '#8A4B0F' }}>Today:</b> {g.today}</p>
                <p style={{ margin: '0', fontSize: '14px', color: '#23405E' }}><b style={{ color: '#0B7A53' }}>TerraPulse:</b> {g.fix}</p>
              </div>
            </Fragment>))}
          </div>
        </div>
      </section>

      {/* ===== Closed loop constellation ===== */}
      <section id="loop" style={{ padding: '40px 16px 104px', background: '#FFFFFF' }}>
        <div style={{ maxWidth: '1240px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '24px', flexWrap: 'wrap', marginBottom: '32px' }}>
            <div>
              <p className="lp-eyebrow" style={{ margin: '0 0 12px', color: '#0F6FB8' }}>The closed loop</p>
              <h2 className="lp-pop lp-reveal" style={{ margin: '0', fontSize: 'clamp(28px, 3.4vw, 44px)', lineHeight: '1.1', maxWidth: '720px' }}>Five agents. One season. From the field to the lungs.</h2>
            </div>
            <span className="lp-tag" style={{ color: '#4A6380' }}>Agent pipeline · simulated</span>
          </div>
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {loop.map((n, _i) => (<Fragment key={_i}>
              <div className="lp-card lp-glass lp-reveal" style={{ padding: '24px', background: '#F7FBFF' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
                    <circle className="lp-breathe" cx="26" cy="26" r="22" fill={n.color} style={{ animationDelay: `${n.d}ms` }}></circle>
                    <circle cx="26" cy="26" r="15" fill={n.color}></circle>
                    <text x="26" y="31" textAnchor="middle" fill="#FFFFFF" fontFamily="JetBrains Mono, monospace" fontWeight="700" fontSize="14">{n.num}</text>
                  </svg>
                  <span className="lp-mono" style={{ fontSize: '12px', color: '#4A6380' }}>{n.agent}</span>
                </div>
                <h3 className="lp-pop" style={{ margin: '0 0 8px', fontSize: '20px', lineHeight: '1.2' }}>{n.title}</h3>
                <p style={{ margin: '0', fontSize: '14px', color: '#3B526B' }}>{n.body}</p>
              </div>
            </Fragment>))}
          </div>
        </div>
      </section>

      {/* ===== Act 1: high-altitude monitoring ===== */}
      <section id="act1" style={{ position: 'relative', padding: '120px 16px', background: 'linear-gradient(180deg, #FFFFFF 0%, #DFF3FF 45%, #8FD3FF 100%)', overflow: 'hidden' }}>
        <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: '48px', alignItems: 'center' }}>
          <div style={{ flex: '999 1 520px', minWidth: '0' }}>
            <p className="lp-eyebrow" style={{ margin: '0 0 16px', color: '#0F6FB8' }}>01 — High-altitude watch</p>
            <h2 className="lp-pop" style={{ margin: '0 0 24px', fontSize: 'clamp(40px, 5.6vw, 72px)', lineHeight: '1.02' }}>
              {s1.map((w, _i) => (<Fragment key={_i}><span className="lp-word" style={{ animationDelay: `${w.d}ms` }}>{w.t}</span></Fragment>))}
            </h2>
            <p className="lp-reveal" style={{ margin: '0 0 32px', fontSize: '18px', maxWidth: '560px', color: '#23405E' }}>Satellite thermal passes, 40 ground stations and wind fields stream into one picture. Every fire point has a field, a village and a downwind street attached to it.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '32px' }}>
              {metrics.map((m, _i) => (<Fragment key={_i}>
                <div className="lp-card lp-glass lp-reveal" style={{ padding: '20px 20px 18px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#3B526B', marginBottom: '12px' }}>{m.label}</div>
                  <div className="lp-mono" style={{ fontSize: '36px', fontWeight: '700', lineHeight: '1', color: '#0B1D33' }}>{m.value}<span style={{ fontSize: '18px', color: '#4A6380' }}>{m.unit}</span></div>
                  <span className="lp-tag" style={{ marginTop: '12px', color: '#4A6380' }}>Demo data</span>
                </div>
              </Fragment>))}
            </div>
            <Link className="lp-btn lp-btn-g" to="/policy" aria-label="Open the CAQM decision dashboard prototype">
              Open CAQM decision dashboard
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7 H11 M7 3 L11 7 L7 11" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"></path></svg>
            </Link>
          </div>
          <div style={{ flex: '1 1 420px', minWidth: '0', display: 'flex', justifyContent: 'center' }}>
            <svg viewBox="0 0 520 560" role="img" aria-label="A satellite orbits the Earth, sweeping a scan cone over farmland that is linked by a glowing network to stations and cities" style={{ width: '100%', maxWidth: '520px', height: 'auto' }}>
              <defs>
                <radialGradient id="earth" cx="50%" cy="20%" r="80%"><stop offset="0%" stopColor="#8FD3FF"></stop><stop offset="100%" stopColor="#0F6FB8"></stop></radialGradient>
                <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFFFFF" stopOpacity=".7"></stop><stop offset="100%" stopColor="#FFFFFF" stopOpacity="0"></stop></linearGradient>
                <filter id="glow"><feGaussianBlur stdDeviation="3"></feGaussianBlur></filter>
              </defs>
              <ellipse cx="260" cy="300" rx="230" ry="230" fill="none" stroke="#FFFFFF" strokeOpacity=".7" strokeDasharray="3 7"></ellipse>
              <circle cx="260" cy="300" r="150" fill="url(#earth)"></circle>
              <path d="M150 250 L200 236 L232 260 L214 300 L170 296 Z" fill="#34D399" opacity=".7"></path>
              <path d="M250 330 L300 320 L330 352 L292 380 L256 366 Z" fill="#34D399" opacity=".55"></path>
              <path d="M300 230 L340 240 L352 276 L320 280 Z" fill="#10B981" opacity=".55"></path>
              <g stroke="#FFFFFF" strokeWidth="1.4" strokeOpacity=".9" fill="none">
                <path className="lp-flow" d="M190 268 L276 348 L326 258 L190 268"></path>
                <path className="lp-flow" d="M276 348 L360 380"></path>
              </g>
              {nodes.map((n, _i) => (<Fragment key={_i}>
                <circle className="lp-breathe" cx={n.x} cy={n.y} r="12" fill={n.c} style={{ animationDelay: `${n.d}ms` }}></circle>
                <circle cx={n.x} cy={n.y} r="5" fill={n.c} stroke="#FFFFFF" strokeWidth="2"></circle>
              </Fragment>))}
              <g className="lp-spin">
                <path d="M260 66 L214 230 L306 230 Z" fill="url(#cone)"></path>
                <g transform="translate(260 66)">
                  <rect x="-34" y="-7" width="24" height="14" rx="2" fill="#0F2A47"></rect>
                  <rect x="10" y="-7" width="24" height="14" rx="2" fill="#0F2A47"></rect>
                  <path d="M-32 -7 V7 M-26 -7 V7 M-20 -7 V7 M-14 -7 V7 M12 -7 V7 M18 -7 V7 M24 -7 V7 M30 -7 V7" stroke="#4FB3FF" strokeWidth="1"></path>
                  <rect x="-9" y="-11" width="18" height="22" rx="4" fill="#FFFFFF" stroke="#0F2A47" strokeWidth="2"></rect>
                  <circle cx="0" cy="13" r="3" fill="#FF8A3D" filter="url(#glow)"></circle>
                </g>
              </g>
            </svg>
          </div>
        </div>
      </section>

      {/* ===== Act 2: field early warning + interactive season player (same renderer) ===== */}
      <section id="act2" style={{ position: 'relative', padding: '120px 16px', background: 'linear-gradient(180deg, #8FD3FF 0%, #EAF7F0 18%, #F4FAFF 100%)' }}>
        <div style={{ maxWidth: '1240px', margin: '0 auto' }}>
          <p className="lp-eyebrow" style={{ margin: '0 0 16px', color: '#0B7A53' }}>02 — Field early warning</p>
          <h2 className="lp-pop" style={{ margin: '0 0 16px', fontSize: 'clamp(40px, 5.6vw, 72px)', lineHeight: '1.02', maxWidth: '980px' }}>
            {s2.map((w, _i) => (<Fragment key={_i}><span className="lp-word" style={{ animationDelay: `${w.d}ms` }}>{w.t}</span></Fragment>))}
          </h2>
          <p className="lp-reveal" style={{ margin: '0 0 48px', fontSize: '18px', maxWidth: '640px', color: '#23405E' }}>The same season, as the forecast agent sees it. Scrub through the stages: greenness (NDVI) rises and falls, and a booking window opens before a single match is struck.</p>

          <div className="lp-reveal" style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'stretch' }}>
            <div style={{ flex: '999 1 640px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ position: 'relative', aspectRatio: '16 / 10', borderRadius: '28px', overflow: 'hidden', background: 'linear-gradient(180deg, #2F86D6, #DFF3FF 45%, #0E5E40 46%)', boxShadow: '0 30px 80px rgba(15,42,71,.25)' }}>
                <canvas ref={lapseCanvas} role="img" aria-label={lapseAria} style={{ position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' }}></canvas>
                <div aria-hidden="true" style={{ position: 'absolute', inset: '0', background: 'linear-gradient(180deg, rgba(11,29,51,.4) 0%, transparent 28%, transparent 62%, rgba(11,29,51,.55) 100%)' }}></div>
                <div style={{ position: 'absolute', top: '16px', left: '16px', right: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                  <div className="lp-glass" style={{ padding: '12px 16px', borderRadius: '20px', background: 'rgba(255,255,255,.78)' }}>
                    <div className="lp-eyebrow" style={{ fontSize: '11px', color: '#3B526B' }}>Day</div>
                    <div className="lp-mono" style={{ fontSize: '44px', fontWeight: '700', lineHeight: '1' }}>{lapseDay}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                    <span className="lp-tag" style={{ color: '#FFFFFF', background: 'rgba(11,29,51,.4)' }}>Simulated time-lapse</span>
                    {alertOn && (<>
                      <span className="lp-chip" style={{ background: '#FF8A3D', color: '#2A1300' }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="#2A1300"></circle></svg>
                        {alertText}
                      </span>
                    </>)}
                  </div>
                </div>
                <div style={{ position: 'absolute', left: '16px', bottom: '16px', right: '16px' }}>
                  <div className="lp-pop" style={{ fontSize: 'clamp(24px, 3vw, 40px)', color: '#FFFFFF', lineHeight: '1.05', textShadow: '0 4px 20px rgba(0,0,0,.4)' }}>{stageName}</div>
                  <div style={{ color: '#E6F3FF', fontSize: '15px', maxWidth: '520px', marginTop: '4px', textShadow: '0 2px 12px rgba(0,0,0,.4)' }}>{stageNote}</div>
                </div>
              </div>

              <div className="lp-glass" style={{ padding: '16px', borderRadius: '24px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', background: 'rgba(255,255,255,.82)' }}>
                <button className="lp-btn lp-btn-g" style={{ width: '48px', padding: '0', justifyContent: 'center' }} onClick={togglePlay} aria-label={playLabel}>
                  {playing && (<>
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="3.5" height="10" rx="1" fill="#fff"></rect><rect x="8.5" y="2" width="3.5" height="10" rx="1" fill="#fff"></rect></svg>
                  </>)}
                  {paused && (<>
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2 L12 7 L3 12 Z" fill="#fff"></path></svg>
                  </>)}
                </button>
                <div style={{ flex: '1 1 360px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label htmlFor="lapse" style={{ fontSize: '12px', fontWeight: '600', color: '#3B526B' }}>Scrub the season — transplanting to harvest</label>
                  <input id="lapse" type="range" min="0" max="5" step="1" value={stage} onChange={onScrub} style={{ width: '100%' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '4px' }}>
                    {stages.map((s, _i) => (<Fragment key={_i}>
                      <button className="lp-stagebtn" onClick={s.pick} aria-label={s.aria} aria-pressed={s.on} style={{ border: `1px solid ${s.border}`, background: s.bg, color: s.fg, borderRadius: '12px', padding: '8px 4px', font: '600 11px/1.2 Inter, sans-serif', cursor: 'pointer', minHeight: '44px' }}>
                        <span className="lp-mono" style={{ display: 'block', fontSize: '10px', opacity: '.8' }}>D{s.day}</span>{s.short}
                      </button>
                    </Fragment>))}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ flex: '1 1 320px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="lp-card lp-glass" style={{ padding: '24px', background: 'rgba(255,255,255,.85)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
                  <h3 className="lp-pop" style={{ margin: '0', fontSize: '20px' }}>Harvest countdown</h3>
                  <span className="lp-tag" style={{ color: '#8A4B0F' }}>Estimate</span>
                </div>
                <div className="lp-mono" style={{ fontSize: '56px', fontWeight: '700', lineHeight: '1', color: countColor }}>{countStr}</div>
                <p style={{ margin: '8px 0 20px', fontSize: '14px', color: '#3B526B' }}>{countNote}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '600', color: '#3B526B', marginBottom: '6px' }}>
                  <span>NDVI maturity</span><span className="lp-mono">{ndviStr}</span>
                </div>
                <div style={{ height: '12px', borderRadius: '999px', background: '#E3EEF5', overflow: 'hidden' }}>
                  <div className="lp-bar" style={{ height: '100%', width: `${maturePct}%`, borderRadius: '999px', background: `linear-gradient(90deg, #34D399, ${matureEnd})` }}></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#4A6380', marginTop: '6px' }} className="lp-mono"><span>Transplant</span><span>Peak green</span><span>Ripe</span></div>
              </div>

              <div className="lp-card lp-glass" style={{ padding: '24px', background: 'rgba(255,255,255,.85)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
                  <h3 className="lp-pop" style={{ margin: '0', fontSize: '20px' }}>Satellite NDVI mosaic</h3>
                  <span className="lp-tag" style={{ color: '#4A6380' }}>Simulated</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(20, minmax(0, 1fr))', gap: '2px', borderRadius: '12px', overflow: 'hidden' }} role="img" aria-label="A 20 by 12 grid of farm plots coloured by greenness; one high-risk plot is highlighted">
                  {cells.map((c, _i) => (<Fragment key={_i}>
                    <div className={`lp-cell ${c.cls}`} style={{ aspectRatio: '1', background: c.bg, borderRadius: '2px' }}></div>
                  </Fragment>))}
                </div>
                <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#3B526B' }}>Highlighted plot <b className="lp-mono">PB-SGR-1142</b> · fire-risk index <b className="lp-mono" style={{ color: '#B45309' }}>92</b> <span className="lp-tag" style={{ color: '#8A4B0F' }}>Estimate</span></p>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginTop: '24px' }}>
            <div className="lp-card lp-glass lp-reveal" style={{ padding: '24px', background: 'rgba(255,255,255,.85)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
                <h3 className="lp-pop" style={{ margin: '0', fontSize: '20px' }}>Village risk ranking</h3>
                <span className="lp-tag" style={{ color: '#4A6380' }}>Demo data</span>
              </div>
              {villages.map((v, _i) => (<Fragment key={_i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderTop: '1px solid rgba(11,29,51,.08)' }}>
                  <span className="lp-mono" style={{ width: '36px', fontWeight: '700', fontSize: '18px', color: v.rc }}>{v.risk}</span>
                  <div style={{ flex: '1', minWidth: '0' }}>
                    <div style={{ fontWeight: '600' }}>{v.name}</div>
                    <div style={{ fontSize: '12px', color: '#4A6380' }}>Sangrur district · {v.acres} acres</div>
                  </div>
                  <span className="lp-chip" style={{ background: v.sbg, color: v.sfg }}>{v.status}</span>
                </div>
              </Fragment>))}
            </div>
            <div className="lp-card lp-glass lp-reveal" style={{ padding: '24px', background: 'rgba(255,255,255,.85)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
                <h3 className="lp-pop" style={{ margin: '0', fontSize: '20px' }}>Machinery on hand</h3>
                <span className="lp-tag" style={{ color: '#4A6380' }}>Demo data</span>
              </div>
              {inventory.map((i, _i) => (<Fragment key={_i}>
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '6px' }}><span style={{ fontWeight: '600' }}>{i.name}</span><span className="lp-mono">{i.n} / {i.max}</span></div>
                  <div style={{ height: '10px', borderRadius: '999px', background: '#E3EEF5', overflow: 'hidden' }}><div style={{ height: '100%', width: `${i.pct}%`, background: '#10B981', borderRadius: '999px' }}></div></div>
                </div>
              </Fragment>))}
              <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#3B526B' }}>Reference rate <b className="lp-mono">₹750</b>/acre <span className="lp-tag" style={{ color: '#4A6380' }}>Demo rate</span></p>
            </div>
            <div className="lp-card lp-reveal" style={{ padding: '24px', background: '#0F2A47', color: '#F4FAFF', display: 'flex', flexDirection: 'column', gap: '16px', justifyContent: 'space-between' }}>
              <div>
                <h3 className="lp-pop" style={{ margin: '0 0 8px', fontSize: '20px' }}>Act before the match</h3>
                <p style={{ margin: '0', color: '#C9DDF0', fontSize: '15px' }}>Dispatch a Super Seeder or call the farmer in Punjabi, Hindi or English — directly from the risk list.</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Link className="lp-btn lp-btn-g" to="/fpo" style={{ justifyContent: 'center' }}>Open FPO dispatch console</Link>
                <Link className="lp-btn lp-btn-o" to="/farmer" style={{ justifyContent: 'center' }}>Hear the farmer call</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Act 3: fire points & smoke plume (dark) ===== */}
      <section id="act3" style={{ position: 'relative', padding: '140px 16px 120px', background: '#0B1D33', color: '#F4FAFF', overflow: 'hidden' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: '0', background: 'radial-gradient(ellipse 60% 40% at 18% 22%, rgba(255,138,61,.22), transparent 70%), radial-gradient(ellipse 50% 35% at 75% 8%, rgba(180,83,9,.2), transparent 70%), radial-gradient(ellipse 80% 50% at 50% 40%, rgba(120,104,86,.25), transparent 70%), linear-gradient(180deg, #F4FAFF 0%, #16294A 7%, #0B1D33 45%)' }}></div>
        <div style={{ position: 'relative', maxWidth: '1240px', margin: '0 auto' }}>
          <p className="lp-eyebrow" style={{ margin: '0 0 16px', color: '#FFB27D' }}>03 — Fire points &amp; smoke plume</p>
          <h2 className="lp-pop" style={{ margin: '0 0 16px', fontSize: 'clamp(40px, 5.6vw, 72px)', lineHeight: '1.02', maxWidth: '1000px' }}>
            {s3.map((w, _i) => (<Fragment key={_i}><span className="lp-word" style={{ animationDelay: `${w.d}ms` }}>{w.t}</span></Fragment>))}
          </h2>
          <p className="lp-reveal" style={{ margin: '0 0 48px', fontSize: '18px', maxWidth: '620px', color: '#C9DDF0' }}>When a fire is lit anyway, the satellite locks the plot, the wind field carries the plume south-east, and Delhi's streets get hours of warning instead of minutes.</p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
            <div className="lp-glass-d lp-reveal" style={{ flex: '999 1 640px', minWidth: '0', borderRadius: '28px', padding: '16px', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', padding: '8px 8px 0' }}>
                <span className="lp-mono" style={{ fontSize: '12px', color: '#8FD3FF' }}>Punjab → Haryana → Delhi-NCR</span>
                <span className="lp-tag" style={{ color: '#8FD3FF' }}>Schematic, not a real basemap</span>
              </div>
              <svg viewBox="0 0 800 470" role="img" aria-label="Schematic map: fire points in Punjab to the north-west, a smoke plume drifting south-east along the wind toward Delhi, arriving in an estimated 9 to 13 hours" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <filter id="smoke"><feGaussianBlur stdDeviation="14"></feGaussianBlur></filter>
                  <filter id="fglow"><feGaussianBlur stdDeviation="4"></feGaussianBlur></filter>
                  <linearGradient id="fan" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#FF8A3D" stopOpacity=".28"></stop><stop offset="100%" stopColor="#FF8A3D" stopOpacity=".04"></stop></linearGradient>
                  <marker id="arw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#8FD3FF"></path></marker>
                </defs>
                <path d="M40 60 L250 40 L310 120 L290 230 L170 260 L60 200 Z" fill="#12355A" stroke="#2C5A86" strokeWidth="1.5"></path>
                <path d="M290 230 L310 120 L470 150 L560 260 L500 360 L330 340 Z" fill="#103050" stroke="#2C5A86" strokeWidth="1.5"></path>
                <circle cx="640" cy="372" r="44" fill="#0E2B48" stroke="#2C5A86" strokeWidth="1.5"></circle>
                <text x="80" y="90" fill="#8FD3FF" fontFamily="Inter, sans-serif" fontSize="14" fontWeight="600">PUNJAB</text>
                <text x="380" y="190" fill="#8FD3FF" fontFamily="Inter, sans-serif" fontSize="14" fontWeight="600">HARYANA</text>
                <text x="600" y="440" fill="#8FD3FF" fontFamily="Inter, sans-serif" fontSize="14" fontWeight="600">DELHI-NCR</text>
                <path d="M150 150 L700 300 L560 420 Z" fill="url(#fan)"></path>
                {arrows.map((a, _i) => (<Fragment key={_i}>
                  <line className="lp-wind" x1={a.x} y1={a.y} x2={a.x2} y2={a.y2} stroke="#8FD3FF" strokeWidth="1.4" markerEnd="url(#arw)" style={{ animationDelay: `${a.d}ms` }}></line>
                </Fragment>))}
                {plumes.map((p, _i) => (<Fragment key={_i}>
                  <ellipse className="lp-plume" cx={p.x} cy={p.y} rx={p.rx} ry={p.ry} fill="#A8977F" filter="url(#smoke)" style={{ animationDelay: `${p.d}ms` }}></ellipse>
                </Fragment>))}
                {fires.map((f, _i) => (<Fragment key={_i}>
                  <circle className="lp-pulse" cx={f.x} cy={f.y} r="7" fill="none" stroke="#FF8A3D" strokeWidth="2" style={{ animationDelay: `${f.d}ms` }}></circle>
                  <circle cx={f.x} cy={f.y} r="8" fill="#FF8A3D" filter="url(#fglow)" opacity={f.glow}></circle>
                  <circle cx={f.x} cy={f.y} r="4.5" fill={f.fill} stroke="#FF8A3D" strokeWidth="2" strokeDasharray={f.dash}></circle>
                </Fragment>))}
                {city.map((b, _i) => (<Fragment key={_i}>
                  <rect x={b.x} y={b.y} width="12" height={b.h} fill="#E5484D" opacity=".9"></rect>
                </Fragment>))}
                <g>
                  <rect x="530" y="250" width="232" height="52" rx="12" fill="#0B1D33" stroke="#FF8A3D"></rect>
                  <text x="546" y="272" fill="#FFFFFF" fontFamily="Inter, sans-serif" fontSize="13" fontWeight="600">Plume est. arrival: 9–13 h</text>
                  <text x="546" y="290" fill="#FFB27D" fontFamily="JetBrains Mono, monospace" fontSize="11">ESTIMATE · CONFIDENCE 72%</text>
                </g>
                <path d="M160 300 L640 330" stroke="#C9DDF0" strokeDasharray="4 6" strokeWidth="1"></path>
                <text x="330" y="312" fill="#C9DDF0" fontFamily="JetBrains Mono, monospace" fontSize="11">~230 km (schematic)</text>
              </svg>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', padding: '0 8px 8px', fontSize: '12px', color: '#C9DDF0' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="#FF8A3D"></circle></svg>Observed fire</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="#FF8A3D" strokeWidth="1.6" strokeDasharray="2 2"></circle></svg>Predicted fire</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><svg width="16" height="12" aria-hidden="true"><path d="M1 6 H13" stroke="#8FD3FF" strokeWidth="1.6"></path></svg>Wind vector</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" fill="#E5484D"></rect></svg>City AQI: Very Poor</span>
              </div>
            </div>

            <div style={{ flex: '1 1 320px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="lp-card lp-glass-d lp-reveal" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
                  <h3 className="lp-pop" style={{ margin: '0', fontSize: '20px' }}>Satellite fire points</h3>
                  <span className="lp-tag" style={{ color: '#8FD3FF' }}>Simulated feed</span>
                </div>
                <div style={{ display: 'flex', gap: '24px' }}>
                  <div><div className="lp-mono" style={{ fontSize: '40px', fontWeight: '700', lineHeight: '1', color: '#FF8A3D' }}>{firesObs}</div><div style={{ fontSize: '13px', color: '#C9DDF0', marginTop: '4px' }}>Observed today</div></div>
                  <div><div className="lp-mono" style={{ fontSize: '40px', fontWeight: '700', lineHeight: '1', color: '#FFFFFF' }}>{firesPred}</div><div style={{ fontSize: '13px', color: '#C9DDF0', marginTop: '4px' }}>Predicted next 24 h</div></div>
                </div>
                <span className="lp-tag" style={{ marginTop: '14px', color: '#FFB27D' }}>Model confidence 89%</span>
              </div>
              <div className="lp-card lp-glass-d lp-reveal" style={{ padding: '24px', display: 'flex', gap: '20px', alignItems: 'center' }}>
                <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label="Wind compass: wind from the north-west at 22 kilometres per hour, blowing toward the south-east">
                  <circle cx="52" cy="52" r="48" fill="none" stroke="#2C5A86" strokeWidth="2"></circle>
                  <text x="52" y="16" textAnchor="middle" fill="#8FD3FF" fontSize="10" fontFamily="JetBrains Mono, monospace">N</text>
                  <text x="52" y="96" textAnchor="middle" fill="#8FD3FF" fontSize="10" fontFamily="JetBrains Mono, monospace">S</text>
                  <text x="10" y="56" textAnchor="middle" fill="#8FD3FF" fontSize="10" fontFamily="JetBrains Mono, monospace">W</text>
                  <text x="94" y="56" textAnchor="middle" fill="#8FD3FF" fontSize="10" fontFamily="JetBrains Mono, monospace">E</text>
                  <g transform="rotate(135 52 52)"><path d="M52 18 L60 52 L52 46 L44 52 Z" fill="#FF8A3D"></path><path d="M52 86 L58 52 L52 58 L46 52 Z" fill="#4FB3FF"></path></g>
                </svg>
                <div>
                  <h3 className="lp-pop" style={{ margin: '0 0 4px', fontSize: '20px' }}>Wind field</h3>
                  <div className="lp-mono" style={{ fontSize: '28px', fontWeight: '700' }}>NW 22 <span style={{ fontSize: '14px' }}>km/h</span></div>
                  <div style={{ fontSize: '13px', color: '#C9DDF0' }}>Inversion layer 380 m · plume trapped low</div>
                </div>
              </div>
              <div className="lp-card lp-glass-d lp-reveal" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
                  <h3 className="lp-pop" style={{ margin: '0', fontSize: '20px' }}>Downstream impact</h3>
                  <span className="lp-tag" style={{ color: '#FFB27D' }}>Estimate</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                  <span className="lp-mono" style={{ fontSize: '40px', fontWeight: '700', color: '#FF6B6F' }}>362</span>
                  <span className="lp-chip" style={{ background: '#E5484D', color: '#FFFFFF' }}>Very Poor</span>
                </div>
                <p style={{ margin: '8px 0 16px', fontSize: '14px', color: '#C9DDF0' }}>Anand Vihar · PM2.5 expected <b className="lp-mono" style={{ color: '#FFFFFF' }}>190–240 µg/m³</b> as the plume arrives</p>
                <Link className="lp-btn lp-btn-o" to="/policy" style={{ width: '100%', justifyContent: 'center' }}>View 72 h plume forecast &amp; source split</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Act 4: response loop ===== */}
      <section id="act4" style={{ position: 'relative', padding: '140px 16px 120px', background: 'linear-gradient(180deg, #0B1D33 0%, #2F86D6 14%, #8FD3FF 32%, #EAF7F0 70%, #F4FAFF 100%)', overflow: 'hidden' }}>
        <div style={{ position: 'relative', maxWidth: '1240px', margin: '0 auto' }}>
          <p className="lp-eyebrow" style={{ margin: '0 0 16px', color: '#0B1D33' }}>04 — Response loop</p>
          <h2 className="lp-pop" style={{ margin: '0 0 16px', fontSize: 'clamp(40px, 5.6vw, 72px)', lineHeight: '1.02', maxWidth: '1000px', color: '#0B1D33' }}>
            {s4.map((w, _i) => (<Fragment key={_i}><span className="lp-word" style={{ animationDelay: `${w.d}ms` }}>{w.t}</span></Fragment>))}
          </h2>
          <p className="lp-reveal" style={{ margin: '0 0 48px', fontSize: '18px', maxWidth: '620px', color: '#0F2A47' }}>The nearest machine is matched, the farmer confirms with a keypress on a basic phone, the straw goes to a Bio-CNG plant instead of the sky — and the city's air card turns green again.</p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
            <div className="lp-reveal" style={{ flex: '999 1 640px', minWidth: '0', position: 'relative', borderRadius: '28px', overflow: 'hidden', minHeight: '420px', background: 'linear-gradient(180deg, #2F86D6, #DFF3FF 40%, #0E5E40 41%)', boxShadow: '0 30px 80px rgba(15,42,71,.2)' }}>
              <canvas ref={act4Canvas} aria-hidden="true" style={{ position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' }}></canvas>
              <div aria-hidden="true" style={{ position: 'absolute', inset: '0', background: 'linear-gradient(180deg, rgba(11,29,51,.05), rgba(11,29,51,.3))' }}></div>
              <svg viewBox="0 0 700 420" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A glowing green route links the machinery station to the high-risk farm; the fire point is covered by a green ring" style={{ position: 'absolute', inset: '0', width: '100%', height: '100%' }}>
                <defs><filter id="gg"><feGaussianBlur stdDeviation="5"></feGaussianBlur></filter></defs>
                <path d="M120 380 C 240 300, 420 360, 540 230" fill="none" stroke="#34D399" strokeWidth="10" opacity=".6" filter="url(#gg)"></path>
                <path d="M120 380 C 240 300, 420 360, 540 230" fill="none" stroke="#FFFFFF" strokeWidth="3" className="lp-flow"></path>
                <circle r="7" fill="#FFFFFF"><animateMotion dur="3.6s" repeatCount="indefinite" path="M120 380 C 240 300, 420 360, 540 230"></animateMotion></circle>
                <circle className="lp-breathe" cx="120" cy="380" r="26" fill="#10B981"></circle>
                <circle cx="120" cy="380" r="13" fill="#10B981" stroke="#FFFFFF" strokeWidth="3"></circle>
                <circle className="lp-pulse" cx="540" cy="230" r="16" fill="none" stroke="#34D399" strokeWidth="3"></circle>
                <circle cx="540" cy="230" r="16" fill="rgba(16,185,129,.35)" stroke="#34D399" strokeWidth="3"></circle>
                <circle cx="540" cy="230" r="5" fill="#FF8A3D"></circle>
              </svg>
              <div className="lp-glass" style={{ position: 'absolute', left: '16px', top: '16px', padding: '12px 16px', borderRadius: '16px', background: 'rgba(255,255,255,.82)' }}>
                <div style={{ fontSize: '12px', color: '#3B526B' }}>Station → farm PB-SGR-1142</div>
                <div className="lp-mono" style={{ fontWeight: '700', fontSize: '18px' }}>2.4 km · ETA 38 min</div>
              </div>
              <span className="lp-tag" style={{ position: 'absolute', right: '16px', top: '16px', color: '#FFFFFF', background: 'rgba(11,29,51,.45)' }}>Simulated</span>
            </div>

            <div style={{ flex: '1 1 320px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="lp-card lp-glass lp-reveal" style={{ padding: '24px', background: 'rgba(255,255,255,.85)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
                  <h3 className="lp-pop" style={{ margin: '0', fontSize: '20px' }}>AI machinery match</h3>
                  <span className="lp-tag" style={{ color: '#4A6380' }}>Demo data</span>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                  <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="14" fill="#E3F8EE"></rect><path d="M10 30 H30 V20 H22 L18 26 H10 Z M30 24 H38 V30 H30" fill="none" stroke="#0B7A53" strokeWidth="2" strokeLinejoin="round"></path><circle cx="16" cy="33" r="4" fill="#0B7A53"></circle><circle cx="34" cy="33" r="3" fill="#0B7A53"></circle></svg>
                  <div>
                    <div style={{ fontWeight: '700' }}>Super Seeder · CHC Bhawanigarh</div>
                    <div style={{ fontSize: '13px', color: '#3B526B' }}>Nearest free unit · <span className="lp-mono">2.4 km</span> · <span className="lp-mono">₹750</span>/acre (demo rate)</div>
                  </div>
                </div>
                <Link className="lp-btn lp-btn-g" to="/farmer" style={{ width: '100%', justifyContent: 'center' }} aria-label="Book the Super Seeder by phone keypad: open the farmer call">
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g fill="#fff"><circle cx="4" cy="3" r="1.4"></circle><circle cx="8" cy="3" r="1.4"></circle><circle cx="12" cy="3" r="1.4"></circle><circle cx="4" cy="7" r="1.4"></circle><circle cx="8" cy="7" r="1.4"></circle><circle cx="12" cy="7" r="1.4"></circle><circle cx="4" cy="11" r="1.4"></circle><circle cx="8" cy="11" r="1.4"></circle><circle cx="12" cy="11" r="1.4"></circle><circle cx="8" cy="15" r="1"></circle></g></svg>
                  Book by phone keypad
                </Link>
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#4A6380' }}>On the call the farmer presses 1, then 1 again to confirm. Works on any basic phone: no app, no internet.</p>
              </div>
              <div className="lp-card lp-glass lp-reveal" style={{ padding: '24px', background: 'rgba(255,255,255,.85)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
                  <h3 className="lp-pop" style={{ margin: '0', fontSize: '20px' }}>Green eco-credits</h3>
                  <span className="lp-tag" style={{ color: '#4A6380' }}>Estimation assumptions</span>
                </div>
                <div className="lp-mono" style={{ fontSize: '13px', lineHeight: '1.9', background: '#F0F7FC', borderRadius: '12px', padding: '12px 14px' }}>
                  straw t = acres × 2.5<br />
                  CO₂e t ≈ straw t × 1.5<br />
                  credits = CO₂e t × 10
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '14px', gap: '8px' }}>
                  <span style={{ fontSize: '14px', color: '#3B526B' }}>6 acres → 15 t → 22.5 t CO₂e</span>
                  <span className="lp-mono" style={{ fontSize: '28px', fontWeight: '700', color: '#0B7A53' }}>+225</span>
                </div>
              </div>
              <div className="lp-card lp-reveal" style={{ padding: '24px', background: '#0E8F62', color: '#FFFFFF' }}>
                <h3 className="lp-pop" style={{ margin: '0 0 6px', fontSize: '20px' }}>And on the street?</h3>
                <p style={{ margin: '0 0 16px', color: '#E3F8EE', fontSize: '15px' }}>Asthma alerts, cleaner commute routes, and one-tap dust reports for Delhi residents.</p>
                <Link className="lp-btn lp-btn-w" to="/citizen" style={{ width: '100%', justifyContent: 'center' }}>Try the citizen app</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer style={{ background: '#0B1D33', color: '#C9DDF0', padding: '72px 16px 48px' }}>
        <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: '40px', justifyContent: 'space-between' }}>
          <div style={{ flex: '1 1 380px', minWidth: '0' }}>
            <div className="lp-pop" style={{ fontSize: '24px', color: '#FFFFFF', marginBottom: '12px' }}>TerraPulse</div>
            <p style={{ margin: '0', maxWidth: '520px', fontSize: '15px' }}>A multi-agent micro-zone platform, orchestrated by IBM Bob, that links pre-harvest fire-risk forecasting, FPO machinery dispatch, multilingual farmer calls, satellite plume tracking and street-level health alerts into one loop.</p>
          </div>
          <div style={{ flex: '1 1 380px', minWidth: '0' }}>
            <div role="note" style={{ border: '1px solid rgba(255,138,61,.6)', background: 'rgba(255,138,61,.08)', borderRadius: '20px', padding: '20px' }}>
              <div className="lp-eyebrow" style={{ color: '#FFB27D', marginBottom: '8px' }}>Disclaimer</div>
              <p style={{ margin: '0', color: '#FFFFFF', fontWeight: '600' }}>All data on this page is simulated for demonstration. It does not represent real monitoring, real government orders or real partnerships.</p>
              <p style={{ margin: '8px 0 0', fontSize: '13px' }}>Prices, farmer names, ticket numbers and partner plants are examples. Health tips are illustrative, not medical advice.</p>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
