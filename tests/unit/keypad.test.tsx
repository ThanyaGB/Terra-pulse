import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BookingReceipt, KeyAction } from '@/api/contract';
import { KeypadPanel } from '@/features/farmer/KeypadPanel';
import { digitAction, keypadReducer, type KeypadState } from '@/features/farmer/keypadFlow';
import { I18nProvider } from '@/i18n';

const prices = { superSeederPerAcre: 750, strawPerTonne: 1650 };
const receipt = (key: KeyAction): BookingReceipt => ({ referenceId: `BK-${key}`, key, status: key === '9' ? 'connecting' : 'confirmed' });

describe('keypadReducer (choose, then 1 to confirm or 0 to go back)', () => {
  const idle: KeypadState = { status: 'idle' };
  const choose = (s: KeypadState, key: KeyAction) => keypadReducer(s, { type: 'choose', key });
  const confirm = (s: KeypadState) => keypadReducer(s, { type: 'confirm' });

  it('goes idle -> confirming -> pending -> confirmed', () => {
    const asking = choose(idle, '1');
    expect(asking).toEqual({ status: 'confirming', key: '1' });
    const pending = confirm(asking);
    expect(pending).toEqual({ status: 'pending', key: '1' });
    expect(keypadReducer(pending, { type: 'success', receipt: receipt('1') })).toEqual({ status: 'confirmed', key: '1', referenceId: 'BK-1', connecting: false });
  });
  it('0 goes back to the menu without booking', () => {
    expect(keypadReducer(choose(idle, '2'), { type: 'back' })).toEqual({ status: 'idle', note: 'back' });
  });
  it('confirm and back do nothing outside the confirm step', () => {
    expect(confirm(idle)).toBe(idle);
    expect(keypadReducer(idle, { type: 'back' })).toBe(idle);
  });
  it('ignores presses while a booking is in flight', () => {
    const pending = confirm(choose(idle, '1'));
    expect(choose(pending, '2')).toBe(pending);
  });
  it('ignores a repeat choice of an already confirmed key, but allows a different key', () => {
    const done = keypadReducer(confirm(choose(idle, '1')), { type: 'success', receipt: receipt('1') });
    expect(choose(done, '1')).toBe(done);
    expect(choose(done, '2')).toEqual({ status: 'confirming', key: '2' });
  });
  it('marks key 9 as connecting rather than booked', () => {
    const s = keypadReducer(confirm(choose(idle, '9')), { type: 'success', receipt: receipt('9') });
    expect(s).toMatchObject({ status: 'confirmed', connecting: true });
  });
  it('can retry after an error', () => {
    const failed = keypadReducer(confirm(choose(idle, '2')), { type: 'failure' });
    expect(failed).toEqual({ status: 'error', key: '2' });
    expect(choose(failed, '2')).toEqual({ status: 'confirming', key: '2' });
  });
  it('drops a stale success for a different key', () => {
    const pending = confirm(choose(idle, '1'));
    expect(keypadReducer(pending, { type: 'success', receipt: receipt('2') })).toBe(pending);
  });
  it('maps digits by step: 1/2/9 at the menu, 1/0 while confirming', () => {
    expect(digitAction(idle, '9')).toEqual({ type: 'choose', key: '9' });
    expect(digitAction(idle, '0')).toBeNull();
    const asking = choose(idle, '2');
    expect(digitAction(asking, '1')).toEqual({ type: 'confirm' });
    expect(digitAction(asking, '0')).toEqual({ type: 'back' });
    expect(digitAction(asking, '9')).toBeNull();
  });
});

function setup(book = vi.fn(async (k: KeyAction) => receipt(k))) {
  const onTone = vi.fn();
  const onChoose = vi.fn();
  const onBack = vi.fn();
  const onConfirmed = vi.fn();
  const user = userEvent.setup();
  render(<I18nProvider initial="en"><KeypadPanel book={book} onTone={onTone} onChoose={onChoose} onBack={onBack} onConfirmed={onConfirmed} prices={prices} /></I18nProvider>);
  return { book, onTone, onChoose, onBack, onConfirmed, user };
}

describe('KeypadPanel flow', () => {
  it('shows a full 12-key phone pad; 1, 2 and 9 are the active, labelled menu keys', () => {
    setup();
    expect(screen.getByRole('button', { name: /Press 1: Book the machine, ₹750 per acre/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Press 2: Pick up my straw, ₹1,650 per tonne/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Press 9: Talk to an FPO worker/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Press 5' })).toHaveAttribute('data-active', 'false');
  });

  it('a key that does nothing beeps but books nothing', async () => {
    const { book, onTone, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Press 5' }));
    expect(onTone).toHaveBeenCalledWith('5');
    expect(book).not.toHaveBeenCalled();
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('That key does nothing here');
  });

  it('press 1 asks for confirmation; nothing is booked until 1 is pressed again', async () => {
    const { book, onTone, onChoose, onConfirmed, user } = setup();
    await user.click(screen.getByRole('button', { name: /Press 1: Book the machine/ }));
    expect(onTone).toHaveBeenCalledWith('1');
    expect(onChoose).toHaveBeenCalledWith('1');
    expect(book).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-step')).toHaveTextContent('You chose: Book the machine');
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('Press 1 to confirm, or 0 to go back.');
    await user.click(screen.getByRole('button', { name: /Press 1: Yes, confirm/ }));
    expect(book).toHaveBeenCalledTimes(1);
    expect(book).toHaveBeenCalledWith('1');
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('Your machine is booked'));
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('BK-1');
    expect(screen.getByRole('button', { name: /Press 1: Book the machine/ })).toHaveAttribute('data-state', 'confirmed');
    expect(onConfirmed).toHaveBeenCalledWith('1', expect.objectContaining({ referenceId: 'BK-1' }));
  });

  it('0 goes back to the menu and books nothing', async () => {
    const { book, onBack, user } = setup();
    await user.click(screen.getByRole('button', { name: /Press 2/ }));
    await user.click(screen.getByRole('button', { name: /Press 0: Go back/ }));
    expect(onBack).toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-step')).toBeNull();
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('No problem. Choose again');
    expect(screen.getByRole('button', { name: /Press 1: Book the machine/ })).toBeInTheDocument();
  });

  it('shows a pending state while the request is in flight and blocks double booking', async () => {
    let resolve!: (r: BookingReceipt) => void;
    const book = vi.fn(() => new Promise<BookingReceipt>((r) => { resolve = r; }));
    const { user } = setup(book);
    await user.click(screen.getByRole('button', { name: /Press 1/ }));
    const yes = screen.getByRole('button', { name: /Press 1: Yes, confirm/ });
    await user.click(yes);
    const one = screen.getByRole('button', { name: /Press 1: Book the machine/ });
    await user.click(one);
    await user.click(screen.getByRole('button', { name: /Press 2/ }));
    expect(book).toHaveBeenCalledTimes(1);
    expect(one).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('Booking…');
    resolve(receipt('1'));
    await waitFor(() => expect(one).toHaveAttribute('data-state', 'confirmed'));
  });

  it('works from the physical keyboard (2, then 1 to confirm)', async () => {
    const { book, user } = setup();
    screen.getByRole('button', { name: /Press 2/ }).focus();
    await user.keyboard('2');
    expect(book).not.toHaveBeenCalled();
    await user.keyboard('5'); // not a key in this step
    await user.keyboard('1');
    await waitFor(() => expect(book).toHaveBeenCalledWith('2'));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('We will send a truck'));
    expect(book).toHaveBeenCalledTimes(1);
  });

  it('key 9 connects to an FPO worker after confirming with Enter on the focused button', async () => {
    const { book, user } = setup();
    screen.getByRole('button', { name: /Press 9/ }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: /Press 1: Yes, confirm/ })).toHaveFocus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(book).toHaveBeenCalledWith('9'));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('connecting you to an FPO worker'));
  });

  it('announces failures calmly and lets the farmer retry', async () => {
    const book = vi.fn<(k: KeyAction) => Promise<BookingReceipt>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(receipt('1'));
    const { user } = setup(book);
    await user.click(screen.getByRole('button', { name: /Press 1/ }));
    await user.click(screen.getByRole('button', { name: /Press 1: Yes, confirm/ }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('That did not go through. Please try again.'));
    expect(screen.getByTestId('keypad-status')).toHaveAttribute('aria-live', 'assertive');
    await user.click(screen.getByRole('button', { name: /Press 1/ }));
    await user.click(screen.getByRole('button', { name: /Press 1: Yes, confirm/ }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('Your machine is booked'));
    expect(book).toHaveBeenCalledTimes(2);
  });

  it('works in Punjabi when the interface language is Punjabi', async () => {
    const book = vi.fn(async (k: KeyAction) => receipt(k));
    const user = userEvent.setup();
    render(<I18nProvider initial="pa"><KeypadPanel book={book} prices={prices} /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: /^1 ਦਬਾਓ: ਮਸ਼ੀਨ/ }));
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('ਪੱਕਾ ਕਰਨ ਲਈ 1 ਦਬਾਓ');
    await user.click(screen.getByRole('button', { name: /^1 ਦਬਾਓ: ਹਾਂ, ਪੱਕਾ ਕਰੋ/ }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('ਤੁਹਾਡੀ ਮਸ਼ੀਨ ਬੁੱਕ ਹੈ'));
  });
});
