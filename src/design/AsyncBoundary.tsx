import type { ReactNode } from 'react';
import type { AsyncState } from '@/hooks/useAsync';
import { ApiError } from '@/api/errors';
import { IconAlert, IconWifiOff } from './Icons';
import { SkeletonBlock } from './Skeleton';

interface Props<T> {
  state: AsyncState<T>;
  onRetry: () => void;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  skeleton?: ReactNode;
  /** what is loading, e.g. "attribution" - used in messages */
  what?: string;
  retryLabel?: string;
}

/** One place that renders the loading, error (with retry), offline and empty states for any async panel. */
export function AsyncBoundary<T>({ state, onRetry, children, isEmpty, empty, skeleton, what = 'data', retryLabel = 'Try again' }: Props<T>) {
  if (state.status === 'loading') return <>{skeleton ?? <SkeletonBlock rows={4} label={`Loading ${what}`} />}</>;
  if (state.status === 'error') {
    const offline = (state.error instanceof ApiError && state.error.isOffline) || (typeof navigator !== 'undefined' && !navigator.onLine);
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-warn-bg p-4 text-warn-fg">
        <div className="flex items-center gap-2 font-semibold">
          {offline ? <IconWifiOff /> : <IconAlert />}
          {offline ? `You appear to be offline, so ${what} could not load.` : `We could not load ${what}.`}
        </div>
        <button type="button" className="btn btn-navy" onClick={onRetry}>{retryLabel}</button>
      </div>
    );
  }
  if (isEmpty?.(state.data)) {
    return <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-soft">{empty ?? `No ${what} to show yet.`}</div>;
  }
  return <>{children(state.data)}</>;
}
