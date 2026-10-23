import { useEffect, useRef, useState } from 'react';
import type { CitizenArea } from '@/api/contract';
import { AqiBadge } from '@/design/AqiBadge';
import { IconPin } from '@/design/Icons';
import { useI18n } from '@/i18n';

export function LocationHeader({ areas, areaId, onChange, title, aqiById = {} }: { areas: CitizenArea[]; areaId: string; onChange: (id: string) => void; title: string; aqiById?: Record<string, number> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const current = areas.find((a) => a.id === areaId);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) { if (typeof el.showModal === 'function') el.showModal(); else el.setAttribute('open', ''); }
    if (!open && el.open) { if (typeof el.close === 'function') el.close(); else el.removeAttribute('open'); }
  }, [open]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-leaf-700 shadow"><IconPin /></div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-ink-soft">{t('cz.location')}</div>
        <div className="truncate font-display text-lg font-bold leading-tight" data-testid="area-name">{current?.name ?? title}</div>
      </div>
      <button type="button" className="btn btn-ghost !bg-white" onClick={() => setOpen(true)} aria-haspopup="dialog">{t('cz.change')}</button>

      <dialog ref={ref} aria-labelledby="area-dialog-title" onClose={() => setOpen(false)} onClick={(e) => { if (e.target === ref.current) setOpen(false); }}
        className="m-auto w-[min(420px,calc(100vw-24px))] rounded-3xl border-0 p-0 text-ink shadow-2xl">
        <form method="dialog" className="flex flex-col gap-3 p-5" onSubmit={(e) => e.preventDefault()}>
          <h2 id="area-dialog-title" className="text-lg font-bold">{t('cz.chooseArea')}</h2>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">{t('cz.chooseArea')}</legend>
            {areas.map((a) => (
              <label key={a.id} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-2" style={{ borderColor: a.id === areaId ? '#0B7A53' : 'rgb(11 29 51 / 0.12)', background: a.id === areaId ? '#E3F8EE' : '#fff' }}>
                <input type="radio" name="area" value={a.id} checked={a.id === areaId} onChange={() => { onChange(a.id); setOpen(false); }} className="h-5 w-5 accent-[#0B7A53]" />
                <span className="flex-1"><b>{a.name}</b><span className="block text-xs text-ink-soft">{a.detail}</span></span>
                {aqiById[a.id] !== undefined && <AqiBadge aqi={aqiById[a.id]} size="sm" showLabel={false} />}
              </label>
            ))}
          </fieldset>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>{t('cz.close')}</button>
        </form>
      </dialog>
    </div>
  );
}
