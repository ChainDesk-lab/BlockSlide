"use client";

import { DualAuthBridge } from "../src/auth/DualAuthBridge";
import { NoGasProvider } from "../src/contexts/NoGasContext";
import { ToastProvider } from "../src/contexts/ToastContext";
import ToastContainer from "../src/components/ToastContainer";
import App from "../src/App";

export default function AppRoot() {
  return (
    <ToastProvider>
      <DualAuthBridge>
        <NoGasProvider>
          <ToastContainer />
          <App />
        </NoGasProvider>
      </DualAuthBridge>
    </ToastProvider>
  );
}
