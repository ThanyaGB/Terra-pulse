import { useEffect, useState } from 'react';
import { isGrapActive, subscribeOrders } from '@/lib/orders';

/** Shows when /policy has issued a GRAP-II alert in this browser (shared via localStorage 'terrapulse.grap'). */
export function GrapBanner() {
  const [on, setOn] = useState(isGrapActive);
  useEffect(() => subscribeOrders(() => setOn(isGrapActive())), []);
  if (!on) return null;
  return (
    <div role="status" className="rounded-2xl bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-fg">
      GRAP Stage II is in force in Delhi-NCR: diesel generators restricted, parking fees raised, more CNG buses and metro trips. Limit outdoor exertion.
    </div>
  );
}
