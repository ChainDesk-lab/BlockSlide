"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { AuthContext, type AuthValue } from "./AuthContext";
import { miniPayConnector } from "./miniPayWagmi";

/**
 * Publishes MiniPay (injected) state to the shared AuthContext and drives
 * auto-connect. Ported from FocusPet's <MiniPayConnector>: MiniPay injects
 * window.ethereum asynchronously and the first connect() can silently reject,
 * so we retry at 0.8s, then 1s/2s/3s/4s. Must be rendered inside the MiniPay
 * <WagmiProvider>.
 */
export function MiniPayBridge({ children }: { children: ReactNode }) {
  const { address, isConnected, connector } = useAccount();
  const { connect, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (connector?.id === "injected") return; // already connected
    if (attempt > 4) return; // give up after retries
    const delay = attempt === 0 ? 800 : attempt * 1000;
    const timer = setTimeout(() => {
      if (!(window.ethereum as { isMiniPay?: boolean } | undefined)?.isMiniPay) return;
      connect({ connector: miniPayConnector });
    }, delay);
    return () => clearTimeout(timer);
  }, [connector, connect, attempt]);

  useEffect(() => {
    if (connectError && attempt < 4) setAttempt((a) => a + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectError]);

  const connecting = !isConnected && attempt <= 4;

  const value: AuthValue = {
    // Injected connector reports isConnected and address together, but keep the
    // signals independent to match MagicBridge and the App gate's 3-state
    // logic (isConnected = "auth established", address checked separately).
    isConnected,
    address,
    isReady: true,
    loading: connecting,
    isFundingWallet: false, // MiniPay doesn't need wallet funding
    // Auto-connect hiccups are transient and self-heal via retries; only
    // surface an error once we've exhausted them.
    error: connectError && attempt > 4 ? "Couldn't connect to MiniPay — reopen the app." : null,
    authType: "minipay",
    login: () => {
      setAttempt(0);
      connect({ connector: miniPayConnector });
    },
    logout: () => {
      disconnect();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
