import { useCallback, useState } from 'react';

export type GeoState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ok'; lat: number; lng: number; accuracyM: number }
  | { status: 'denied' }
  | { status: 'unavailable' };

export function useGeolocation() {
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGeo({ status: 'unavailable' }); return; }
    setGeo({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo({ status: 'ok', lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
      (e) => setGeo({ status: e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }, []);
  return { geo, locate };
}
