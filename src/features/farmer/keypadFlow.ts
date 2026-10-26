import type { BookingReceipt, KeyAction, SeederType } from '@/api/contract';

/** Menu keys: 1 machine, 2 straw pickup, 9 talk to an FPO worker. */
export const KEYS: readonly KeyAction[] = ['1', '2', '9'];
/** After menu 1, which machine: 1 Super Seeder, 2 Happy Seeder. */
export const MACHINE_KEYS: Readonly<Record<string, SeederType>> = { '1': 'super_seeder', '2': 'happy_seeder' };
/** Confirm step: 1 confirms the choice, 0 goes back to the menu (0 also leaves the machine step). */
export const CONFIRM_KEY = '1';
export const BACK_KEY = '0';
/** * repeats what the farmer is being asked (the whole call message at the menu). */
export const REPEAT_KEY = '*';
export const isKeyAction = (k: string): k is KeyAction => (KEYS as readonly string[]).includes(k);

/** What the farmer has chosen: a menu key, plus the machine for key 1. */
export interface Choice { key: KeyAction; machine?: SeederType }
export type Step = 'menu' | 'machine' | 'confirm';

export type KeypadState =
  | { status: 'idle'; note?: 'back' }
  | { status: 'machine' }
  | ({ status: 'confirming' } & Choice)
  | ({ status: 'pending' } & Choice)
  | ({ status: 'confirmed'; referenceId: string; connecting: boolean } & Choice)
  | ({ status: 'error' } & Choice);

export type KeypadAction =
  | { type: 'openMachines' }
  | ({ type: 'choose' } & Choice)
  | { type: 'confirm' }
  | { type: 'back' }
  | { type: 'repeat' }
  | { type: 'success'; receipt: BookingReceipt }
  | { type: 'failure' }
  | { type: 'reset' };

/** Which step the keypad is on, for prompts and the * repeat. */
export function stepOf(state: KeypadState): Step {
  return state.status === 'machine' ? 'machine' : state.status === 'confirming' ? 'confirm' : 'menu';
}

/**
 * Keypad, like a real phone menu.
 *  1. Menu: 1, 2 or 9. After 1 the farmer picks the machine: 1 Super Seeder, 2 Happy Seeder (0 goes back).
 *  2. Nothing is booked yet; the call reads back the choice. Confirm with 1, or go back to the menu with 0.
 *     Only the confirming 1 makes the API call.
 *  * at any step repeats the prompt and changes nothing.
 * Rules: presses are ignored while a request is in flight (no double booking from a nervous double tap); choosing what is
 * already confirmed is ignored (idempotent); after an error the farmer chooses again.
 * Returning the *same* state object means "ignored" (or, for `repeat`, "no change"), which callers use to skip side effects.
 */
export function keypadReducer(state: KeypadState, action: KeypadAction): KeypadState {
  switch (action.type) {
    case 'openMachines':
      if (state.status !== 'idle' && state.status !== 'confirmed' && state.status !== 'error') return state;
      if (state.status === 'confirmed' && state.key === '1') return state; // a machine is already booked on this call
      return { status: 'machine' };
    case 'choose': {
      if (state.status === 'pending' || state.status === 'confirming') return state;
      if ((action.key === '1') !== (state.status === 'machine')) return state; // key 1 goes through the machine step, 2 and 9 do not
      if (state.status === 'confirmed' && state.key === action.key && state.machine === action.machine) return state;
      return action.machine ? { status: 'confirming', key: action.key, machine: action.machine } : { status: 'confirming', key: action.key };
    }
    case 'confirm':
      return state.status === 'confirming' ? withChoice('pending', state) : state;
    case 'back':
      return state.status === 'confirming' || state.status === 'machine' ? { status: 'idle', note: 'back' } : state;
    case 'repeat':
      return state;
    case 'success':
      if (state.status !== 'pending' || state.key !== action.receipt.key) return state;
      if (action.receipt.machine && state.machine && action.receipt.machine !== state.machine) return state;
      return { ...withChoice('confirmed', state), referenceId: action.receipt.referenceId, connecting: action.receipt.status === 'connecting' };
    case 'failure':
      return state.status === 'pending' ? withChoice('error', state) : state;
    case 'reset':
      return { status: 'idle' };
  }
}

function withChoice<S extends 'pending' | 'confirmed' | 'error'>(status: S, c: Choice): { status: S } & Choice {
  return c.machine ? { status, key: c.key, machine: c.machine } : { status, key: c.key };
}

/** What a typed or tapped digit means in the current step (null: the digit does nothing here). */
export function digitAction(state: KeypadState, digit: string): KeypadAction | null {
  if (digit === REPEAT_KEY) return state.status === 'pending' ? null : { type: 'repeat' };
  if (state.status === 'machine') {
    const machine = MACHINE_KEYS[digit];
    if (machine) return { type: 'choose', key: '1', machine };
    return digit === BACK_KEY ? { type: 'back' } : null;
  }
  if (state.status === 'confirming') {
    if (digit === CONFIRM_KEY) return { type: 'confirm' };
    if (digit === BACK_KEY) return { type: 'back' };
    return null;
  }
  if (digit === '1') return { type: 'openMachines' };
  return isKeyAction(digit) ? { type: 'choose', key: digit } : null;
}
