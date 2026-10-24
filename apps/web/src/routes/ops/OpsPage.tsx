import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import type { CompletionRequest, WorkOrder, WorkOrderStatus } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { AsyncBoundary } from '@/design-system/AsyncBoundary';
import { IconBack, IconCamera, IconCheck, IconPin, IconSpinner } from '@/design-system/Icons';
import { LangSwitch } from '@/design-system/LangSwitch';
import { OfflineBanner } from '@/design-system/OfflineBanner';
import { useAsync } from '@/hooks/useAsync';
import { useOnline } from '@/hooks/useOnline';
import { formatTime } from '@/lib/format';
import { useI18n, type MessageKey } from '@/i18n';
import { photoToDataUrl } from '@/routes/citizen/image';
import { useGeolocation } from '@/routes/citizen/useGeolocation';
import { DataAttribution } from '@/design-system/DataAttribution';
import { newRequestId, queueAdd, queueList, syncQueue } from './queue';

type Tab = 'todo' | 'accepted' | 'done';
const TAB_STATUS: Record<Tab, WorkOrderStatus> = { todo: 'created', accepted: 'accepted', done: 'completed' };

export default function OpsPage() {
  const { t } = useI18n();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('todo');
  const [completing, setCompleting] = useState<WorkOrder | null>(null);
  const [pending, setPending] = useState(() => queueList().length);
  const [note, setNote] = useState<string | null>(null);
  const orders = useAsync(() => api.listWorkOrders(), []);

  // Send saved completions when the connection returns. syncQueue shares one run between overlapping triggers.
  const flush = useCallback(async () => {
    if (queueList().length === 0) return;
    const r = await syncQueue((req) => api.completeWorkOrder(req));
    setPending(r.remaining);
    if (r.sent.length > 0) { setNote(t('ops.synced', { n: r.sent.length })); orders.refresh(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  useEffect(() => { if (online) void flush(); }, [online, flush]);

  async function accept(w: WorkOrder) {
    try { await api.acceptWorkOrder(w.id); orders.refresh(); setTab('accepted'); } catch { setNote(t('ops.error')); }
  }

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { todo: 0, accepted: 0, done: 0 };
    if (orders.status === 'success') for (const w of orders.data) for (const k of Object.keys(TAB_STATUS) as Tab[]) if (TAB_STATUS[k] === w.status) c[k] += 1;
    return c;
  }, [orders]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col">
      <OfflineBanner message={t('common.offline')} />
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <Link to="/" aria-label={t('common.back')} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow"><IconBack /></Link>
        <div className="min-w-0 flex-1">
          <div className="mono text-xs tracking-[0.12em] text-leaf-700">{t('nav.ops')}</div>
          <h1 className="m-0 text-2xl font-bold">{t('ops.title')}</h1>
        </div>
        <LangSwitch />
      </header>

      <main id="main" className="flex flex-1 flex-col gap-3 px-4 pb-24">
        {pending > 0 && <p role="status" className="m-0 rounded-xl bg-warn-bg px-3 py-2 text-sm font-semibold text-warn-fg" data-testid="ops-queued">{t('ops.queued', { n: pending })}</p>}
        {note && <p role="status" className="m-0 rounded-xl bg-leaf-50 px-3 py-2 text-sm font-semibold text-leaf-700">{note}</p>}

        <div role="tablist" aria-label={t('ops.title')} className="grid grid-cols-3 gap-2">
          {(['todo', 'accepted', 'done'] as Tab[]).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} className={`btn ${tab === k ? 'btn-navy' : 'btn-ghost'}`} onClick={() => setTab(k)}>
              {t(`ops.tab.${k}` as MessageKey)} ({counts[k]})
            </button>
          ))}
        </div>

        <AsyncBoundary state={orders} onRetry={orders.reload} what="work orders" retryLabel={t('common.retry')} empty={t('ops.empty')}>
          {(all) => {
            const rows = all.filter((w) => w.status === TAB_STATUS[tab]);
            if (rows.length === 0) return <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-soft">{t('ops.empty')}</div>;
            return (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {rows.map((w) => <OrderCard key={w.id} w={w} onAccept={() => void accept(w)} onComplete={() => setCompleting(w)} />)}
              </ul>
            );
          }}
        </AsyncBoundary>
      </main>

      {completing && (
        <CompleteSheet
          w={completing}
          online={online}
          onClose={() => setCompleting(null)}
          onDone={(queued) => {
            setCompleting(null);
            setPending(queueList().length);
            setNote(queued ? t('ops.saved') : null);
            orders.refresh();
            if (!queued) setTab('done');
          }}
        />
      )}
      <DataAttribution sources={['cpcb', 'cams']} />
    </div>
  );
}

function OrderCard({ w, onAccept, onComplete }: { w: WorkOrder; onAccept: () => void; onComplete: () => void }) {
  const { t } = useI18n();
  const overdue = w.status !== 'completed' && new Date(w.dueBy).getTime() < Date.now();
  return (
    <li className="tile !p-4" data-testid="work-order" data-status={w.status}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-bold">{t(`ops.action.${w.actionType}` as MessageKey)}</div>
          <div className="text-sm text-ink-soft">{w.area} · <span className="mono">{w.id}</span></div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${overdue ? 'bg-warn-bg text-warn-fg' : 'bg-air-50 text-ink'}`}>
          {overdue ? t('ops.overdue') : t('ops.due', { time: formatTime(w.dueBy) })}
        </span>
      </div>
      {w.status === 'created' && <button type="button" className="btn btn-primary btn-lg mt-3 w-full" onClick={onAccept}>{t('ops.accept')}</button>}
      {w.status === 'accepted' && <button type="button" className="btn btn-primary btn-lg mt-3 w-full" onClick={onComplete}><IconCamera /> {t('ops.complete')}</button>}
      {w.status === 'completed' && (
        <p className="m-0 mt-3 text-sm font-semibold" data-testid="roi">
          {w.roi ? t('ops.roi', { v: w.roi.deltaPm25 }) : <span className="text-ink-soft">{t('ops.roiPending')}</span>}
        </p>
      )}
    </li>
  );
}

function CompleteSheet({ w, online, onClose, onDone }: { w: WorkOrder; online: boolean; onClose: () => void; onDone: (queued: boolean) => void }) {
  const { t } = useI18n();
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const { geo, locate } = useGeolocation();
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per attempt: retries and the offline queue reuse it, so the server records a single completion.
  const requestId = useRef(newRequestId());

  useEffect(() => { locate(); }, [locate]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhoto(await photoToDataUrl(file));
  }

  async function submit() {
    if (!photo || geo.status !== 'ok') { setError(t('ops.needBoth')); return; }
    const req: CompletionRequest = { workOrderId: w.id, clientRequestId: requestId.current, photoDataUrl: photo, lat: geo.lat, lng: geo.lng, capturedAt: new Date().toISOString() };
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
      <div className="max-h-[92vh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-white p-5">
        <h2 id={`${uid}-h`} className="h m-0 text-xl">{t('ops.complete')}: {t(`ops.action.${w.actionType}` as MessageKey)} · {w.area}</h2>
        <div className="mt-4">
          <input ref={fileRef} id={`${uid}-photo`} type="file" accept="image/*" capture="environment" className="sr-only" data-testid="ops-photo-input" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          {photo ? (
            <div className="flex flex-col gap-2">
              <img src={photo} alt={t('ops.photoAlt')} className="max-h-60 w-full rounded-2xl object-cover" />
              <label htmlFor={`${uid}-photo`} className="btn btn-ghost cursor-pointer">{t('ops.retake')}</label>
            </div>
          ) : (
            <label htmlFor={`${uid}-photo`} className="btn btn-navy btn-lg w-full cursor-pointer"><IconCamera /> {t('ops.photo')}</label>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-air-50 px-4 py-3 text-sm" role="status" data-testid="ops-gps">
          {geo.status === 'locating' ? <IconSpinner /> : geo.status === 'ok' ? <IconCheck size={18} /> : <IconPin />}
          <span>
            {geo.status === 'idle' && t('ops.gps.idle')}
            {geo.status === 'locating' && t('ops.gps.locating')}
            {geo.status === 'ok' && t('ops.gps.ok', { m: geo.accuracyM })}
            {(geo.status === 'denied' || geo.status === 'unavailable') && t('ops.gps.denied')}
          </span>
          {geo.status !== 'ok' && geo.status !== 'locating' && <button type="button" className="btn btn-ghost ml-auto !min-h-9 !px-3" onClick={locate}>{t('ops.gps.try')}</button>}
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
