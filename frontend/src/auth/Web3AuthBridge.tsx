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

  // Gate on Web3Auth's own isConnected (not just a wagmi address): connecting an
  // external wallet exposes an address mid-handshake before sign-in completes.
  const value: AuthValue = {
    isConnected: !!isConnected && !!address,
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
