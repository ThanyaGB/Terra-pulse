import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';
interface ToastCtx { toast: (message: string, kind?: Kind) => void }
const Ctx = createContext<ToastCtx>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; kind: Kind; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((text: string, kind: Kind = 'success') => {
    setMsg({ text, kind, n: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 4500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const bg = msg?.kind === 'error' ? '#8A1C1C' : '#0B1D33';
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4" role="status" aria-live="polite">
        {msg && <div key={msg.n} className="pointer-events-auto max-w-md rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-xl" style={{ background: bg }}>{msg.text}</div>}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
