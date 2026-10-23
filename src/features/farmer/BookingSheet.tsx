import { useState } from 'react';
import { formatInr } from '@/lib/format';
import { WA_BASE } from '@/features/home/content';

const DEPOSIT = 500;

function tomorrow(): string {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Shown after the farmer presses 1: pick a date and confirm on WhatsApp. Demo only: no payment is taken. */
export function BookingSheet({ onClose, referenceId }: { onClose: () => void; referenceId: string }) {
  const [date, setDate] = useState(tomorrow);
  const href = `${WA_BASE}?text=${encodeURIComponent(`Vayu-Swachh booking ${referenceId}: Super Seeder on ${date}`)}`;
  return (
    <section aria-label="Confirm booking on WhatsApp" className="rounded-3xl bg-white p-4 text-ink">
      <h2 className="m-0 text-lg font-bold">Pick a day for the Super Seeder</h2>
      <label htmlFor="book-date" className="mt-3 block text-sm font-semibold">Date</label>
      <input id="book-date" type="date" className="field" value={date} min={tomorrow()} onChange={(e) => setDate(e.target.value)} />
      <p className="mono mt-3 text-sm">Booking deposit {formatInr(DEPOSIT)} <span className="text-ink-mute">(demo, nothing is charged)</span></p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className="btn btn-primary" href={href} target="_blank" rel="noreferrer">Confirm on WhatsApp</a>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
      </div>
    </section>
  );
}
