"use client";

import { useEffect, type ReactNode } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { AuthContext, type AuthValue } from "./AuthContext";

/**
 * Publishes Web3 wallet state (MetaMask, WalletConnect) to the shared AuthContext.
 * Handles browser-based wallet connections without MiniPay.
 */
export function WalletBridge({ children }: { children: ReactNode }) {
  const { address, isConnected, connector } = useAccount();
  const { disconnect } = useDisconnect();

  const value: AuthValue = {
    isConnected,
    address,
    isReady: true,
    loading: false,
    isFundingWallet: false,
    error: null,
    authType: "minipay", // Keep name for compatibility, but this is now browser wallets
    login: () => {
      // Login happens via WalletSelector modal, not here
    },
    logout: () => {
      disconnect();
    },
  };

  // Always provide AuthContext so nested components can use useAuth()
  // useCleanAuth() filters to only use this if selectedAuth === "wallet"
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
