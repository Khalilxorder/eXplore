'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    let cancelled = false;
    const registerWorker = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        // Installability should fail soft; the app shell still works without the worker.
      }
    };

    if (document.readyState === 'complete') {
      void registerWorker();
    } else {
      window.addEventListener('load', registerWorker, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('load', registerWorker);
    };
  }, []);

  return null;
}
