import { Link, useLocation, useNavigate } from 'react-router-dom';

const STEPS = [
  { path: '/policy', title: 'Policy dashboard', body: 'Pick a street, scrub the 72 h plume, then issue a directive (nothing is sent until you confirm). A GRAP-II order also lights the citizen banner.' },
  { path: '/fpo', title: 'FPO console', body: 'Select a high-risk farmer, trigger a voice alert, assign a machine, and add a truck to watch eco-credits move.' },
  { path: '/farmer', title: 'Farmer call', body: 'Answer the call, press 1, 2 or 9 on the big keypad. Key 1 opens a WhatsApp booking sheet.' },
  { path: '/citizen', title: 'Citizen app', body: 'Check AQI and the better window, plan a cleaner commute, and report smoke with a photo.' },
] as const;

/** Judge demo mode: `?tour=1..4` shows a stepper over the four prototypes. */
export function TourBar() {
  const { pathname, search } = useLocation();
  const nav = useNavigate();
  const q = new URLSearchParams(search).get('tour');
  const step = q ? Number(q) : 0;
  if (!(step >= 1 && step <= STEPS.length)) return null;
  const s = STEPS[step - 1];
  const go = (n: number) => nav(`${STEPS[n - 1].path}?tour=${n}`);
  return (
    <aside aria-label="Judge demo tour" className="fixed bottom-3 left-3 right-3 z-50 mx-auto flex max-w-[640px] flex-wrap items-center gap-3 rounded-3xl bg-navy p-3 text-white shadow-2xl sm:bottom-24">
      <div className="min-w-[200px] flex-1 text-sm">
        <div className="mono text-xs text-air-400">TOUR {step}/{STEPS.length}{pathname !== s.path ? ' · use Next to continue' : ''}</div>
        <b>{s.title}.</b> {s.body}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn !min-h-10 !bg-white/15 !text-white" disabled={step === 1} onClick={() => go(step - 1)}>Back</button>
        {step < STEPS.length
          ? <button type="button" className="btn btn-primary !min-h-10" onClick={() => go(step + 1)}>Next</button>
          : <Link to="/" className="btn btn-primary !min-h-10">Finish</Link>}
        <Link to={pathname} className="btn !min-h-10 !bg-white/15 !text-white">Exit</Link>
      </div>
    </aside>
  );
}
