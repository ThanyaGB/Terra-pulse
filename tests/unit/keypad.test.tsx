import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BookingReceipt } from '@/api/contract';
import { KeypadPanel } from '@/features/farmer/KeypadPanel';
import { digitAction, keypadReducer, stepOf, type Choice, type KeypadState } from '@/features/farmer/keypadFlow';
import { I18nProvider } from '@/i18n';

const prices = { superSeederPerAcre: 750, strawPerTonne: 1650 };
const receipt = (c: Choice): BookingReceipt => ({
  referenceId: `BK-${c.key}${c.machine ? `-${c.machine}` : ''}`, key: c.key, ...(c.machine ? { machine: c.machine } : {}),
  status: c.key === '9' ? 'connecting' : 'confirmed',
});
const SS: Choice = { key: '1', machine: 'super_seeder' };
const HS: Choice = { key: '1', machine: 'happy_seeder' };

describe('keypadReducer (menu, machine for 1, then 1 to confirm or 0 to go back)', () => {
  const idle: KeypadState = { status: 'idle' };
  const machines = (s: KeypadState) => keypadReducer(s, { type: 'openMachines' });
  const choose = (s: KeypadState, c: Choice) => keypadReducer(s, { type: 'choose', ...c });
  const confirm = (s: KeypadState) => keypadReducer(s, { type: 'confirm' });

  it('goes idle -> machine -> confirming -> pending -> confirmed for a Super Seeder', () => {
    const picking = machines(idle);
    expect(picking).toEqual({ status: 'machine' });
    const asking = choose(picking, SS);
    expect(asking).toEqual({ status: 'confirming', key: '1', machine: 'super_seeder' });
    const pending = confirm(asking);
    expect(pending).toEqual({ status: 'pending', key: '1', machine: 'super_seeder' });
    expect(keypadReducer(pending, { type: 'success', receipt: receipt(SS) }))
      .toEqual({ status: 'confirmed', key: '1', machine: 'super_seeder', referenceId: 'BK-1-super_seeder', connecting: false });
  });
  it('key 1 must go through the machine step; 2 and 9 go straight to confirming', () => {
    expect(choose(idle, SS)).toBe(idle);
    expect(choose(idle, { key: '2' })).toEqual({ status: 'confirming', key: '2' });
    expect(choose(machines(idle), { key: '9' })).toEqual({ status: 'machine' });
  });
  it('0 goes back to the menu without booking, from the machine step and from confirming', () => {
    expect(keypadReducer(machines(idle), { type: 'back' })).toEqual({ status: 'idle', note: 'back' });
    expect(keypadReducer(choose(machines(idle), HS), { type: 'back' })).toEqual({ status: 'idle', note: 'back' });
    expect(keypadReducer(choose(idle, { key: '2' }), { type: 'back' })).toEqual({ status: 'idle', note: 'back' });
  });
  it('confirm and back do nothing at the menu', () => {
    expect(confirm(idle)).toBe(idle);
    expect(keypadReducer(idle, { type: 'back' })).toBe(idle);
  });
  it('repeat (*) never changes the step', () => {
    for (const s of [idle, machines(idle), choose(idle, { key: '9' })]) expect(keypadReducer(s, { type: 'repeat' })).toBe(s);
  });
  it('ignores presses while a booking is in flight', () => {
    const pending = confirm(choose(machines(idle), SS));
    expect(choose(pending, { key: '2' })).toBe(pending);
    expect(machines(pending)).toBe(pending);
  });
  it('after a machine is booked, 1 is ignored but 2 is allowed', () => {
    const done = keypadReducer(confirm(choose(machines(idle), SS)), { type: 'success', receipt: receipt(SS) });
    expect(machines(done)).toBe(done);
    expect(choose(done, { key: '2' })).toEqual({ status: 'confirming', key: '2' });
  });
  it('marks key 9 as connecting rather than booked', () => {
    const s = keypadReducer(confirm(choose(idle, { key: '9' })), { type: 'success', receipt: receipt({ key: '9' }) });
    expect(s).toMatchObject({ status: 'confirmed', connecting: true });
  });
  it('can retry after an error (a machine is picked again)', () => {
    const failed = keypadReducer(confirm(choose(machines(idle), HS)), { type: 'failure' });
    expect(failed).toEqual({ status: 'error', key: '1', machine: 'happy_seeder' });
    expect(machines(failed)).toEqual({ status: 'machine' });
  });
  it('drops a stale success for a different key or machine', () => {
    const pending = confirm(choose(machines(idle), SS));
    expect(keypadReducer(pending, { type: 'success', receipt: receipt({ key: '2' }) })).toBe(pending);
    expect(keypadReducer(pending, { type: 'success', receipt: receipt(HS) })).toBe(pending);
  });
  it('maps digits by step: 1/2/9 at the menu, 1/2/0 for the machine, 1/0 while confirming, * everywhere but in flight', () => {
    expect(digitAction(idle, '1')).toEqual({ type: 'openMachines' });
    expect(digitAction(idle, '9')).toEqual({ type: 'choose', key: '9' });
    expect(digitAction(idle, '0')).toBeNull();
    expect(digitAction(idle, '*')).toEqual({ type: 'repeat' });
    const picking = machines(idle);
    expect(digitAction(picking, '1')).toEqual({ type: 'choose', key: '1', machine: 'super_seeder' });
    expect(digitAction(picking, '2')).toEqual({ type: 'choose', key: '1', machine: 'happy_seeder' });
    expect(digitAction(picking, '0')).toEqual({ type: 'back' });
    expect(digitAction(picking, '9')).toBeNull();
    const asking = choose(idle, { key: '2' });
    expect(digitAction(asking, '1')).toEqual({ type: 'confirm' });
    expect(digitAction(asking, '0')).toEqual({ type: 'back' });
    expect(digitAction(asking, '9')).toBeNull();
    expect(digitAction(confirm(asking), '*')).toBeNull();
    expect([stepOf(idle), stepOf(picking), stepOf(asking)]).toEqual(['menu', 'machine', 'confirm']);
  });
});

function setup(book = vi.fn(async (c: Choice) => receipt(c))) {
  const onTone = vi.fn();
  const onMachineMenu = vi.fn();
  const onChoose = vi.fn();
  const onBack = vi.fn();
  const onRepeat = vi.fn();
  const onConfirmed = vi.fn();
  const user = userEvent.setup();
  render(<I18nProvider initial="en"><KeypadPanel book={book} onTone={onTone} onMachineMenu={onMachineMenu} onChoose={onChoose} onBack={onBack} onRepeat={onRepeat} onConfirmed={onConfirmed} prices={prices} /></I18nProvider>);
  return { book, onTone, onMachineMenu, onChoose, onBack, onRepeat, onConfirmed, user };
}

describe('KeypadPanel flow', () => {
  it('shows a full 12-key phone pad; 1, 2, 9 and * are the active, labelled menu keys', () => {
    setup();
    expect(screen.getByRole('button', { name: /Press 1: Book a machine, Super Seeder or Happy Seeder/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Press 2: Pick up my straw, ₹1,650 per tonne/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Press 9: Talk to an FPO worker/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Press *: Hear the message again' })).toHaveAttribute('data-active', 'true');
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

  it('1 asks which machine, 1 picks the Super Seeder, and nothing is booked until 1 confirms', async () => {
    const { book, onTone, onMachineMenu, onChoose, onConfirmed, user } = setup();
    await user.click(screen.getByRole('button', { name: /Press 1: Book a machine/ }));
    expect(onTone).toHaveBeenCalledWith('1');
    expect(onMachineMenu).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('machine-step')).toHaveTextContent('Which machine?');
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('Press 1 for the Super Seeder, or 2 for the Happy Seeder');
    await user.click(screen.getByRole('button', { name: /Press 1: Super Seeder, ₹750 per acre/ }));
    expect(onChoose).toHaveBeenCalledWith(SS);
    expect(book).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-step')).toHaveTextContent('You chose: Super Seeder');
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('Press 1 to confirm, or 0 to go back.');
    await user.click(screen.getByRole('button', { name: /Press 1: Yes, confirm, Super Seeder/ }));
    expect(book).toHaveBeenCalledTimes(1);
    expect(book).toHaveBeenCalledWith(SS);
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('Your machine is booked'));
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('BK-1-super_seeder');
    expect(screen.getByRole('button', { name: /Press 1: Book a machine/ })).toHaveAttribute('data-state', 'confirmed');
    expect(onConfirmed).toHaveBeenCalledWith(SS, expect.objectContaining({ referenceId: 'BK-1-super_seeder' }));
  });

  it('2 on the machine step books the Happy Seeder', async () => {
    const { book, onChoose, user } = setup();
    await user.click(screen.getByRole('button', { name: /Press 1: Book a machine/ }));
    await user.click(screen.getByRole('button', { name: /Press 2: Happy Seeder/ }));
    expect(onChoose).toHaveBeenCalledWith(HS);
    expect(screen.getByTestId('confirm-step')).toHaveTextContent('You chose: Happy Seeder');
    await user.click(screen.getByRole('button', { name: /Press 1: Yes, confirm, Happy Seeder/ }));
    await waitFor(() => expect(book).toHaveBeenCalledWith(HS));
  });

  it('0 on the machine step goes back to the main menu and books nothing', async () => {
    const { book, onBack, user } = setup();
    await user.click(screen.getByRole('button', { name: /Press 1: Book a machine/ }));
    await user.click(screen.getByRole('button', { name: /Press 0: Go back/ }));
    expect(onBack).toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
    expect(screen.queryByTestId('machine-step')).toBeNull();
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('No problem. Choose again');
    expect(screen.getByRole('button', { name: /Press 2: Pick up my straw/ })).toBeInTheDocument();
  });

  it('0 while confirming goes back to the menu and books nothing', async () => {
    const { book, onBack, user } = setup();
    await user.click(screen.getByRole('button', { name: /Press 2/ }));
    await user.click(screen.getByRole('button', { name: /Press 0: Go back/ }));
    expect(onBack).toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-step')).toBeNull();
    expect(screen.getByRole('button', { name: /Press 1: Book a machine/ })).toBeInTheDocument();
  });

  it('* repeats what each step asks and never changes the step', async () => {
    const { book, onTone, onRepeat, user } = setup();
    const star = () => screen.getByRole('button', { name: 'Press *: Hear the message again' });
    await user.click(star());
    expect(onTone).toHaveBeenCalledWith('*');
    expect(onRepeat).toHaveBeenLastCalledWith('menu', undefined);
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('Playing the message again.');
    await user.click(screen.getByRole('button', { name: /Press 1: Book a machine/ }));
    await user.click(star());
    expect(onRepeat).toHaveBeenLastCalledWith('machine', undefined);
    expect(screen.getByTestId('machine-step')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Press 2: Happy Seeder/ }));
    await user.click(star());
    expect(onRepeat).toHaveBeenLastCalledWith('confirm', HS);
    expect(screen.getByTestId('confirm-step')).toHaveTextContent('Happy Seeder');
    expect(book).not.toHaveBeenCalled();
  });

  it('shows a pending state while the request is in flight and blocks double booking', async () => {
    let resolve!: (r: BookingReceipt) => void;
    const book = vi.fn(() => new Promise<BookingReceipt>((r) => { resolve = r; }));
    const { user } = setup(book);
    await user.click(screen.getByRole('button', { name: /Press 1/ }));
    await user.click(screen.getByRole('button', { name: /Press 1: Super Seeder/ }));
    await user.click(screen.getByRole('button', { name: /Press 1: Yes, confirm/ }));
    const one = screen.getByRole('button', { name: /Press 1: Book a machine/ });
    await user.click(one);
    await user.click(screen.getByRole('button', { name: /Press 2/ }));
    expect(book).toHaveBeenCalledTimes(1);
    expect(one).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('Booking…');
    resolve(receipt(SS));
    await waitFor(() => expect(one).toHaveAttribute('data-state', 'confirmed'));
  });

  it('works from the physical keyboard (1, 2, then 1 to confirm a Happy Seeder; * and dead keys book nothing)', async () => {
    const { book, onRepeat, user } = setup();
    screen.getByRole('button', { name: /Press 2/ }).focus();
    await user.keyboard('1');
    await user.keyboard('*');
    expect(onRepeat).toHaveBeenLastCalledWith('machine', undefined);
    await user.keyboard('5'); // not a key in this step
    await user.keyboard('2');
    expect(book).not.toHaveBeenCalled();
    await user.keyboard('1');
    await waitFor(() => expect(book).toHaveBeenCalledWith(HS));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('Your machine is booked'));
    expect(book).toHaveBeenCalledTimes(1);
  });

  it('key 9 connects to an FPO worker after confirming with Enter on the focused button', async () => {
    const { book, user } = setup();
    screen.getByRole('button', { name: /Press 9/ }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: /Press 1: Yes, confirm/ })).toHaveFocus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(book).toHaveBeenCalledWith({ key: '9' }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('connecting you to an FPO worker'));
  });

  it('moves focus to the Super Seeder key when the machine step opens', async () => {
    const { user } = setup();
    screen.getByRole('button', { name: /Press 1: Book a machine/ }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: /Press 1: Super Seeder/ })).toHaveFocus());
  });

  it('announces failures calmly and lets the farmer retry', async () => {
    const book = vi.fn<(c: Choice) => Promise<BookingReceipt>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(receipt(SS));
    const { user } = setup(book);
    await user.click(screen.getByRole('button', { name: /Press 1/ }));
    await user.click(screen.getByRole('button', { name: /Press 1: Super Seeder/ }));
    await user.click(screen.getByRole('button', { name: /Press 1: Yes, confirm/ }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('That did not go through. Please try again.'));
    expect(screen.getByTestId('keypad-status')).toHaveAttribute('aria-live', 'assertive');
    await user.click(screen.getByRole('button', { name: /Press 1/ }));
    await user.click(screen.getByRole('button', { name: /Press 1: Super Seeder/ }));
    await user.click(screen.getByRole('button', { name: /Press 1: Yes, confirm/ }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('Your machine is booked'));
    expect(book).toHaveBeenCalledTimes(2);
  });

  it('works in Punjabi when the interface language is Punjabi', async () => {
    const book = vi.fn(async (c: Choice) => receipt(c));
    const user = userEvent.setup();
    render(<I18nProvider initial="pa"><KeypadPanel book={book} prices={prices} /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: /^1 ਦਬਾਓ: ਮਸ਼ੀਨ/ }));
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('ਹੈਪੀ ਸੀਡਰ ਲਈ 2 ਦਬਾਓ');
    await user.click(screen.getByRole('button', { name: /^1 ਦਬਾਓ: ਸੁਪਰ ਸੀਡਰ/ }));
    expect(screen.getByTestId('keypad-status')).toHaveTextContent('ਪੱਕਾ ਕਰਨ ਲਈ 1 ਦਬਾਓ');
    await user.click(screen.getByRole('button', { name: /^1 ਦਬਾਓ: ਹਾਂ, ਪੱਕਾ ਕਰੋ/ }));
    await waitFor(() => expect(screen.getByTestId('keypad-status')).toHaveTextContent('ਤੁਹਾਡੀ ਮਸ਼ੀਨ ਬੁੱਕ ਹੈ'));
  });
});
