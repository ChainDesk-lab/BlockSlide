"use client";

import { DualAuthBridge } from "../src/auth/DualAuthBridge";
import { NoGasProvider } from "../src/contexts/NoGasContext";
import { ToastProvider } from "../src/contexts/ToastContext";
import ToastContainer from "../src/components/ToastContainer";
import { NetworkGuardBanner } from "../src/components/NetworkGuardBanner";
import App from "../src/App";
import { useRefCapture } from "../src/hooks/useRefCapture";

function RefCaptureWrapper() {
  useRefCapture();
  return null;
}

export default function AppRoot() {
  return (
    <ToastProvider>
      <DualAuthBridge>
        <NoGasProvider>
          <RefCaptureWrapper />
          <NetworkGuardBanner />
          <ToastContainer />
          <App />
        </NoGasProvider>
      </DualAuthBridge>
    </ToastProvider>
  );
}
