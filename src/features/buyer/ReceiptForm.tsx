import { useState, type FormEvent } from 'react';
import { api } from '@/api/client';
import type { BuyerClaim, StrawGrade } from '@/api/contract';
import { useToast } from '@/design/Toast';
import { formatNumber } from '@/lib/format';
import { SUPPLY_CONFIG } from '@/lib/supplyConfig';
import { netKgFor, receiptProblem } from '@/lib/supplyRules';

/** Weighbridge receipt for one claim. Net is computed here; the platform runs its checks after the receipt is saved. */
export function ReceiptForm({ claim, onRecorded }: { claim: BuyerClaim; onRecorded: () => void }) {
  const [gross, setGross] = useState('');
  const [tare, setTare] = useState('');
  const [grade, setGrade] = useState<StrawGrade>('B');
  const [photo, setPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const grossKg = Number(gross);
  const tareKg = Number(tare);
  const entered = gross !== '' && tare !== '';
  const problem = !entered
    ? 'Enter the gross and tare weights'
    : receiptProblem({ grossKg, tareKg, qualityGrade: grade, photoRef: photo ? 'demo' : '' });
  const net = entered && receiptProblem({ grossKg, tareKg, qualityGrade: grade, photoRef: 'demo' }) === null ? netKgFor({ grossKg, tareKg }) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.recordReceipt(claim.id, { grossKg, tareKg, qualityGrade: grade, photoRef: `demo://weighbridge/${claim.id}` });
      toast(`Receipt ${r.id} recorded. The platform is verifying it.`, 'success');
      onRecorded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The receipt was not saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} aria-label="Weighbridge receipt">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="rc-gross" className="mb-1 block text-xs font-semibold text-ink-soft">Gross weight (kg)</label>
          <input id="rc-gross" type="number" inputMode="numeric" min={0} className="field" value={gross} onChange={(e) => setGross(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rc-tare" className="mb-1 block text-xs font-semibold text-ink-soft">Tare weight (kg)</label>
          <input id="rc-tare" type="number" inputMode="numeric" min={0} className="field" value={tare} onChange={(e) => setTare(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-xs font-semibold text-ink-soft">Net weight</span>
          <output className="mono block rounded-xl bg-air-50 px-3 py-2" aria-live="polite" data-testid="receipt-net">
            {net === null ? '—' : <>{formatNumber(net)} kg · <b>{formatNumber(net / 1000, 2)} t</b></>}
          </output>
        </div>
        <div>
          <label htmlFor="rc-grade" className="mb-1 block text-xs font-semibold text-ink-soft">Quality grade</label>
          <select id="rc-grade" className="field" value={grade} onChange={(e) => setGrade(e.target.value as StrawGrade)}>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
          </select>
        </div>
      </div>
      <div className="rounded-xl border border-dashed border-line p-3 text-sm">
        <div className="mb-2 text-xs text-ink-soft">Weighbridge slip photo (placeholder in the demo)</div>
        <button type="button" className="btn btn-ghost !min-h-10" aria-pressed={photo} onClick={() => setPhoto((p) => !p)}>
          {photo ? 'Slip attached (demo)' : 'Attach slip photo (demo)'}
        </button>
      </div>
      <p className="m-0 text-xs text-ink-mute">Claimed {formatNumber(claim.claimedTonnes, 2)} t. A net within ±{SUPPLY_CONFIG.tolerancePct}% of the claim matches.</p>
      {error && <p role="alert" className="m-0 text-sm font-semibold text-danger">{error}</p>}
      <button type="submit" className="btn btn-primary self-start" disabled={busy || problem !== null}>{busy ? 'Saving…' : 'Record receipt'}</button>
      {entered && problem && <p className="m-0 text-xs text-ink-soft">{problem}</p>}
    </form>
  );
}
