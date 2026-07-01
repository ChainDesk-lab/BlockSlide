"use client";

import { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { miniPayWagmiConfig } from "../src/auth/miniPayWagmi";
import { MiniPayBridge } from "../src/auth/MiniPayBridge";
import { MagicBridge } from "../src/auth/MagicBridge";
import { AuthSelectionProvider } from "../src/contexts/AuthSelectionContext";
import { NoGasProvider } from "../src/contexts/NoGasContext";
import { ToastProvider } from "../src/contexts/ToastContext";
import ToastContainer from "../src/components/ToastContainer";
import App from "../src/App";

const queryClient = new QueryClient();

// Detect whether we're running inside MiniPay. MiniPay injects window.ethereum
// (and sets isMiniPay) asynchronously and can set the provider object slightly
// before the flag, so we poll briefly. Returns null while still detecting.
function useDetectMiniPay(): boolean | null {
  const [isMiniPay, setIsMiniPay] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flagged = () =>
      (window.ethereum as { isMiniPay?: boolean } | undefined)?.isMiniPay === true;

    if (flagged()) {
      setIsMiniPay(true);
      return;
    }

    let resolved = false;
    const interval = setInterval(() => {
      if (flagged()) {
        setIsMiniPay(true);
        resolved = true;
        clearInterval(interval);
      }
    }, 50);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (!resolved) setIsMiniPay(false);
    }, 800);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  return isMiniPay;
}

export default function AppRoot() {
  const isMiniPay = useDetectMiniPay();

  // Brief (<=800ms) detection window before we know which wallet world to mount.
  if (isMiniPay === null) {
    return (
      <div className="login-screen">
        <div className="login-container">
          <div className="login-header">
            <h1 className="login-title">BlockSlide</h1>
            <p className="login-subtitle">Getting ready…</p>
          </div>
          <div className="login-options">
            <span className="spinner" aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  // Inside MiniPay: plain wagmi + injected connector (wallet-only, no tabs).
  if (isMiniPay) {
    return (
      <ToastProvider>
        <AuthSelectionProvider defaultAuth="wallet">
          <WagmiProvider config={miniPayWagmiConfig}>
            <QueryClientProvider client={queryClient}>
              <MiniPayBridge>
                <NoGasProvider>
                  <ToastContainer />
                  <App />
                </NoGasProvider>
              </MiniPayBridge>
            </QueryClientProvider>
          </WagmiProvider>
        </AuthSelectionProvider>
      </ToastProvider>
    );
  }

  // Regular browser: both email and wallet signup options via tabs
  return (
    <ToastProvider>
      <AuthSelectionProvider>
        <WagmiProvider config={miniPayWagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <MiniPayBridge>
              <MagicBridge>
                <NoGasProvider>
                  <ToastContainer />
                  <App />
                </NoGasProvider>
              </MagicBridge>
            </MiniPayBridge>
          </QueryClientProvider>
        </WagmiProvider>
      </AuthSelectionProvider>
    </ToastProvider>
  );
}
