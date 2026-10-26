import { API_MODE } from '@/api/client';

function setMode(mode: 'mock' | 'live') {
  try {
    localStorage.setItem('vs.apiMode', mode);
  } catch {
    // best effort — reload honour reads from storageKeyMode at startup
  }
}

export function ApiModeToggle() {
  const mode = API_MODE;
  const label = mode === 'mock' ? 'Simulated' : 'Live';

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Switch API mode: ${mode === 'mock' ? 'Live' : 'Simulated'}`}
      onClick={() => { setMode(mode === 'mock' ? 'live' : 'mock'); window.location.reload(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setMode(mode === 'mock' ? 'live' : 'mock');
          window.location.reload();
        }
      }}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm user-select-none"
      style={{ background: mode === 'mock' ? '#F6E7FF' : '#E3F8EE', color: mode === 'mock' ? '#7A28A8' : '#0B7A53', borderColor: mode === 'mock' ? '#C9A7F5' : '#9FD8BD' }}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${mode === 'mock' ? '' : 'lamp'}`} style={{ background: mode === 'mock' ? '#A044F4' : '#0B7A53' }} aria-hidden="true" />
      {label}
    </span>
  );
}
