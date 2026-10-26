import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import type { BookingReceipt, KeyAction, SeederType } from '@/api/contract';
import { IconCheck, IconSpinner } from '@/design/Icons';
import { useI18n, type MessageKey } from '@/i18n';
import { BACK_KEY, CONFIRM_KEY, MACHINE_KEYS, REPEAT_KEY, digitAction, keypadReducer, stepOf, type Choice, type KeypadState, type Step } from './keypadFlow';

interface Props {
  /** performs the booking API call; called only after the farmer confirms with 1 */
  book: (choice: Choice) => Promise<BookingReceipt>;
  /** keypad tone, called on every press (every key beeps, like a real phone) */
  onTone?: (digit: string) => void;
  /** called after menu key 1, e.g. to speak "Press 1 for the Super Seeder, 2 for the Happy Seeder" */
  onMachineMenu?: () => void;
  /** called when a choice is made, e.g. to speak "You chose ... Press 1 to confirm" */
  onChoose?: (choice: Choice) => void;
  /** called when the farmer presses 0 to go back */
  onBack?: () => void;
  /** called on *: repeat what this step asks (the whole call message at the menu) */
  onRepeat?: (step: Step, choice?: Choice) => void;
  /** called once the booking succeeds, e.g. to speak the confirmation */
  onConfirmed?: (choice: Choice, receipt: BookingReceipt) => void;
  prices: { superSeederPerAcre: number; strawPerTonne: number };
}

const META: Record<KeyAction, { label: MessageKey; short: MessageKey; done: MessageKey }> = {
  '1': { label: 'farmer.key1', short: 'farmer.key1.short', done: 'farmer.done1' },
  '2': { label: 'farmer.key2', short: 'farmer.key2.short', done: 'farmer.done2' },
  '9': { label: 'farmer.key9', short: 'farmer.key9.short', done: 'farmer.done9' },
};
const MACHINE_META: Record<SeederType, { label: MessageKey; short: MessageKey }> = {
  super_seeder: { label: 'farmer.mSuper', short: 'farmer.mSuper.short' },
  happy_seeder: { label: 'farmer.mHappy', short: 'farmer.mHappy.short' },
};
/** The name of a choice as the farmer hears it: the machine for key 1, otherwise the menu option. */
const choiceLabel = (c: Choice): MessageKey => (c.machine ? MACHINE_META[c.machine].label : META[c.key].label);

/** Standard phone layout. */
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const;

type Tone = 'menu' | 'confirm' | 'back' | 'repeat' | 'done' | 'error' | 'off';

export function KeypadPanel({ book, onTone, onMachineMenu, onChoose, onBack, onRepeat, onConfirmed, prices }: Props) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(keypadReducer, { status: 'idle' } as KeypadState);
  const [note, setNote] = useState<'dead' | 'repeat' | null>(null); // a dead key was pressed, or * replayed the message
  const live = useRef<KeypadState>(state);
  live.current = state;
  const groupRef = useRef<HTMLDivElement>(null);

  const press = useCallback(async (digit: string) => {
    const action = digitAction(live.current, digit);
    if (!action) { onTone?.(digit); setNote('dead'); return; } // beeps like a real phone, but nothing happens
    if (action.type === 'repeat') {
      const s = live.current;
      onTone?.(digit);
      setNote('repeat');
      onRepeat?.(stepOf(s), s.status === 'confirming' ? { key: s.key, ...(s.machine ? { machine: s.machine } : {}) } : undefined);
      return;
    }
    const next = keypadReducer(live.current, action);
    if (next === live.current) return; // ignored: in flight, or already confirmed
    setNote(null);
    live.current = next;
    dispatch(action);
    onTone?.(digit);
    if (action.type === 'openMachines') { onMachineMenu?.(); return; }
    if (action.type === 'choose') { onChoose?.(action.machine ? { key: action.key, machine: action.machine } : { key: action.key }); return; }
    if (action.type === 'back') { onBack?.(); return; }
    if (next.status !== 'pending') return;
    const choice: Choice = next.machine ? { key: next.key, machine: next.machine } : { key: next.key };
    try {
      const receipt = await book(choice);
      live.current = keypadReducer(live.current, { type: 'success', receipt });
      dispatch({ type: 'success', receipt });
      onConfirmed?.(choice, receipt);
    } catch {
      live.current = keypadReducer(live.current, { type: 'failure' });
      dispatch({ type: 'failure' });
    }
  }, [book, onTone, onMachineMenu, onChoose, onBack, onRepeat, onConfirmed]);

  // move focus with the step so keyboard and screen-reader users land on the next key to press
  const focusStep = state.status === 'confirming' || state.status === 'machine' ? state.status : null;
  useEffect(() => {
    if (focusStep) groupRef.current?.querySelector<HTMLButtonElement>(`[data-key="${CONFIRM_KEY}"]`)?.focus();
  }, [focusStep]);

  // physical keyboard: digits, * and # work like the on-screen keys
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((PAD as readonly string[]).includes(e.key)) { e.preventDefault(); void press(e.key); }
  };

  const message =
    state.status === 'machine' ? t('farmer.machinePrompt')
    : state.status === 'confirming' ? t('farmer.confirmPrompt')
    : state.status === 'pending' ? t('farmer.pending')
    : state.status === 'confirmed' ? t(META[state.key].done)
    : state.status === 'error' ? t('farmer.error')
    : note === 'dead' ? t('farmer.deadKey')
    : note === 'repeat' ? t('farmer.repeatNote')
    : state.note === 'back' ? t('farmer.backNote')
    : '';

  const priceText = (k: KeyAction) => k === '1' ? t('farmer.key1.sub') : k === '2' ? t('farmer.key2.sub', { price: prices.strawPerTonne.toLocaleString('en-IN') }) : t('farmer.key9.sub');

  /** What one key looks like and says in the current step. */
  const keyInfo = (d: string): { label: string; sub: string; active: boolean; tone: Tone; busy: boolean } => {
    const off = { label: t('farmer.press', { key: d }), sub: '', active: false, tone: 'off' as const, busy: false };
    if (d === REPEAT_KEY) {
      if (state.status === 'pending') return off;
      return { label: `${t('farmer.press', { key: d })}: ${t('farmer.repeat')}`, sub: t('farmer.repeat.short'), active: true, tone: 'repeat', busy: false };
    }
    if (d === BACK_KEY && (state.status === 'confirming' || state.status === 'machine')) {
      return { label: `${t('farmer.press', { key: d })}: ${t('farmer.back')}`, sub: t('farmer.back.short'), active: true, tone: 'back', busy: false };
    }
    if (state.status === 'machine') {
      const machine = MACHINE_KEYS[d];
      if (!machine) return off;
      const m = MACHINE_META[machine];
      const price = machine === 'super_seeder' ? `, ${t('farmer.mSuper.sub', { price: prices.superSeederPerAcre })}` : '';
      return { label: `${t('farmer.press', { key: d })}: ${t(m.label)}${price}`, sub: t(m.short), active: true, tone: 'menu', busy: false };
    }
    if (state.status === 'confirming') {
      if (d === CONFIRM_KEY) return { label: `${t('farmer.press', { key: d })}: ${t('farmer.confirm')}, ${t(choiceLabel(state))}`, sub: t('farmer.confirm.short'), active: true, tone: 'confirm', busy: false };
      return off;
    }
    if (d === '1' || d === '2' || d === '9') {
      const isThis = 'key' in state && state.key === d;
      const tone = state.status === 'confirmed' && isThis ? 'done' : state.status === 'error' && isThis ? 'error' : 'menu';
      return { label: `${t('farmer.press', { key: d })}: ${t(META[d].label)}, ${priceText(d)}`, sub: t(META[d].short), active: true, tone, busy: state.status === 'pending' && isThis };
    }
    return off;
  };

  const STYLE: Record<Tone, { bg: string; border: string; sub: string }> = {
    menu: { bg: 'rgb(16 185 129 / 0.16)', border: 'rgb(52 211 153 / 0.65)', sub: '#7EE0C0' },
    confirm: { bg: '#0B7A53', border: '#34D399', sub: '#D1FAE5' },
    back: { bg: 'rgb(251 191 36 / 0.16)', border: 'rgb(251 191 36 / 0.7)', sub: '#FCD9A8' },
    repeat: { bg: 'rgb(79 179 255 / 0.14)', border: 'rgb(143 211 255 / 0.6)', sub: '#B9E2FF' },
    done: { bg: '#0B7A53', border: '#34D399', sub: '#D1FAE5' },
    error: { bg: '#8A1C1C', border: '#FCA5A5', sub: '#FECACA' },
    off: { bg: 'rgb(255 255 255 / 0.06)', border: 'rgb(255 255 255 / 0.10)', sub: 'transparent' },
  };

  return (
    <div ref={groupRef} role="group" aria-label={t('farmer.keypad')} onKeyDown={onKeyDown} className="flex flex-col gap-3">
      {state.status === 'machine' && (
        <p className="m-0 rounded-2xl bg-white/10 px-4 py-2 text-center text-base font-bold text-white" data-testid="machine-step">
          {t('farmer.machineStep')}
        </p>
      )}
      {state.status === 'confirming' && (
        <p className="m-0 rounded-2xl bg-white/10 px-4 py-2 text-center text-base text-[#C9DDF0]" data-testid="confirm-step">
          {t('farmer.youChose')}: <span className="font-bold text-white">{t(choiceLabel(state))}</span>
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {PAD.map((d) => {
          const k = keyInfo(d);
          const s = STYLE[k.tone];
          const disabled = state.status === 'pending' && !k.busy;
          return (
            <button
              key={d}
              type="button"
              data-key={d}
              data-active={k.active}
              data-state={k.busy ? 'pending' : k.tone === 'done' ? 'confirmed' : k.tone === 'error' ? 'error' : 'idle'}
              disabled={disabled}
              aria-busy={k.busy}
              aria-label={k.label}
              onClick={() => void press(d)}
              className="flex min-h-[72px] flex-col items-center justify-center rounded-2xl border-2 px-1 py-2 text-white transition-colors active:scale-95 disabled:opacity-50"
              style={{ background: s.bg, borderColor: s.border }}
            >
              <span className="mono text-3xl font-bold leading-none" aria-hidden="true">
                {k.busy ? <IconSpinner size={26} /> : k.tone === 'done' ? <IconCheck size={28} /> : d}
              </span>
              <span className="mt-1 min-h-[1rem] text-center text-xs font-semibold leading-tight" style={{ color: s.sub }} aria-hidden="true">{k.sub}</span>
            </button>
          );
        })}
      </div>
      <div role="status" aria-live="assertive" className="min-h-[3.25rem] rounded-2xl px-4 py-3 text-base font-semibold" style={{ background: state.status === 'error' ? '#FDE8E8' : state.status === 'confirmed' ? '#E3F8EE' : state.status === 'confirming' || state.status === 'machine' ? '#FFF6DB' : 'transparent', color: state.status === 'error' ? '#8A1C1C' : state.status === 'confirming' || state.status === 'machine' ? '#5C4300' : state.status === 'idle' ? '#C9DDF0' : '#0B5C3E' }} data-testid="keypad-status">
        {message}
        {state.status === 'confirmed' && <span className="mono ml-2 text-sm font-normal">{t('farmer.ref')}: {state.referenceId}</span>}
      </div>
    </div>
  );
}
