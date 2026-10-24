import type { BookingReceipt, KeyAction } from '@/api/contract';

/** Menu keys: 1 machine, 2 straw pickup, 9 talk to an FPO worker. */
export const KEYS: readonly KeyAction[] = ['1', '2', '9'];
/** Second step: 1 confirms the choice, 0 goes back to the menu. */
export const CONFIRM_KEY = '1';
export const BACK_KEY = '0';
export const isKeyAction = (k: string): k is KeyAction => (KEYS as readonly string[]).includes(k);

export type KeypadState =
  | { status: 'idle'; note?: 'back' }
  | { status: 'confirming'; key: KeyAction }
  | { status: 'pending'; key: KeyAction }
  | { status: 'confirmed'; key: KeyAction; referenceId: string; connecting: boolean }
  | { status: 'error'; key: KeyAction };

export type KeypadAction =
  | { type: 'choose'; key: KeyAction }
  | { type: 'confirm' }
  | { type: 'back' }
  | { type: 'success'; receipt: BookingReceipt }
  | { type: 'failure' }
  | { type: 'reset' };

/**
 * Two-step keypad, like a real phone menu.
 *  1. Choose: 1, 2 or 9. Nothing is booked yet; the call reads back the choice.
 *  2. Confirm with 1, or go back with 0. Only the confirming 1 makes the API call.
 * Rules: presses are ignored while a request is in flight (no double booking from a nervous double tap); choosing a key that
 * is already confirmed is ignored (idempotent); after an error the farmer chooses again.
 * Returning the *same* state object means "ignored", which callers use to skip side effects.
 */
export function keypadReducer(state: KeypadState, action: KeypadAction): KeypadState {
  switch (action.type) {
    case 'choose':
      if (state.status === 'pending' || state.status === 'confirming') return state;
      if (state.status === 'confirmed' && state.key === action.key) return state;
      return { status: 'confirming', key: action.key };
    case 'confirm':
      return state.status === 'confirming' ? { status: 'pending', key: state.key } : state;
    case 'back':
      return state.status === 'confirming' ? { status: 'idle', note: 'back' } : state;
    case 'success':
      if (state.status !== 'pending' || state.key !== action.receipt.key) return state;
      return { status: 'confirmed', key: action.receipt.key, referenceId: action.receipt.referenceId, connecting: action.receipt.status === 'connecting' };
    case 'failure':
      return state.status === 'pending' ? { status: 'error', key: state.key } : state;
    case 'reset':
      return { status: 'idle' };
  }
}

/** What a typed or tapped digit means in the current step (null: the digit does nothing here). */
export function digitAction(state: KeypadState, digit: string): KeypadAction | null {
  if (state.status === 'confirming') {
    if (digit === CONFIRM_KEY) return { type: 'confirm' };
    if (digit === BACK_KEY) return { type: 'back' };
    return null;
  }
  return isKeyAction(digit) ? { type: 'choose', key: digit } : null;
}
