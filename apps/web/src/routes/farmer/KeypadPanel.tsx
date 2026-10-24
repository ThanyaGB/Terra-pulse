import { useCallback, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import type { BookingReceipt, KeyAction } from '@/api/contract';
import { IconCheck, IconSpinner } from '@/design-system/Icons';
import { useI18n, type MessageKey } from '@/i18n';
import { KEYS, isKeyAction, keypadReducer, type KeypadState } from './keypadFlow';

interface Props {
  /** performs the booking API call */
  book: (key: KeyAction) => Promise<BookingReceipt>;
  /** keypad tone, called on every accepted press */
  onTone?: (key: KeyAction) => void;
  /** called once the booking succeeds, e.g. to speak the confirmation */
  onConfirmed?: (key: KeyAction, receipt: BookingReceipt) => void;
  /** null when no active partner contract backs the rate: the key is shown without a price */
  prices: { superSeederPerAcre: number | null; strawPerTonne: number | null };
}

const META: Record<KeyAction, { label: MessageKey; sub: MessageKey; done: MessageKey }> = {
  '1': { label: 'farmer.key1', sub: 'farmer.key1.sub', done: 'farmer.done1' },
  '2': { label: 'farmer.key2', sub: 'farmer.key2.sub', done: 'farmer.done2' },
  '9': { label: 'farmer.key9', sub: 'farmer.key9.sub', done: 'farmer.done9' },
};

export function KeypadPanel({ book, onTone, onConfirmed, prices }: Props) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(keypadReducer, { status: 'idle' } as KeypadState);
  const [receipt9, setReceipt9] = useState<BookingReceipt | null>(null);
  const live = useRef<KeypadState>(state);
  live.current = state;

  const press = useCallback(async (key: KeyAction) => {
    const next = keypadReducer(live.current, { type: 'press', key });
    if (next === live.current) return; // ignored: already pending or already confirmed
    live.current = next;
    dispatch({ type: 'press', key });
    onTone?.(key);
    try {
      const receipt = await book(key);
      live.current = keypadReducer(live.current, { type: 'success', receipt });
      dispatch({ type: 'success', receipt });
      if (key === '9') setReceipt9(receipt);
      onConfirmed?.(key, receipt);
    } catch {
      live.current = keypadReducer(live.current, { type: 'failure' });
      dispatch({ type: 'failure' });
    }
  }, [book, onTone, onConfirmed]);

  // keyboard: pressing 1, 2 or 9 anywhere in the panel works like the on-screen key
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isKeyAction(e.key)) { e.preventDefault(); void press(e.key); }
  };

  const agronomistMessage = (r: BookingReceipt): string =>
    r.status === 'queued' ? t('farmer.done9.queued')
    : r.status === 'callback_slot' && r.slot ? t('farmer.done9.slot', { time: r.slot.start })
    : r.status === 'callback_unscheduled' ? t('farmer.done9.noTime')
    : t('farmer.done9');
  const message =
    state.status === 'pending' ? t('farmer.pending')
    : state.status === 'confirmed' ? (state.key === '9' && receipt9 ? agronomistMessage(receipt9) : t(META[state.key].done))
    : state.status === 'error' ? t('farmer.error')
    : '';

  const priceText = (k: KeyAction) => k === '1' ? (prices.superSeederPerAcre === null ? t('farmer.key1.noPrice') : t('farmer.key1.sub', { price: prices.superSeederPerAcre }))
    : k === '2' ? (prices.strawPerTonne === null ? t('farmer.key2.noPrice') : t('farmer.key2.sub', { price: prices.strawPerTonne.toLocaleString('en-IN') })) : t(META[k].sub);

  return (
    <div role="group" aria-label={t('farmer.keypad')} onKeyDown={onKeyDown} className="flex flex-col gap-3">
      <p className="m-0 text-sm text-[#C9DDF0]">{t('farmer.keypadHint')}</p>
      {KEYS.map((k) => {
        const isThis = 'key' in state && state.key === k;
        const pending = state.status === 'pending' && isThis;
        const confirmed = state.status === 'confirmed' && isThis;
        const failed = state.status === 'error' && isThis;
        return (
          <button
            key={k}
            type="button"
            data-key={k}
            data-state={pending ? 'pending' : confirmed ? 'confirmed' : failed ? 'error' : 'idle'}
            disabled={state.status === 'pending' && !isThis}
            aria-busy={pending}
            aria-label={`${t('farmer.press', { key: k })}: ${t(META[k].label)}, ${priceText(k)}`}
            onClick={() => void press(k)}
            className="flex min-h-[76px] items-center gap-4 rounded-3xl border-2 px-4 py-3 text-left transition-colors disabled:opacity-50"
            style={{
              background: confirmed ? '#0B7A53' : failed ? '#8A1C1C' : '#FFFFFF',
              color: confirmed || failed ? '#FFFFFF' : '#0B1D33',
              borderColor: confirmed ? '#34D399' : failed ? '#FCA5A5' : 'transparent',
            }}
          >
            <span className="mono flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-3xl font-bold" style={{ background: confirmed || failed ? 'rgb(255 255 255 / 0.18)' : '#0F2A47', color: '#fff' }} aria-hidden="true">
              {pending ? <IconSpinner size={28} /> : confirmed ? <IconCheck size={30} /> : k}
            </span>
            <span className="flex flex-col">
              <span className="text-lg font-bold leading-tight">{t(META[k].label)}</span>
              <span className="mono text-sm font-semibold" style={{ opacity: 0.85 }}>{priceText(k)}</span>
            </span>
          </button>
        );
      })}
      <div role="status" aria-live="assertive" className="min-h-[3.25rem] rounded-2xl px-4 py-3 text-base font-semibold" style={{ background: state.status === 'error' ? '#FDE8E8' : state.status === 'confirmed' ? '#E3F8EE' : 'transparent', color: state.status === 'error' ? '#8A1C1C' : '#0B5C3E' }} data-testid="keypad-status">
        {message}
        {state.status === 'confirmed' && <span className="mono ml-2 text-sm font-normal">{t('farmer.ref')}: {state.referenceId}</span>}
      </div>
    </div>
  );
}
