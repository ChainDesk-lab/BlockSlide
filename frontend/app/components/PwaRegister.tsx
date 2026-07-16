"use client";

import { useEffect } from "react";

// PWA has been rolled back. This component unregisters any existing service
// workers and clears all cache storage so users running stale cached bundles
// self-heal. Keep this file deployed — removing it would leave the old service
// worker permanently in control for users who never trigger an update check.
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const reg of registrations) {
            reg.unregister();
          }
        })
        .catch(() => {});
    }

    if (typeof caches !== "undefined") {
      caches
        .keys()
        .then((names) => {
          for (const name of names) {
            caches.delete(name);
          }
        })
        .catch(() => {});
    }
  }, []);

  return null;
}
