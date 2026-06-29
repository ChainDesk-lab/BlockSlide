"use client";

import { type ReactNode } from "react";
import { useAccount } from "wagmi";
import {
  useWeb3Auth,
  useWeb3AuthConnect,
  useWeb3AuthDisconnect,
} from "@web3auth/modal/react";
import { AuthContext, authErrMessage, type AuthValue } from "./AuthContext";

/**
 * Publishes Web3Auth state to the shared AuthContext for non-MiniPay users.
 * Must be rendered inside <Web3AuthProvider> + Web3Auth's <WagmiProvider>.
 */
export function Web3AuthBridge({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { isInitialized, isConnected, initError } = useWeb3Auth();
  const { connect, loading, error: connectError } = useWeb3AuthConnect();
  const { disconnect } = useWeb3AuthDisconnect();

  // `isConnected` is Web3Auth's OWN auth state — the source of truth for "is the
  // user signed in". Do NOT AND it with the wagmi `address`: the SDK populates
  // the wagmi account in a useEffect that runs *after* isConnected flips true
  // (reconnectOnMount is false), so there's always a window where isConnected is
  // true but address is still undefined. Gating on `isConnected && address` here
  // makes that window look "logged out" → LoginScreen re-renders → its button
  // re-fires connect() → login loop. The App gate handles the address-pending
  // window separately (FinishingSignIn), so keep these two signals independent.
  const value: AuthValue = {
    isConnected: !!isConnected,
    address,
    isReady: isInitialized,
    loading,
    error: authErrMessage(connectError) ?? authErrMessage(initError),
    authType: "web3auth",
    login: async () => {
      await connect();
    },
    logout: () => {
      disconnect();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
