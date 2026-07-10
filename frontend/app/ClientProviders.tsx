"use client";

import type { ReactNode } from "react";
import { DualAuthBridge } from "../src/auth/DualAuthBridge";
import { NoGasProvider } from "../src/contexts/NoGasContext";
import { ToastProvider } from "../src/contexts/ToastContext";
import ToastContainer from "../src/components/ToastContainer";

// One-time localStorage reset — runs at module evaluation before any provider
// or wagmi code initialises. Clears corrupted wagmi/magic connection state
// written during the broken deploy window. The version key ensures it fires
// exactly once per browser, not on every page load.
if (typeof window !== "undefined") {
  const RESET_KEY = "blockslide.storage.reset.v1";
  if (!localStorage.getItem(RESET_KEY)) {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("wagmi") || key.startsWith("magic")) {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem(RESET_KEY, "1");
  }
}

/**
 * All React context providers live here, mounted once in the root layout.
 * Every page (/ and /leaderboard) inherits the same provider tree through
 * Next.js App Router's layout persistence — providers are never re-instantiated
 * on page navigation, so wallet connection state survives across routes.
 *
 * NEVER instantiate these providers inside a page or page-level component.
 */
export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DualAuthBridge>
        <NoGasProvider>
          <ToastContainer />
          {children}
        </NoGasProvider>
      </DualAuthBridge>
    </ToastProvider>
  );
}
