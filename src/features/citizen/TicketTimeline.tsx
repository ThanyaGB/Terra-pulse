import { useEffect, useState } from 'react';

const STEPS = ['Received', 'Anti-smog truck dispatched', 'In progress'] as const;

/** Demo municipal ticket: advances on a timer so the flow can be seen. Real status would come from the municipal system. */
export function TicketTimeline() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ids = [setTimeout(() => setN(2), reduce ? 0 : 6000), setTimeout(() => setN(3), reduce ? 0 : 14000)];
    return () => ids.forEach(clearTimeout);
  }, []);
  return (
    <ol aria-label="Municipal ticket status (demo)" className="m-0 mt-4 flex list-none flex-col gap-2 p-0 text-left text-sm">
      {STEPS.map((s, i) => {
        const done = i < n;
        return (
          <li key={s} className={`flex items-center gap-3 ${done ? 'font-semibold text-leaf-700' : 'text-ink-mute'}`}>
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs" style={{ background: done ? '#0B7A53' : 'transparent', color: done ? '#fff' : 'inherit', borderColor: 'currentColor' }}>{done ? '✓' : i + 1}</span>
            {s}<span className="sr-only">{done ? ' (done)' : ' (pending)'}</span>
          </li>
        );
      })}
      <li className="text-xs text-ink-mute">Demo status. Not connected to a municipal system.</li>
    </ol>
  );
}
