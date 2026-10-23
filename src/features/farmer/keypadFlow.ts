import type { BookingReceipt, KeyAction } from '@/api/contract';

export const KEYS: readonly KeyAction[] = ['1', '2', '9'];
export const isKeyAction = (k: string): k is KeyAction => (KEYS as readonly string[]).includes(k);

export type KeypadState =
  | { status: 'idle' }
  | { status: 'pending'; key: KeyAction }
  | { status: 'confirmed'; key: KeyAction; referenceId: string; connecting: boolean }
  | { status: 'error'; key: KeyAction };

export type KeypadAction =
  | { type: 'press'; key: KeyAction }
  | { type: 'success'; receipt: BookingReceipt }
  | { type: 'failure' }
  | { type: 'reset' };

/**
 * Keypad state machine.
 *  - presses are ignored while a booking is in flight (no double-booking from a nervous double tap)
 *  - re-pressing a key that is already confirmed is ignored (idempotent)
 *  - an error can be retried by pressing again
 * Returning the *same* state object means "ignored", which callers use to skip the API call.
 */
export function keypadReducer(state: KeypadState, action: KeypadAction): KeypadState {
  switch (action.type) {
    case 'press':
      if (state.status === 'pending') return state;
      if (state.status === 'confirmed' && state.key === action.key) return state;
      return { status: 'pending', key: action.key };
    case 'success':
      if (state.status !== 'pending' || state.key !== action.receipt.key) return state;
      return { status: 'confirmed', key: action.receipt.key, referenceId: action.receipt.referenceId, connecting: action.receipt.status === 'connecting' };
    case 'failure':
      return state.status === 'pending' ? { status: 'error', key: state.key } : state;
    case 'reset':
      return { status: 'idle' };
  }
}
