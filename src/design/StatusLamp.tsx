import type { HealthStatus } from '@/lib/health';

const STYLE: Record<HealthStatus, { color: string; label: string; shape: 'circle' | 'triangle' | 'square' }> = {
  ok: { color: '#0B7A53', label: 'Healthy', shape: 'circle' },
  degraded: { color: '#B45309', label: 'Degraded', shape: 'triangle' },
  down: { color: '#C62828', label: 'Down', shape: 'square' },
};

/** Green/amber/red indicator. Shape and text differ per state, so it never relies on colour alone. */
export function StatusLamp({ status, showLabel = true }: { status: HealthStatus; showLabel?: boolean }) {
  const s = STYLE[status];
  return (
    <span className="inline-flex items-center gap-2" data-status={status}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        {s.shape === 'circle' && <circle cx="7" cy="7" r="6" fill={s.color} />}
        {s.shape === 'triangle' && <path d="M7 1l6.5 12h-13z" fill={s.color} />}
        {s.shape === 'square' && <rect x="1" y="1" width="12" height="12" rx="2" fill={s.color} />}
      </svg>
      {showLabel ? <span className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</span> : <span className="sr-only">{s.label}</span>}
    </span>
  );
}

export function statusLabel(s: HealthStatus): string {
  return STYLE[s].label;
}
