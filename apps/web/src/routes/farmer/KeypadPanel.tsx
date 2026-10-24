import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { BookingReceipt, KeyAction } from '@/api/contract';
import { IconCheck, IconSpinner } from '@/design-system/Icons';
import { useI18n, type MessageKey } from '@/i18n';
import { BACK_KEY, CONFIRM_KEY, KEYS, digitAction, keypadReducer, type KeypadState } from './keypadFlow';

interface Props {
  /** performs the booking API call; called only after the farmer confirms with 1 */
  book: (key: KeyAction) => Promise<BookingReceipt>;
  /** keypad tone, called on every accepted press (including 0) */
  onTone?: (digit: string) => void;
  /** called when a menu key is chosen, e.g. to speak "You chose ... Press 1 to confirm" */
  onChoose?: (key: KeyAction) => void;
  /** called when the farmer presses 0 to go back */
  onBack?: () => void;
  /** called once the booking succeeds, e.g. to speak the confirmation */
  onConfirmed?: (key: KeyAction, receipt: BookingReceipt) => void;
  /** null when no active partner contract backs the rate: the key is shown without a price */
  prices: { superSeederPerAcre: number | null; strawPerTonne: number | null };
}

const META: Record<KeyAction, { label: MessageKey; done: MessageKey }> = {
  '1': { label: 'farmer.key1', done: 'farmer.done1' },
  '2': { label: 'farmer.key2', done: 'farmer.done2' },
  '9': { label: 'farmer.key9', done: 'farmer.done9' },
};

const Digit = ({ children, bg }: { children: ReactNode; bg: string }) => (
  <span className="mono flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-3xl font-bold" style={{ background: bg, color: '#fff' }} aria-hidden="true">{children}</span>
);

export function KeypadPanel({ book, onTone, onChoose, onBack, onConfirmed, prices }: Props) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(keypadReducer, { status: 'idle' } as KeypadState);
  const [receipt9, setReceipt9] = useState<BookingReceipt | null>(null);
  const live = useRef<KeypadState>(state);
  live.current = state;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const press = useCallback(async (digit: string) => {
    const action = digitAction(live.current, digit);
    if (!action) return;
    const next = keypadReducer(live.current, action);
    if (next === live.current) return; // ignored: in flight, or already confirmed
    live.current = next;
    dispatch(action);
    onTone?.(digit);
    if (action.type === 'choose') { onChoose?.(action.key); return; }
    if (action.type === 'back') { onBack?.(); return; }
    if (next.status !== 'pending') return;
    const key = next.key;
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
  }, [book, onTone, onChoose, onBack, onConfirmed]);

  // move focus with the step so keyboard and screen-reader users land on the next thing to press
  const confirming = state.status === 'confirming';
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (state.status === 'idle' && state.note === 'back') groupRef.current?.querySelector<HTMLButtonElement>('[data-key="1"]')?.focus();
  }, [confirming, state]);

  // keyboard: digits work like the on-screen keys (1/2/9, then 1 or 0)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (digitAction(live.current, e.key)) { e.preventDefault(); void press(e.key); }
  };

  // key 9: what the FPO desk could actually offer (ADR-22): a live queue, a callback slot, or no promised time
  const fpoWorkerMessage = (r: BookingReceipt): string =>
    r.status === 'queued' ? t('farmer.done9.queued')
    : r.status === 'callback_slot' && r.slot ? t('farmer.done9.slot', { time: r.slot.start })
    : r.status === 'callback_unscheduled' ? t('farmer.done9.noTime')
    : t('farmer.done9');
  const message =
    state.status === 'confirming' ? t('farmer.confirmPrompt')
    : state.status === 'pending' ? t('farmer.pending')
    : state.status === 'confirmed' ? (state.key === '9' && receipt9 ? fpoWorkerMessage(receipt9) : t(META[state.key].done))
    : state.status === 'error' ? t('farmer.error')
    : state.note === 'back' ? t('farmer.backNote')
    : '';

  const priceText = (k: KeyAction) => k === '1' ? (prices.superSeederPerAcre === null ? t('farmer.key1.noPrice') : t('farmer.key1.sub', { price: prices.superSeederPerAcre }))
    : k === '2' ? (prices.strawPerTonne === null ? t('farmer.key2.noPrice') : t('farmer.key2.sub', { price: prices.strawPerTonne.toLocaleString('en-IN') })) : t('farmer.key9.sub');
  const keyBtn = 'flex min-h-[76px] w-full items-center gap-4 rounded-3xl border-2 px-4 py-3 text-left transition-colors disabled:opacity-50';

  return (
    <div ref={groupRef} role="group" aria-label={t('farmer.keypad')} onKeyDown={onKeyDown} className="flex flex-col gap-3">
      <p className="m-0 text-sm text-[#C9DDF0]">{t('farmer.keypadHint')}</p>
      {state.status === 'confirming' ? (
        <section aria-label={t('farmer.youChose')} className="flex flex-col gap-3 rounded-3xl bg-white/10 p-3" data-testid="confirm-step">
          <p className="m-0 px-1 text-center text-base text-[#C9DDF0]">
            {t('farmer.youChose')}: <span className="font-bold text-white">{t(META[state.key].label)}</span>
          </p>
          <button
            ref={confirmRef}
            type="button"
            data-confirm={CONFIRM_KEY}
            aria-label={`${t('farmer.press', { key: CONFIRM_KEY })}: ${t('farmer.confirm')}, ${t(META[state.key].label)}`}
            onClick={() => void press(CONFIRM_KEY)}
            className={keyBtn}
            style={{ background: '#0B7A53', color: '#FFFFFF', borderColor: '#34D399' }}
          >
            <Digit bg="rgb(255 255 255 / 0.18)">{CONFIRM_KEY}</Digit>
            <span className="text-xl font-bold leading-tight">{t('farmer.confirm')}</span>
          </button>
          <button
            type="button"
            data-confirm={BACK_KEY}
            aria-label={`${t('farmer.press', { key: BACK_KEY })}: ${t('farmer.back')}`}
            onClick={() => void press(BACK_KEY)}
            className={keyBtn}
            style={{ background: '#FFFFFF', color: '#0B1D33', borderColor: 'transparent' }}
          >
            <Digit bg="#0F2A47">{BACK_KEY}</Digit>
            <span className="text-xl font-bold leading-tight">{t('farmer.back')}</span>
          </button>
        </section>
      ) : (
        KEYS.map((k) => {
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
              className={keyBtn}
              style={{
                background: confirmed ? '#0B7A53' : failed ? '#8A1C1C' : '#FFFFFF',
                color: confirmed || failed ? '#FFFFFF' : '#0B1D33',
                borderColor: confirmed ? '#34D399' : failed ? '#FCA5A5' : 'transparent',
              }}
            >
              <Digit bg={confirmed || failed ? 'rgb(255 255 255 / 0.18)' : '#0F2A47'}>
                {pending ? <IconSpinner size={28} /> : confirmed ? <IconCheck size={30} /> : k}
              </Digit>
              <span className="flex flex-col">
                <span className="text-lg font-bold leading-tight">{t(META[k].label)}</span>
                <span className="mono text-sm font-semibold" style={{ opacity: 0.85 }}>{priceText(k)}</span>
              </span>
            </button>
          );
        })
      )}
      <div role="status" aria-live="assertive" className="min-h-[3.25rem] rounded-2xl px-4 py-3 text-base font-semibold" style={{ background: state.status === 'error' ? '#FDE8E8' : state.status === 'confirmed' ? '#E3F8EE' : state.status === 'confirming' ? '#FFF6DB' : 'transparent', color: state.status === 'error' ? '#8A1C1C' : state.status === 'confirming' ? '#5C4300' : state.status === 'idle' ? '#C9DDF0' : '#0B5C3E' }} data-testid="keypad-status">
        {message}
        {state.status === 'confirmed' && <span className="mono ml-2 text-sm font-normal">{t('farmer.ref')}: {state.referenceId}</span>}
      </div>
    </div>
  );
}
