"use client";

import { useEffect, useState } from "react";
import { Web3AuthProvider } from "@web3auth/modal/react";
import { WagmiProvider as Web3AuthWagmiProvider } from "@web3auth/modal/react/wagmi";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { web3AuthContextConfig } from "../src/web3auth";
import { miniPayWagmiConfig } from "../src/auth/miniPayWagmi";
import { MiniPayBridge } from "../src/auth/MiniPayBridge";
import { Web3AuthBridge } from "../src/auth/Web3AuthBridge";
import { NoGasProvider } from "../src/contexts/NoGasContext";
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

  // Inside MiniPay: plain wagmi + injected connector, no Web3Auth at all.
  if (isMiniPay) {
    return (
      <WagmiProvider config={miniPayWagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <MiniPayBridge>
            <NoGasProvider>
              <App />
            </NoGasProvider>
          </MiniPayBridge>
        </QueryClientProvider>
      </WagmiProvider>
    );
  }

  // Regular browser: Web3Auth (email passwordless + external wallets).
  return (
    <Web3AuthProvider config={web3AuthContextConfig}>
      <QueryClientProvider client={queryClient}>
        <Web3AuthWagmiProvider>
          <Web3AuthBridge>
            <NoGasProvider>
              <App />
            </NoGasProvider>
          </Web3AuthBridge>
        </Web3AuthWagmiProvider>
      </QueryClientProvider>
    </Web3AuthProvider>
  );
}
