import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'error'; data?: undefined; error: Error }
  | { status: 'success'; data: T; error?: undefined };

/**
 * Runs `fn` on mount and whenever `deps` change. Ignores results from superseded calls.
 * `reload()` re-runs it (and shows the loading state); `refresh()` re-runs it silently.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void; refresh: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const silent = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    if (!silent.current) setState({ status: 'loading' });
    silent.current = false;
    fnRef.current().then(
      (data) => { if (!cancelled) setState({ status: 'success', data }); },
      (error: unknown) => { if (!cancelled) setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) }); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const refresh = useCallback(() => { silent.current = true; setNonce((n) => n + 1); }, []);
  return { ...state, reload, refresh } as AsyncState<T> & { reload: () => void; refresh: () => void };
}
