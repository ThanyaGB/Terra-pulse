import { useState, type ReactNode } from 'react';
import { api } from '@/api/client';
import type { DirectiveReceipt, DirectiveType } from '@/api/contract';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { ConfirmDialog } from '@/design/ConfirmDialog';
import { IconAlert, IconTruck, IconWind } from '@/design/Icons';
import { useToast } from '@/design/Toast';
import { formatTime } from '@/lib/format';
import { recordOrder } from '@/lib/orders';

const BUTTONS: { type: DirectiveType; label: string; icon: ReactNode; tone: 'danger' | 'primary' }[] = [
  { type: 'grap_ii', label: 'Issue GRAP-II alert', icon: <IconAlert />, tone: 'danger' },
  { type: 'diversion_trucks', label: 'Issue diversion order for out-of-state diesel trucks', icon: <IconTruck />, tone: 'primary' },
  { type: 'fog_cannons', label: 'Deploy fog cannons on heavy-pollution corridors', icon: <IconWind />, tone: 'primary' },
];

/** Bottom toolbar. Nothing is sent until the operator confirms in the modal. */
export function DirectiveBar() {
  const [active, setActive] = useState<DirectiveType | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [issued, setIssued] = useState<DirectiveReceipt[]>([]);
  const { toast } = useToast();
  const preview = useAsync(() => (active ? api.getDirectivePreview(active) : Promise.resolve(null)), [active]);

  async function confirm() {
    if (!active || preview.status !== 'success' || !preview.data) return;
    setBusy(true);
    setSendError(null);
    try {
      const receipt = await api.issueDirective(active, preview.data.affectedAreas.map((a) => a.id));
      setIssued((l) => [receipt, ...l]);
      const made = recordOrder(receipt, preview.data.title);
      toast(`${preview.data.title}: queued (${receipt.id})${made ? ` · ${made} work orders sent to city teams (/ops)` : ''}`, 'success');
      setActive(null);
    } catch {
      setSendError('The directive was not sent. Nothing has changed. Please try again.');
    } finally {
      setBusy(false);
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
          {last ? <>Last: <b>{last.type.replace(/_/g, ' ')}</b> queued {formatTime(last.issuedAt)} · <span className="mono">{last.id}</span></> : 'No directive sent this session.'}
        </div>
      </nav>

      <ConfirmDialog
        open={active !== null}
        title={preview.status === 'success' && preview.data ? preview.data.title : 'Confirm directive'}
        confirmLabel="Send directive"
        tone={active === 'grap_ii' ? 'danger' : 'primary'}
        busy={busy}
        confirmDisabled={preview.status !== 'success' || !preview.data}
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
