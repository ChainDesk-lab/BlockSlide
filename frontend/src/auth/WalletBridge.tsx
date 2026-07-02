"use client";

import { type ReactNode } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { AuthContext, type AuthValue } from "./AuthContext";

/**
 * Publishes Web3 wallet state (MetaMask, WalletConnect) to the shared AuthContext.
 * Handles browser-based wallet connections without MiniPay.
 */
export function WalletBridge({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const clearWagmiStorage = () => {
    // wagmi stores connection state in localStorage under several keys
    // These must be cleared on disconnect to prevent "Connector already connected" errors on re-login
    const keysToRemove = [
      "wagmi.store",              // Main wagmi state store
      "wagmi.recentConnectorId",  // Recent connector ID
      "wagmi.connectors",         // Connector list
    ];

    keysToRemove.forEach((key) => {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(key);
        console.log(`[WalletBridge] Cleared localStorage: ${key}`);
      }
    });

    // Also clear any localStorage keys starting with "wagmi."
    if (typeof localStorage !== "undefined") {
      const keysToDelete = Object.keys(localStorage)
        .filter((key) => key.startsWith("wagmi."))
        .filter((key) => !keysToRemove.includes(key)); // Don't double-log

      keysToDelete.forEach((key) => {
        localStorage.removeItem(key);
        console.log(`[WalletBridge] Cleared localStorage: ${key}`);
      });
    }
  };

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
    logout: async () => {
      console.log("[WalletBridge] Starting logout...");
      // Disconnect from wagmi (async operation)
      disconnect();
      // Wait for disconnect to fully process
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Clear wagmi's localStorage to prevent "Connector already connected" on re-login
      clearWagmiStorage();
      console.log("[WalletBridge] Logout complete");
    },
  };

  // Always provide AuthContext so nested components can use useAuth()
  // useCleanAuth() filters to only use this if selectedAuth === "wallet"
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
