import type { ReactNode } from 'react';

export function Tile({ title, aside, children, className = '', dark = false, label, id }: {
  title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; dark?: boolean; label?: string; id?: string;
}) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section id={id} data-reveal aria-labelledby={title ? headingId : undefined} aria-label={title ? undefined : label} className={`tile ${dark ? 'tile-dark' : ''} ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 id={headingId} className={`h ${dark ? 'text-white' : ''}`}>{title}</h2>}
          {aside && <div className="flex items-center gap-2">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tag({ children, color }: { children: ReactNode; color?: string }) {
  return <span className="tag" style={color ? { color } : undefined}>{children}</span>;
}
