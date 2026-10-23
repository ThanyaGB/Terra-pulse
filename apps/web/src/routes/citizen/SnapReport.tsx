import { TicketTimeline } from './TicketTimeline';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { ReportCategory, ReportRequest } from '@/api/contract';
import { IconCamera, IconCheck, IconPin, IconSpinner } from '@/design-system/Icons';
import { useOnline } from '@/hooks/useOnline';
import { useI18n, type MessageKey } from '@/i18n';
import { photoToDataUrl } from './image';
import { outboxAdd, outboxList, outboxReplace } from './storage';
import { useGeolocation } from './useGeolocation';

const CATEGORIES: { id: ReportCategory; label: MessageKey }[] = [
  { id: 'open_burning', label: 'cz.cat.open_burning' },
  { id: 'construction', label: 'cz.cat.construction' },
  { id: 'road_dust', label: 'cz.cat.road_dust' },
];

type Result = { kind: 'sent'; referenceId: string; receivedAt: string } | { kind: 'queued' } | null;

export function SnapReport({ areaId }: { areaId: string }) {
  const { t } = useI18n();
  const uid = useId();
  const online = useOnline();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [pending, setPending] = useState(() => outboxList().length);
  const { geo, locate } = useGeolocation();

  // send reports that were saved while offline as soon as the connection returns
  useEffect(() => {
    if (!online) return;
    const queue = outboxList();
    if (queue.length === 0) return;
    let cancelled = false;
    (async () => {
      const left: ReportRequest[] = [];
      for (const r of queue) {
        try { await api.submitReport(r); } catch { left.push(r); }
      }
      if (cancelled) return;
      outboxReplace(left);
      setPending(left.length);
    })();
    return () => { cancelled = true; };
  }, [online]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhoto(await photoToDataUrl(file));
    setCapturedAt(new Date().toISOString());
    if (geo.status === 'idle' || geo.status === 'denied' || geo.status === 'unavailable') locate();
  }

  async function submit() {
    if (!category || !photo) { setError(t('cz.report.needPhoto')); return; }
    const req: ReportRequest = {
      category, photoDataUrl: photo, areaId, capturedAt: capturedAt ?? new Date().toISOString(),
      lat: geo.status === 'ok' ? geo.lat : null, lng: geo.status === 'ok' ? geo.lng : null, accuracyM: geo.status === 'ok' ? geo.accuracyM : null,
    };
    if (!navigator.onLine) { outboxAdd(req); setPending(outboxList().length); setResult({ kind: 'queued' }); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.submitReport(req);
      setResult({ kind: 'sent', referenceId: r.referenceId, receivedAt: r.receivedAt });
    } catch (e) {
      if (e instanceof ApiError && e.isOffline) { outboxAdd(req); setPending(outboxList().length); setResult({ kind: 'queued' }); }
      else setError(t('cz.report.error'));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCategory(null); setPhoto(null); setCapturedAt(null); setResult(null); setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  if (result) {
    return (
      <section aria-labelledby="done-h" className="tile !p-6 text-center" data-reveal>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-leaf-700 text-white"><IconCheck size={34} /></div>
        <h2 id="done-h" className="h mt-3 text-xl">{result.kind === 'sent' ? t('cz.report.done') : t('cz.report.savedTitle')}</h2>
        {result.kind === 'sent' ? (
          <>
            <p className="m-0 mt-2 text-sm text-ink-soft">{t('cz.report.ref')}</p>
            <p className="mono m-0 text-3xl font-bold" data-testid="reference-id">{result.referenceId}</p>
            <p className="m-0 mt-2 text-sm text-ink-soft">{t('cz.report.shared')}</p>
            <TicketTimeline />
          </>
        ) : <p className="m-0 mt-2 text-sm text-ink-soft" role="status">{t('cz.report.queued')}</p>}
        <button type="button" className="btn btn-primary btn-lg mt-5 w-full" onClick={reset}>{t('cz.report.new')}</button>
      </section>
    );
  }

  return (
    <section aria-labelledby="report-h" className="tile !p-5" data-reveal>
      <h2 id="report-h" className="h mb-3">{t('cz.report.title')}</h2>
      {pending > 0 && <p role="status" className="m-0 mb-3 rounded-xl bg-warn-bg px-3 py-2 text-sm font-semibold text-warn-fg">{t('cz.report.outbox', { n: pending })}</p>}

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">{t('cz.report.category')}</legend>
        <div className="flex flex-col gap-2">
          {CATEGORIES.map((c) => {
            const on = category === c.id;
            return (
              <label key={c.id} className="relative block">
                <input type="radio" name={`${uid}-cat`} value={c.id} checked={on} onChange={() => setCategory(c.id)} className="peer sr-only" />
                <span className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 text-base font-semibold peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-air-600"
                  style={{ borderColor: on ? '#0B7A53' : 'rgb(11 29 51 / 0.2)', background: on ? '#E3F8EE' : '#fff' }}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border-2" style={{ borderColor: on ? '#0B7A53' : '#8EA3B8', background: on ? '#0B7A53' : '#fff', color: '#fff' }} aria-hidden="true">{on && <IconCheck size={14} />}</span>
                  {t(c.label)}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4">
        {/* `capture` opens the rear camera directly on phones; desktop browsers show a file picker */}
        <input ref={fileRef} id={`${uid}-photo`} type="file" accept="image/*" capture="environment" className="sr-only" data-testid="photo-input" onChange={(e) => void onPhoto(e.target.files?.[0])} />
        {photo ? (
          <div className="flex flex-col gap-2">
            <img src={photo} alt={t('cz.report.photoAlt')} className="max-h-64 w-full rounded-2xl object-cover" />
            <label htmlFor={`${uid}-photo`} className="btn btn-ghost cursor-pointer">{t('cz.report.retake')}</label>
          </div>
        ) : (
          <label htmlFor={`${uid}-photo`} className="btn btn-navy btn-lg w-full cursor-pointer"><IconCamera /> {t('cz.report.photo')}</label>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-air-50 px-4 py-3 text-sm" role="status" data-testid="gps-status">
        {geo.status === 'locating' ? <IconSpinner /> : <IconPin />}
        <span>
          {geo.status === 'idle' && t('cz.gps.idle')}
          {geo.status === 'locating' && t('cz.gps.locating')}
          {geo.status === 'ok' && t('cz.gps.ok', { m: geo.accuracyM })}
          {(geo.status === 'denied' || geo.status === 'unavailable') && t('cz.gps.denied')}
        </span>
        {(geo.status === 'denied' || geo.status === 'unavailable' || geo.status === 'idle') && <button type="button" className="btn btn-ghost ml-auto !min-h-9 !px-3" onClick={locate}>{t('cz.gps.try')}</button>}
      </div>

      {error && <p role="alert" className="m-0 mt-3 font-semibold text-danger">{error}</p>}
      {!online && <p role="status" className="m-0 mt-3 text-sm text-ink-soft">{t('cz.report.offlineHint')}</p>}
      <button type="button" className="btn btn-primary btn-lg mt-4 w-full" onClick={() => void submit()} disabled={busy}>{busy ? t('cz.report.sending') : t('cz.report.submit')}</button>
    </section>
  );
}
