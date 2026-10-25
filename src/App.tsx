import { Suspense, lazy, useEffect, useRef } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Skeleton } from './design/Skeleton';
import { pageEnter } from './design/motion';
import Landing from './features/home/Landing';
import { TourBar } from './design/TourBar';

// Each interface is its own chunk, so Mapbox/Three never load for the farmer or citizen screens.
const PolicyPage = lazy(() => import('./features/policy/PolicyPage'));
const FpoPage = lazy(() => import('./features/fpo/FpoPage'));
const FarmerPage = lazy(() => import('./features/farmer/FarmerPage'));
const CitizenPage = lazy(() => import('./features/citizen/CitizenPage'));
const OpsPage = lazy(() => import('./features/ops/OpsPage'));

function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <Link to="/" className="btn btn-primary">Back to TerraPulse</Link>
    </main>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-10 w-1/2" /><Skeleton className="h-64 w-full" /><Skeleton className="h-40 w-full" />
    </div>
  );
}

export function App() {
  const location = useLocation();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => pageEnter(wrap.current), [location.pathname]);
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <div ref={wrap}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/policy" element={<PolicyPage />} />
            <Route path="/fpo" element={<FpoPage />} />
            <Route path="/farmer" element={<FarmerPage />} />
            <Route path="/citizen" element={<CitizenPage />} />
            <Route path="/ops" element={<OpsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </div>
      <TourBar />
    </>
  );
}
