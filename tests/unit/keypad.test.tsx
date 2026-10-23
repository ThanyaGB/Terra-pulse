import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BookingReceipt, KeyAction } from '@/api/contract';
import { KeypadPanel } from '@/features/farmer/KeypadPanel';
import { keypadReducer, type KeypadState } from '@/features/farmer/keypadFlow';
import { I18nProvider } from '@/i18n';

const prices = { superSeederPerAcre: 750, strawPerTonne: 1650 };
const receipt = (key: KeyAction): BookingReceipt => ({ referenceId: `BK-${key}`, key, status: key === '9' ? 'connecting' : 'confirmed' });

describe('keypadReducer', () => {
  const idle: KeypadState = { status: 'idle' };
  it('goes idle -> pending -> confirmed', () => {
    const pending = keypadReducer(idle, { type: 'press', key: '1' });
    expect(pending).toEqual({ status: 'pending', key: '1' });
    expect(keypadReducer(pending, { type: 'success', receipt: receipt('1') })).toEqual({ status: 'confirmed', key: '1', referenceId: 'BK-1', connecting: false });
  });
  it('ignores presses while a booking is in flight', () => {
    const pending = keypadReducer(idle, { type: 'press', key: '1' });
    expect(keypadReducer(pending, { type: 'press', key: '2' })).toBe(pending);
  });
  it('ignores a repeat press of an already confirmed key, but allows a different key', () => {
    const done = keypadReducer(keypadReducer(idle, { type: 'press', key: '1' }), { type: 'success', receipt: receipt('1') });
    expect(keypadReducer(done, { type: 'press', key: '1' })).toBe(done);
    expect(keypadReducer(done, { type: 'press', key: '2' })).toEqual({ status: 'pending', key: '2' });
  });
  it('marks key 9 as connecting rather than booked', () => {
    const s = keypadReducer(keypadReducer(idle, { type: 'press', key: '9' }), { type: 'success', receipt: receipt('9') });
    expect(s).toMatchObject({ status: 'confirmed', connecting: true });
  });
  it('can retry after an error', () => {
    const failed = keypadReducer(keypadReducer(idle, { type: 'press', key: '2' }), { type: 'failure' });
    expect(failed).toEqual({ status: 'error', key: '2' });
    expect(keypadReducer(failed, { type: 'press', key: '2' })).toEqual({ status: 'pending', key: '2' });
  });
  it('drops a stale success for a different key', () => {
    const pending = keypadReducer(idle, { type: 'press', key: '1' });
    expect(keypadReducer(pending, { type: 'success', receipt: receipt('2') })).toBe(pending);
  });
});

function setup(book = vi.fn(async (k: KeyAction) => receipt(k))) {
  const onTone = vi.fn();
  const onConfirmed = vi.fn();
  const user = userEvent.setup();
  render(<I18nProvider initial="en"><KeypadPanel book={book} onTone={onTone} onConfirmed={onConfirmed} prices={prices} /></I18nProvider>);
  return { book, onTone, onConfirmed, user };
}

describe('KeypadPanel flow', () => {
  it('offers exactly the three keys with prices, each as a labelled button', () => {
    setup();
    expect(screen.getByRole('button', { name: /Press 1: Lock Super Seeder, ₹750 per acre/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Press 2: Request straw collection, ₹1,650 per tonne/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Press 9: Call agronomist/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('press 1: plays a tone, calls the booking API, then shows the confirmation', async () => {
    const { book, onTone, onConfirmed, user } = setup();
    await user.click(screen.getByRole('button', { name: /Press 1/ }));
    expect(onTone).toHaveBeenCalledWith('1');
    expect(book).toHaveBeenCalledTimes(1);
    expect(book).toHaveBeenCalledWith('1');
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('Done! Super Seeder is locked for you.'));
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('BK-1');
    expect(screen.getByRole('button', { name: /Press 1/ })).toHaveAttribute('data-state', 'confirmed');
    expect(onConfirmed).toHaveBeenCalledWith('1', expect.objectContaining({ referenceId: 'BK-1' }));
  });

  it('shows a pending state while the request is in flight and blocks double booking', async () => {
    let resolve!: (r: BookingReceipt) => void;
    const book = vi.fn(() => new Promise<BookingReceipt>((r) => { resolve = r; }));
    const { user } = setup(book);
    const one = screen.getByRole('button', { name: /Press 1/ });
    await user.click(one);
    await user.click(one);
    await user.click(screen.getByRole('button', { name: /Press 2/ }));
    expect(book).toHaveBeenCalledTimes(1);
    expect(one).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('Booking…');
    resolve(receipt('1'));
    await waitFor(() => expect(one).toHaveAttribute('data-state', 'confirmed'));
  });

  it('works from the physical keyboard (1, 2, 9)', async () => {
    const { book, user } = setup();
    screen.getByRole('button', { name: /Press 2/ }).focus();
    await user.keyboard('2');
    await waitFor(() => expect(book).toHaveBeenCalledWith('2'));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('Done! Straw collection requested.'));
    await user.keyboard('5'); // not a key on this keypad
    expect(book).toHaveBeenCalledTimes(1);
  });

  it('can be activated with Enter or Space on a focused key', async () => {
    const { book, user } = setup();
    screen.getByRole('button', { name: /Press 9/ }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(book).toHaveBeenCalledWith('9'));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('Connecting you to an agronomist'));
  });

  it('announces failures calmly and lets the farmer retry', async () => {
    const book = vi.fn<(k: KeyAction) => Promise<BookingReceipt>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(receipt('1'));
    const { user } = setup(book);
    await user.click(screen.getByRole('button', { name: /Press 1/ }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('That did not go through. Please try again.'));
    expect(screen.getByTestId('keypad-status')).toHaveAttribute('aria-live', 'assertive');
    await user.click(screen.getByRole('button', { name: /Press 1/ }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('Done!'));
    expect(book).toHaveBeenCalledTimes(2);
  });

  it('speaks Punjabi when the interface language is Punjabi', async () => {
    const book = vi.fn(async (k: KeyAction) => receipt(k));
    const user = userEvent.setup();
    render(<I18nProvider initial="pa"><KeypadPanel book={book} prices={prices} /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: /1 ਦਬਾਓ/ }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('ਹੋ ਗਿਆ! ਸੁਪਰ ਸੀਡਰ ਤੁਹਾਡੇ ਲਈ ਪੱਕਾ ਹੈ।'));
  });
});
