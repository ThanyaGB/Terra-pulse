/** Registers the service worker in production builds only (it would fight Vite's dev server otherwise). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is an enhancement; the app works without it */
    });
  });
}
