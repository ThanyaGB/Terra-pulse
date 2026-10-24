import { useEffect, useId, useRef, type ReactNode } from 'react';
import { popIn } from './motion';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

/** Native <dialog>: focus trap, Esc to close and focus return come from the browser. */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'Cancel', busy, confirmDisabled, tone = 'primary', onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
      popIn(el);
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      onClick={(e) => { if (e.target === ref.current && !busy) onCancel(); }}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-3xl border-0 bg-dialog p-0 text-ink shadow-2xl"
    >
      {open && (
        <div className="flex flex-col gap-4 p-6">
          <h2 id={titleId} className="text-xl font-bold">{title}</h2>
          <div className="text-sm">{children}</div>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
            <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy || confirmDisabled}>
              {busy ? 'Sending…' : confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
