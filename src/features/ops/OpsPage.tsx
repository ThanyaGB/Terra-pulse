import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import type { CompletionRequest, WorkActionType, WorkOrder, WorkOrderStatus } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { IconBack, IconCamera, IconCheck, IconPin, IconSpinner, IconTruck, IconWind } from '@/design/Icons';
import { LangSwitch } from '@/design/LangSwitch';
import { OfflineBanner } from '@/design/OfflineBanner';
import { photoToDataUrl } from '@/features/citizen/image';
import { useGeolocation } from '@/features/citizen/useGeolocation';
import { useAsync } from '@/hooks/useAsync';
import { useOnline } from '@/hooks/useOnline';
import { formatTime } from '@/lib/format';
import { subscribeWorkOrders } from '@/lib/workorders';
import { useI18n, type MessageKey } from '@/i18n';
import { newRequestId, queueAdd, queueList, syncQueue } from './queue';

type Tab = 'todo' | 'accepted' | 'done';
const TAB_STATUS: Record<Tab, WorkOrderStatus> = { todo: 'created', accepted: 'accepted', done: 'completed' };

const ACTION_ICON: Record<WorkActionType, ReactNode> = {
  fog_cannons: <IconWind size={22} />,
  road_sweeping: <IconTruck size={22} />,
  dust_suppression: <IconWind size={22} />,
};

/** Demo GPS for laptops at a demo table, where browser location is often blocked. Clearly labelled on screen. */
const DEMO_GPS = { lat: 28.6469, lng: 77.3159, accuracyM: 25 };

const isOverdue = (w: WorkOrder) => w.status !== 'completed' && new Date(w.dueBy).getTime() < Date.now();

/** Municipal supervisor portal (D5): accept work orders created by directives, complete them with a photo and GPS. */
export default function OpsPage() {
  const { t } = useI18n();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('todo');
  const [completing, setCompleting] = useState<WorkOrder | null>(null);
  const [pending, setPending] = useState(() => queueList().length);
  const [note, setNote] = useState<string | null>(null);
  const orders = useAsync(() => api.listWorkOrders(), []);
  const { refresh } = orders;

  // New orders issued on /policy (same browser) appear without a reload.
  useEffect(() => subscribeWorkOrders(refresh), [refresh]);

  // Send saved completions when the connection returns. syncQueue shares one run between overlapping triggers.
  const flush = useCallback(async () => {
    if (queueList().length === 0) return;
    const r = await syncQueue((req) => api.completeWorkOrder(req));
    setPending(r.remaining);
    if (r.sent.length > 0) { setNote(t('ops.synced', { n: r.sent.length })); refresh(); }
  }, [t, refresh]);
  useEffect(() => { if (online) void flush(); }, [online, flush]);

  async function accept(w: WorkOrder) {
    try { await api.acceptWorkOrder(w.id); refresh(); setTab('accepted'); setNote(t('ops.acceptedNote', { id: w.id })); } catch { setNote(t('ops.error')); }
  }

  const counts = useMemo(() => {
    const c = { todo: 0, accepted: 0, done: 0, overdue: 0 };
    if (orders.status === 'success') for (const w of orders.data) {
      if (w.status === 'created') c.todo += 1; else if (w.status === 'accepted') c.accepted += 1; else c.done += 1;
      if (isOverdue(w)) c.overdue += 1;
    }
    return c;
  }, [orders]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[520px] flex-col">
      <OfflineBanner message={t('common.offline')} />
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <Link to="/" aria-label={t('common.back')} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow"><IconBack /></Link>
        <div className="min-w-0 flex-1">
          <div className="mono text-xs tracking-[0.12em] text-leaf-700">D5 · {t('ops.code').toUpperCase()}</div>
          <h1 className="m-0 text-2xl font-bold">{t('ops.title')}</h1>
        </div>
        <LangSwitch />
      </header>

      <main id="main" className="flex flex-1 flex-col gap-3 px-4 pb-28">
        <p className="m-0 text-sm text-ink-soft">{t('ops.intro')}</p>

        <section aria-label={t('ops.summary')} className="grid grid-cols-4 gap-2" data-testid="ops-kpis">
          {([['todo', counts.todo, '#0F2A47'], ['accepted', counts.accepted, '#0F6FB8'], ['done', counts.done, '#0B7A53'], ['overdue', counts.overdue, '#B45309']] as const).map(([k, n, c]) => (
            <div key={k} className="rounded-2xl bg-white p-3 text-center shadow-sm">
              <div className="mono text-2xl font-bold" style={{ color: c }}>{n}</div>
              <div className="text-xs text-ink-soft">{t(`ops.kpi.${k}` as MessageKey)}</div>
            </div>
          ))}
        </section>

        {pending > 0 && <p role="status" className="m-0 rounded-xl bg-warn-bg px-3 py-2 text-sm font-semibold text-warn-fg" data-testid="ops-queued">{t('ops.queued', { n: pending })}</p>}
        {note && <p role="status" className="m-0 rounded-xl bg-leaf-50 px-3 py-2 text-sm font-semibold text-leaf-700" data-testid="ops-note">{note}</p>}

        <div role="tablist" aria-label={t('ops.title')} className="grid grid-cols-3 gap-2">
          {(['todo', 'accepted', 'done'] as Tab[]).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} className={`btn ${tab === k ? 'btn-navy' : 'btn-ghost'}`} onClick={() => setTab(k)}>
              {t(`ops.tab.${k}` as MessageKey)} ({counts[k]})
            </button>
          ))}
        </div>

        <AsyncBoundary state={orders} onRetry={orders.reload} what="work orders" retryLabel={t('common.retry')} isEmpty={(d) => d.length === 0} empty={t('ops.empty')}>
          {(all) => {
            const rows = all.filter((w) => w.status === TAB_STATUS[tab]);
            if (rows.length === 0) return <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-soft">{t(tab === 'todo' ? 'ops.emptyTodo' : 'ops.empty')}</div>;
            return (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {rows.map((w) => <OrderCard key={w.id} w={w} onAccept={() => void accept(w)} onComplete={() => setCompleting(w)} />)}
              </ul>
            );
          }}
        </AsyncBoundary>

        <p className="m-0 mt-2 text-center text-xs text-ink-soft">{t('ops.demoNote')} <Link to="/policy" className="font-semibold text-leaf-700 underline">{t('ops.toPolicy')}</Link></p>
      </main>

      {completing && (
        <CompleteSheet
          w={completing}
          online={online}
          onClose={() => setCompleting(null)}
          onDone={(queued) => {
            setCompleting(null);
            setPending(queueList().length);
            setNote(queued ? t('ops.saved') : t('ops.doneNote'));
            refresh();
            if (!queued) setTab('done');
          }}
        />
      )}
    </div>
  );
}

function OrderCard({ w, onAccept, onComplete }: { w: WorkOrder; onAccept: () => void; onComplete: () => void }) {
  const { t } = useI18n();
  const overdue = isOverdue(w);
  return (
    <li className="tile !p-4" data-testid="work-order" data-status={w.status} data-id={w.id}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-air-100 text-navy" aria-hidden="true">{ACTION_ICON[w.actionType]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-lg font-bold leading-tight">{t(`ops.action.${w.actionType}` as MessageKey)}</div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${overdue ? 'bg-warn-bg text-warn-fg' : w.status === 'completed' ? 'bg-leaf-50 text-leaf-700' : 'bg-air-50 text-ink'}`}>
              {w.status === 'completed' && w.completedAt ? t('ops.doneAt', { time: formatTime(w.completedAt) }) : overdue ? t('ops.overdue') : t('ops.due', { time: formatTime(w.dueBy) })}
            </span>
          </div>
          <div className="text-sm text-ink-soft">{w.area} · <span className="mono">{w.id}</span></div>
          {w.source && <div className="mt-1 inline-block rounded-full bg-navy px-2 py-0.5 text-xs font-semibold text-white" data-testid="order-source">{t('ops.from')}: {w.source}</div>}
        </div>
      </div>
      {w.status === 'created' && <button type="button" className="btn btn-primary btn-lg mt-3 w-full" onClick={onAccept}>{t('ops.accept')}</button>}
      {w.status === 'accepted' && <button type="button" className="btn btn-primary btn-lg mt-3 w-full" onClick={onComplete}><IconCamera /> {t('ops.complete')}</button>}
      {w.status === 'completed' && (
        <p className="m-0 mt-3 rounded-xl bg-air-50 px-3 py-2 text-sm font-semibold" data-testid="roi">
          {w.roi ? t('ops.roi', { v: w.roi.deltaPm25, c: w.roi.controlArea ?? '—' }) : <span className="text-ink-soft">{t('ops.roiPending')}</span>}
        </p>
      )}
    </li>
  );
}

/** A small generated picture for demos where no camera or photo file is at hand. */
function demoPhoto(w: WorkOrder): string {
  const c = document.createElement('canvas');
  c.width = 480; c.height = 300;
  const g = c.getContext('2d');
  if (!g) return 'data:image/png;base64,iVBORw0KGgo=';
  const grad = g.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, '#C4E7FB'); grad.addColorStop(1, '#9AA8B5');
  g.fillStyle = grad; g.fillRect(0, 0, 480, 300);
  g.fillStyle = '#5B6672'; g.fillRect(0, 210, 480, 90);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 40; i += 1) { g.beginPath(); g.arc(120 + (i * 37) % 260, 90 + (i * 23) % 110, 6 + (i % 5) * 3, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#0B1D33'; g.font = 'bold 18px sans-serif';
  g.fillText(`DEMO PHOTO · ${w.area}`, 16, 286);
  return c.toDataURL('image/jpeg', 0.7);
}

function CompleteSheet({ w, online, onClose, onDone }: { w: WorkOrder; online: boolean; onClose: () => void; onDone: (queued: boolean) => void }) {
  const { t } = useI18n();
  const uid = useId();
  const { geo, locate } = useGeolocation();
  const [demoGps, setDemoGps] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [demoPic, setDemoPic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per attempt: retries and the offline queue reuse it, so the server records a single completion.
  const requestId = useRef(newRequestId());

  useEffect(() => { locate(); }, [locate]);

  const pos = demoGps ? DEMO_GPS : geo.status === 'ok' ? geo : null;

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setDemoPic(false);
    setPhoto(await photoToDataUrl(file));
  }

  async function submit() {
    if (!photo || !pos) { setError(t('ops.needBoth')); return; }
    const req: CompletionRequest = { workOrderId: w.id, clientRequestId: requestId.current, photoDataUrl: photo, lat: pos.lat, lng: pos.lng, capturedAt: new Date().toISOString() };
    if (!navigator.onLine) { queueAdd(req); onDone(true); return; }
    setBusy(true);
    setError(null);
    try {
      await api.completeWorkOrder(req);
      onDone(false);
    } catch (e) {
      if (e instanceof ApiError && e.isOffline) { queueAdd(req); onDone(true); } else setError(t('ops.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-h`} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-t-3xl bg-white p-5">
        <h2 id={`${uid}-h`} className="h m-0 text-xl">{t('ops.complete')}: {t(`ops.action.${w.actionType}` as MessageKey)}</h2>
        <p className="m-0 mt-1 text-sm text-ink-soft">{w.area} · <span className="mono">{w.id}</span></p>
        <p className="m-0 mt-3 text-sm">{t('ops.proofNote')}</p>

        <div className="mt-3">
          <input id={`${uid}-photo`} type="file" accept="image/*" capture="environment" className="sr-only" data-testid="ops-photo-input" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          {photo ? (
            <div className="flex flex-col gap-2">
              <img src={photo} alt={t('ops.photoAlt')} className="max-h-60 w-full rounded-2xl object-cover" />
              {demoPic && <span className="text-xs font-semibold text-warn-fg">{t('ops.demoPhotoTag')}</span>}
              <label htmlFor={`${uid}-photo`} className="btn btn-ghost cursor-pointer">{t('ops.retake')}</label>
            </div>
          ) : (
            <div className="grid gap-2">
              <label htmlFor={`${uid}-photo`} className="btn btn-navy btn-lg w-full cursor-pointer"><IconCamera /> {t('ops.photo')}</label>
              <button type="button" className="btn btn-ghost" onClick={() => { setPhoto(demoPhoto(w)); setDemoPic(true); setError(null); }}>{t('ops.demoPhoto')}</button>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-air-50 px-4 py-3 text-sm" role="status" data-testid="ops-gps">
          {demoGps ? <IconCheck size={18} /> : geo.status === 'locating' ? <IconSpinner /> : geo.status === 'ok' ? <IconCheck size={18} /> : <IconPin />}
          <span className="flex-1">
            {demoGps && t('ops.gps.demo', { m: DEMO_GPS.accuracyM })}
            {!demoGps && geo.status === 'idle' && t('ops.gps.idle')}
            {!demoGps && geo.status === 'locating' && t('ops.gps.locating')}
            {!demoGps && geo.status === 'ok' && t('ops.gps.ok', { m: geo.accuracyM })}
            {!demoGps && (geo.status === 'denied' || geo.status === 'unavailable') && t('ops.gps.denied')}
          </span>
          {!pos && geo.status !== 'locating' && (
            <span className="flex w-full gap-2">
              <button type="button" className="btn btn-ghost !min-h-9 !px-3" onClick={locate}>{t('ops.gps.try')}</button>
              <button type="button" className="btn btn-ghost !min-h-9 !px-3" onClick={() => { setDemoGps(true); setError(null); }}>{t('ops.gps.useDemo')}</button>
            </span>
          )}
        </div>

        {error && <p role="alert" className="m-0 mt-3 font-semibold text-danger">{error}</p>}
        {!online && <p role="status" className="m-0 mt-3 text-sm text-ink-soft">{t('ops.saved')}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost btn-lg" onClick={onClose}>{t('ops.cancel')}</button>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => void submit()} disabled={busy}>{busy ? t('ops.sending') : t('ops.submit')}</button>
        </div>
      </div>
    </div>
  );
}
