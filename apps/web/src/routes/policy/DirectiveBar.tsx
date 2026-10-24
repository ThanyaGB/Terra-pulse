import { useState, type ReactNode } from 'react';
import { api } from '@/api/client';
import type { DirectiveReceipt, DirectiveType } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { usePublicConfig } from '@/api/usePublicConfig';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design-system/AsyncBoundary';
import { ConfirmDialog } from '@/design-system/ConfirmDialog';
import { IconAlert, IconTruck, IconWind } from '@/design-system/Icons';
import { useToast } from '@/design-system/Toast';
import { formatTime } from '@/lib/format';
import { recordOrder } from '@/lib/orders';

const BUTTONS: { type: DirectiveType; label: string; icon: ReactNode; tone: 'danger' | 'primary' }[] = [
  { type: 'grap_ii', label: 'Issue GRAP-II alert', icon: <IconAlert />, tone: 'danger' },
  { type: 'diversion_trucks', label: 'Issue diversion order for out-of-state diesel trucks', icon: <IconTruck />, tone: 'primary' },
  { type: 'fog_cannons', label: 'Deploy fog cannons on heavy-pollution corridors', icon: <IconWind />, tone: 'primary' },
];

/** Export is possible only for an approved directive, and only while the platform's export switch is on (ADR-14). */
export function canExport(d: Pick<DirectiveReceipt, 'status'>, exportEnabled: boolean): boolean {
  return d.status === 'approved' && exportEnabled;
}

/**
 * Bottom toolbar. Nothing is recorded until the operator confirms in the modal. The platform records a recommendation and never
 * sends it to anyone: once approved (a diversion needs a second policy officer), the officer downloads the signed PDF.
 */
export function DirectiveBar() {
  const [active, setActive] = useState<DirectiveType | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [issued, setIssued] = useState<DirectiveReceipt[]>([]);
  const { toast } = useToast();
  const exportEnabled = usePublicConfig().flags.ADVISORY_EXPORT_ENABLED;
  const preview = useAsync(() => (active ? api.getDirectivePreview(active) : Promise.resolve(null)), [active]);

  async function confirm() {
    if (!active || preview.status !== 'success' || !preview.data) return;
    setBusy(true);
    setSendError(null);
    try {
      const receipt = await api.issueDirective(active, preview.data.affectedAreas.map((a) => a.id));
      setIssued((l) => [receipt, ...l]);
      recordOrder(receipt, preview.data.title);
      toast(`${preview.data.title}: recorded (${receipt.id})`, 'success');
      setActive(null);
    } catch {
      setSendError('The recommendation was not recorded. Nothing has changed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function approve(d: DirectiveReceipt) {
    try {
      const r = await api.approveDirective(d.id);
      setIssued((l) => l.map((x) => (x.id === r.id ? r : x)));
      toast(`Approved (${r.id})`, 'success');
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? 'A different policy officer must approve this directive.' : 'Could not approve. Please try again.', 'error');
    }
  }

  async function exportPdf(d: DirectiveReceipt) {
    try {
      const { blob, filename } = await api.exportDirective(d.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Signed advisory downloaded (${d.id}). Send it through official channels.`, 'success');
    } catch (e) {
      toast(e instanceof ApiError && e.message ? e.message : 'Export failed. Please try again.', 'error');
    }
  }

  const last = issued[0];
  return (
    <>
      <nav aria-label="Directive toolbar" className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-3xl bg-navy p-3 text-white shadow-2xl">
        <span className="px-2 text-xs font-bold uppercase tracking-widest text-air-400">Directives</span>
        {BUTTONS.map((b) => (
          <button key={b.type} type="button" className={`btn ${b.tone === 'danger' ? 'btn-danger' : ''} !whitespace-normal !py-2 text-left`} onClick={() => { setSendError(null); setActive(b.type); }}>
            {b.icon}<span>{b.label}</span>
          </button>
        ))}
        <div className="ml-auto text-xs text-air-200" aria-live="polite">
          {last ? <>Last: <b>{last.type.replace(/_/g, ' ')}</b> recorded {formatTime(last.issuedAt)} · <span className="mono">{last.id}</span></> : 'No directive sent this session.'}
        </div>
        {issued.length > 0 && (
          <ul className="m-0 flex w-full list-none flex-col gap-2 p-0" aria-label="Directives recorded this session">
            {issued.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/10 px-3 py-2 text-sm" data-testid="directive-row" data-status={d.status}>
                <span className="mono">{d.id}</span>
                <span className="font-semibold">{d.type.replace(/_/g, ' ')}</span>
                <span className="chip" style={{ background: d.status === 'approved' ? '#E3F8EE' : '#FFF3D6', color: d.status === 'approved' ? '#0B5C3E' : '#7A4B00' }}>
                  {d.status === 'approved' ? 'Approved' : 'Waiting for a second policy officer'}
                </span>
                {d.status === 'pending_approval' && <button type="button" className="btn !min-h-9" onClick={() => void approve(d)}>Approve</button>}
                <button type="button" className="btn btn-primary !min-h-9 ml-auto" disabled={!canExport(d, exportEnabled)} onClick={() => void exportPdf(d)}
                  title={!exportEnabled ? 'Advisory export is switched off (ADVISORY_EXPORT_ENABLED)' : d.status !== 'approved' ? 'Available after approval' : undefined}>
                  Export signed PDF
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <ConfirmDialog
        open={active !== null}
        title={preview.status === 'success' && preview.data ? preview.data.title : 'Confirm directive'}
        confirmLabel="Record recommendation"
        tone={active === 'grap_ii' ? 'danger' : 'primary'}
        busy={busy}
        confirmDisabled={preview.status !== 'success'}
        onConfirm={confirm}
        onCancel={() => setActive(null)}
      >
        <AsyncBoundary state={preview} onRetry={preview.reload} what="the directive details">
          {(p) => p && (
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-ink-mute">Action</div>
                <p className="m-0">{p.action}</p>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-ink-mute">Affected area ({p.affectedAreas.length})</div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {p.affectedAreas.map((a) => (
                    <li key={a.id} className="rounded-xl bg-air-50 px-3 py-2"><b>{a.name}</b><div className="text-xs text-ink-soft">{a.detail}</div></li>
                  ))}
                </ul>
              </div>
              <p className="m-0 rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn-fg">{p.note}</p>
              {sendError && <p role="alert" className="m-0 font-semibold text-danger">{sendError}</p>}
            </div>
          )}
        </AsyncBoundary>
      </ConfirmDialog>
    </>
  );
}
