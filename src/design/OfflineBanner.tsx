import { useOnline } from '@/hooks/useOnline';
import { IconWifiOff } from './Icons';

export function OfflineBanner({ message = 'You are offline. Showing the last saved data.' }: { message?: string }) {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-navy px-4 py-2 text-sm font-semibold text-white">
      <IconWifiOff /> {message}
    </div>
  );
}
