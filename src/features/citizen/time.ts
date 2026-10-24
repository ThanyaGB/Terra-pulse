import type { TimedAlert } from '@/api/contract';

export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

export type AlertTiming = { state: 'active'; endsInMin: number } | { state: 'upcoming'; startsInMin: number } | { state: 'passed' };

export function alertTiming(alert: Pick<TimedAlert, 'startMin' | 'endMin'>, nowMin: number): AlertTiming {
  if (nowMin >= alert.startMin && nowMin < alert.endMin) return { state: 'active', endsInMin: alert.endMin - nowMin };
  if (nowMin < alert.startMin) return { state: 'upcoming', startsInMin: alert.startMin - nowMin };
  return { state: 'passed' };
}

export function hhmm(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function humanDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
