"use client";

import { ReactNode, Suspense } from "react";
import { DualAuthBridge } from "../src/auth/DualAuthBridge";
import { NoGasProvider } from "../src/contexts/NoGasContext";
import { ToastProvider } from "../src/contexts/ToastContext";
import { FlowstateVotingProvider } from "../src/contexts/FlowstateVotingContext";
import ToastContainer from "../src/components/ToastContainer";
import { NetworkGuardBanner } from "../src/components/NetworkGuardBanner";
import AppShell from "../src/components/AppShell";
import { useRefCapture } from "../src/hooks/useRefCapture";

function RefCaptureWrapper() {
  useRefCapture();
  return null;
}

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DualAuthBridge>
        <NoGasProvider>
          <FlowstateVotingProvider>
            <RefCaptureWrapper />
            <NetworkGuardBanner />
            <ToastContainer />
            <Suspense fallback={<div>{children}</div>}>
              <AppShell>{children}</AppShell>
            </Suspense>
          </FlowstateVotingProvider>
        </NoGasProvider>
      </DualAuthBridge>
    </ToastProvider>
  );
}
