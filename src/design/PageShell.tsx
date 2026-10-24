import { Link } from 'react-router-dom';
import { useEffect, useRef, type ReactNode } from 'react';
import { IconBack } from './Icons';
import { revealIn } from './motion';

/** Header + content frame shared by the two desktop interfaces. */
export function PageShell({ code, title, aside, children, footer }: { code: string; title: string; aside?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => revealIn(ref.current), []);
  return (
    <div ref={ref} className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-center gap-4">
        <Link to="/" aria-label="Back to TerraPulse home" className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface text-ink shadow-md"><IconBack /></Link>
        <div className="min-w-[200px] flex-1">
          <div className="mono text-xs tracking-[0.12em] text-leaf-700">{code}</div>
          <h1 className="text-2xl font-bold lg:text-[28px]">{title}</h1>
        </div>
        {aside}
      </header>
      <main id="main" className="flex flex-1 flex-col gap-4">{children}</main>
      {footer}
    </div>
  );
}
