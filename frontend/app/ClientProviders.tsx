"use client";

import type { ReactNode } from "react";
import { DualAuthBridge } from "../src/auth/DualAuthBridge";
import { NoGasProvider } from "../src/contexts/NoGasContext";
import { ToastProvider } from "../src/contexts/ToastContext";
import ToastContainer from "../src/components/ToastContainer";

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
