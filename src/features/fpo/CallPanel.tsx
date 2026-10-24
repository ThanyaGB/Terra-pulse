import { api } from '@/api/client';
import type { Farmer } from '@/api/contract';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { IconPhone } from '@/design/Icons';
import { Tag, Tile } from '@/design/Tile';
import { formatDate, formatTime } from '@/lib/format';
import { maskPhone } from '@/lib/phone';
import { MACHINE_LABEL } from './machine';

interface Props {
  farmer: Farmer | null;
  version: number;
  busy: boolean;
  onCall: (f: Farmer) => void;
  onAssign: (f: Farmer, machine: Farmer['machineNeed']) => void;
}

const OUTCOME: Record<string, string> = { answered: 'Answered', no_answer: 'No answer', queued: 'Queued' };

export function CallPanel({ farmer, version, busy, onCall, onAssign }: Props) {
  const state = useAsync(() => (farmer ? api.getCallDetails(farmer.id) : Promise.resolve(null)), [farmer?.id, version]);

  return (
    <Tile id="call-panel" title="Call panel" aside={<Tag>Simulated</Tag>} className="min-h-[360px]">
      {!farmer ? (
        <p className="m-0 rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-soft">Select a farmer in the table to see their call log, what they asked for, and the machine matched to them.</p>
      ) : (
        <AsyncBoundary state={state} onRetry={state.reload} what="the call details">
          {(d) => d && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="font-display text-lg font-bold">{farmer.name}</div>
                <div className="text-sm text-ink-soft">{farmer.village} · {farmer.acres} acres · harvest {formatDate(farmer.harvestDate)}</div>
              </div>

              <ol aria-label="Call steps" className="m-0 grid list-none grid-cols-4 gap-1 p-0 text-center text-[11px]">
                {[
                  ['Called', d.log.length > 0],
                  ['Answered', d.log.some((c) => c.outcome === 'answered')],
                  ['Matched', d.matchedResource !== null],
                  ['Dispatched', farmer.status === 'dispatched'],
                ].map(([label, done]) => (
                  <li key={String(label)} className={done ? 'font-bold text-leaf-700' : 'text-ink-mute'}>
                    <span aria-hidden="true" className="mx-auto mb-1 block h-2 w-full rounded-full" style={{ background: done ? 'currentColor' : 'var(--color-track)' }} />
                    {label}<span className="sr-only">{done ? ' (done)' : ' (pending)'}</span>
                  </li>
                ))}
              </ol>

              <section aria-label="Call intent summary" className="rounded-2xl bg-air-50 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-ink-mute">Call intent</div>
                {d.intent ? (
                  <>
                    <div className="flex items-center justify-between gap-2"><b>{d.intent.label}</b><span className="mono text-xs text-ink-soft">{d.intent.confidencePct}% sure</span></div>
                    <p className="m-0 text-sm text-ink-soft">{d.intent.summary}</p>
                  </>
                ) : <p className="m-0 text-sm text-ink-soft">No conversation yet. Trigger a voice call to reach this farmer.</p>}
              </section>

              <section aria-label="Matched machinery">
                <div className="text-xs font-bold uppercase tracking-wide text-ink-mute">Matched machine</div>
                {d.matchedResource ? (
                  <div className="mt-1 rounded-2xl border border-line p-3">
                    <div className="flex items-center justify-between"><b className="capitalize">{MACHINE_LABEL[d.matchedResource.machineType]}</b><span className="mono text-sm font-bold">{d.matchedResource.distanceKm} km</span></div>
                    <div className="text-sm">Operator <b>{d.matchedResource.operatorName}</b> · {d.matchedResource.base}</div>
                    <div className="mono text-sm" aria-label="Operator phone, masked">{maskPhone(d.matchedResource.phone)}</div>
                  </div>
                ) : <p className="m-0 text-sm text-ink-soft">No machine matched.</p>}
              </section>

              <section aria-label="Call log">
                <div className="text-xs font-bold uppercase tracking-wide text-ink-mute">Call log</div>
                {d.log.length === 0 ? <p className="m-0 mt-1 text-sm text-ink-soft">No calls yet.</p> : (
                  <ol className="m-0 mt-1 flex list-none flex-col gap-2 p-0">
                    {d.log.map((c) => (
                      <li key={c.id} className="flex gap-3 text-sm">
                        <span className="mono w-12 shrink-0 text-xs text-ink-mute">{formatTime(c.at)}</span>
                        <span><b>{OUTCOME[c.outcome]}</b> · {c.note}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-navy" disabled={busy} onClick={() => onCall(farmer)}><IconPhone /> Trigger voice call</button>
                <button type="button" className="btn btn-primary" disabled={busy || farmer.status === 'dispatched' || !d.matchedResource}
                  onClick={() => d.matchedResource && onAssign(farmer, d.matchedResource.machineType)}>
                  {farmer.status === 'dispatched' ? 'Already assigned' : `Assign ${d.matchedResource ? MACHINE_LABEL[d.matchedResource.machineType] : 'machine'} on-site`}
                </button>
              </div>
            </div>
          )}
        </AsyncBoundary>
      )}
    </Tile>
  );
}
