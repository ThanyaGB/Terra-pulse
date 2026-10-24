import type { ConnectionState } from '@/api/realtime';

const LABEL: Record<ConnectionState, { text: string; color: string }> = {
  live: { text: 'Live', color: '#0B7A53' },
  connecting: { text: 'Connecting', color: '#4A6380' },
  polling: { text: 'Polling (socket down)', color: '#B45309' },
  offline: { text: 'Offline', color: '#C62828' },
};

export function RealtimeBadge({ state }: { state: ConnectionState }) {
  const l = LABEL[state];
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold" style={{ color: l.color }} data-connection={state}>
      <span className={`h-2.5 w-2.5 rounded-full ${state === 'live' || state === 'connecting' ? 'lamp' : ''}`} style={{ background: l.color }} aria-hidden="true" />
      {l.text}
    </span>
  );
}
