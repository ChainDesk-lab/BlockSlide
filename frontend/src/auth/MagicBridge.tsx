"use client";

import { type ReactNode, useEffect, useState } from "react";
import { AuthContext, type AuthValue } from "./AuthContext";
import { getMagic, isMagicConfigured } from "../magic";

/**
 * Magic.link bridge - handles email authentication via magic links.
 * Manages Magic auth state separately; wagmi reads contracts via Magic's RPC provider.
 * Only provides AuthContext when "email" auth type is selected in dual-auth mode.
 */
export function MagicBridge({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFundingWallet, setIsFundingWallet] = useState(false);

  // Auto-connect if user is already logged in
  useEffect(() => {
    if (!isMagicConfigured) {
      setIsReady(true);
      return;
    }

    const checkAuth = async () => {
      try {
        const magic = getMagic();
        const isLoggedIn = await magic.user.isLoggedIn();

        if (isLoggedIn) {
          // Get user's wallet address via the provider
          const provider = magic.rpcProvider;
          const accounts = await (provider as any).request({
            method: "eth_requestAccounts",
          });
          if (accounts && accounts.length > 0) {
            setAddress(accounts[0] as `0x${string}`);
            setIsConnected(true);
          }
        }
      } catch (err) {
        console.error("Error checking Magic auth:", err);
      } finally {
        setIsReady(true);
      }
    };

    checkAuth();
  }, []);

  const fundNewWallet = async (address: `0x${string}`, email: string) => {
    setIsFundingWallet(true);
    try {
      const response = await fetch("/api/fund-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, email }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        txHash?: string;
        message?: string;
        error?: string;
      };

      if (!response.ok || !data.success) {
        console.warn(
          `⚠️  Wallet funding failed or not needed: ${data.error || data.message || "Unknown error"}`
        );
        setIsFundingWallet(false);
        return;
      }

      if (data.txHash) {
        console.log(`✅ Wallet auto-funded. Tx: ${data.txHash}`);
        // For new wallets with tx, wait a moment for the tx to be mined
        // This ensures the balance is updated before user tries to sign username tx
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        console.log(`ℹ️  Wallet already has sufficient balance.`);
      }
    } catch (err) {
      console.error("Error initiating wallet funding:", err);
      // Don't block login on funding error - user can still play, just may need CELO
    } finally {
      setIsFundingWallet(false);
    }
  };

  const login = async (email: string) => {
    if (!isMagicConfigured) {
      setError(
        "Email login is not available. Magic.link API key is missing. " +
        "Please contact support or try again later."
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("🔵 Starting Magic.link login for:", email);
      const magic = getMagic();

      // Send magic link to email with Magic's built-in UI
      console.log("📧 Sending magic link to email...");

      // Create a timeout promise to prevent infinite hangs
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Magic.link timeout: email confirmation took too long")), 60000)
      );

      const didToken = await Promise.race([
        magic.auth.loginWithMagicLink({
          email,
          showUI: true, // Show Magic's popup with email confirmation
        }),
        timeoutPromise,
      ]);

      console.log("✅ Magic link sent! Check your email for the confirmation link.");

      // At this point, Magic sends the link but doesn't authenticate yet.
      // The promise resolves when user clicks the link and this page detects it.
      // For now, just show success message and wait for redirect.

      if (didToken) {
        console.log("🔐 didToken received, getting wallet address...");
        // Get wallet address via the provider
        const provider = magic.rpcProvider;
        const accounts = await (provider as any).request({
          method: "eth_requestAccounts",
        });
        if (accounts && accounts.length > 0) {
          const userAddress = accounts[0] as `0x${string}`;
          console.log("💰 Wallet address:", userAddress);
          setAddress(userAddress);
          setIsConnected(true);

          // Initiate wallet funding and await completion before considering login fully done
          // This prevents race condition where user tries to sign username tx before wallet is funded
          console.log("🚀 Funding wallet...");
          await fundNewWallet(userAddress, email);
          console.log("✨ Login complete!");
        }
      }
    } catch (err) {
      let message = "Failed to sign in with Magic.link";

      if (err instanceof Error) {
        const errorMsg = err.message.toLowerCase();
        if (errorMsg.includes("magic.link is not configured") || errorMsg.includes("api key")) {
          message = "❌ Magic.link not configured. Email signup is not available right now.";
        } else if (errorMsg.includes("user denied") || errorMsg.includes("cancel")) {
          message = "Sign-in cancelled. No magic link was sent.";
        } else if (errorMsg.includes("invalid email")) {
          message = "Please enter a valid email address.";
        } else if (errorMsg.includes("network") || errorMsg.includes("fetch")) {
          message = "Network error. Please check your connection and try again.";
        } else if (errorMsg.includes("timeout")) {
          message = "Email confirmation took too long. Please try again and confirm within 1 minute.";
        } else {
          // Show the actual error for debugging
          message = err.message || "Failed to sign in with Magic.link";
        }
      }

      setError(message);
      console.error("🔴 Magic.link login error:", {
        errorMsg: err instanceof Error ? err.message : String(err),
        isMagicConfigured,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      const magic = getMagic();
      await magic.user.logout();
      setIsConnected(false);
      setAddress(undefined);
    } catch (err) {
      console.error("Magic logout error:", err);
    }
  };

  const value: AuthValue = {
    isConnected,
    address,
    isReady,
    loading,
    isFundingWallet,
    error,
    authType: "magic",
    login: async (email?: string) => {
      if (!email) {
        setError("Email is required for Magic login");
        return;
      }
      await login(email);
    },
    logout,
  };

  // Always provide AuthContext so nested components can use useAuth()
  // useCleanAuth() filters to only use this if selectedAuth === "email"
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
