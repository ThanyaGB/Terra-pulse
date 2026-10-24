import { useState } from 'react';
import { usePublicConfig } from '@/api/usePublicConfig';
import { readJson, writeJson } from './storage';

/**
 * Opt-in for phone alerts. Hidden unless PUBLIC_ALERTS_ENABLED is on (gate G2): while it is off the component renders nothing and
 * never touches the Notification API. Server-side delivery is not part of this build; this records the person's choice.
 */
export function PushAlerts() {
  const cfg = usePublicConfig();
  const [on, setOn] = useState(() => readJson<boolean>('vs.pushOptIn') ?? false);
  if (!cfg.flags.PUBLIC_ALERTS_ENABLED) return null;
  async function enable() {
    const perm = typeof Notification !== 'undefined' ? await Notification.requestPermission() : 'denied';
    const ok = perm === 'granted';
    setOn(ok);
    writeJson('vs.pushOptIn', ok);
  }
  return (
    <section className="tile !p-4" aria-label="Alert notifications" data-testid="push-alerts">
      <p className="m-0 text-sm font-semibold">{on ? 'Alerts are on for this phone.' : 'Get air quality alerts on this phone.'}</p>
      {!on && <button type="button" className="btn btn-primary mt-2" onClick={() => void enable()}>Turn on alerts</button>}
    </section>
  );
}
