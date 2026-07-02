"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { AuthContext, type AuthValue } from "./AuthContext";
import { useAuthSelection } from "../contexts/AuthSelectionContext";
import { getMagic, isMagicConfigured } from "../magic";

/**
 * Single source of truth for auth state.
 *
 * Replaces the previous nested WalletBridge > MagicBridge design, where React
 * context resolution meant the inner bridge (Magic) always shadowed the outer
 * one (Wallet) — so `useAuth()` could never see a Web3 wallet connection and
 * the app stayed on the login screen no matter how cleanly wagmi connected.
 *
 * Here both auth systems live in one component. We track wagmi (wallet) and
 * Magic (email) state simultaneously, then expose exactly one of them through
 * AuthContext based on the user's selected auth method. authType stays
 * "minipay" for wallets / "magic" for email so downstream hooks
 * (useContractData, etc.) pick the correct address, client and signer.
 */
export function UnifiedAuthBridge({ children }: { children: ReactNode }) {
  const { selectedAuth } = useAuthSelection();

  // ---- Web3 wallet state (wagmi) ----
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const clearWagmiStorage = () => {
    if (typeof localStorage === "undefined") return;
    Object.keys(localStorage)
      .filter((key) => key.startsWith("wagmi."))
      .forEach((key) => {
        localStorage.removeItem(key);
        console.log(`[UnifiedAuth] Cleared localStorage: ${key}`);
      });
  };

  const walletLogout = async () => {
    console.log("[UnifiedAuth] Wallet logout...");
    disconnect();
    await new Promise((resolve) => setTimeout(resolve, 300));
    clearWagmiStorage();
    console.log("[UnifiedAuth] Wallet logout complete");
  };

  // ---- Magic.link (email) state ----
  const [magicReady, setMagicReady] = useState(false);
  const [magicConnected, setMagicConnected] = useState(false);
  const [magicAddress, setMagicAddress] = useState<`0x${string}` | undefined>();
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);
  const [isFundingWallet, setIsFundingWallet] = useState(false);

  // Restore an existing Magic session on mount (runs regardless of selection so
  // an email user who reloads stays logged in).
  useEffect(() => {
    if (!isMagicConfigured) {
      setMagicReady(true);
      return;
    }

    const checkAuth = async () => {
      try {
        const magic = getMagic();
        const isLoggedIn = await magic.user.isLoggedIn();

        if (isLoggedIn) {
          const provider = magic.rpcProvider;
          const accounts = await (provider as any).request({
            method: "eth_requestAccounts",
          });
          if (accounts && accounts.length > 0) {
            setMagicAddress(accounts[0] as `0x${string}`);
            setMagicConnected(true);
          }
        }
      } catch (err) {
        console.error("Error checking Magic auth:", err);
      } finally {
        setMagicReady(true);
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
        // Wait for the tx to be mined so the balance is ready before the user
        // signs their username tx.
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

  const magicLogin = async (email: string) => {
    if (!isMagicConfigured) {
      setMagicError(
        "Email login is not available. Magic.link API key is missing. " +
          "Please contact support or try again later."
      );
      return;
    }

    setMagicLoading(true);
    setMagicError(null);

    try {
      console.log("🔵 Starting Magic.link login for:", email);
      const magic = getMagic();

      console.log("📧 Sending magic link to email...");
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Magic.link timeout: email confirmation took too long")),
          60000
        )
      );

      const didToken = await Promise.race([
        magic.auth.loginWithMagicLink({ email, showUI: true }),
        timeoutPromise,
      ]);

      console.log("✅ Magic link sent! Check your email for the confirmation link.");

      if (didToken) {
        console.log("🔐 didToken received, getting wallet address...");
        const provider = magic.rpcProvider;
        const accounts = await (provider as any).request({
          method: "eth_requestAccounts",
        });
        if (accounts && accounts.length > 0) {
          const userAddress = accounts[0] as `0x${string}`;
          console.log("💰 Wallet address:", userAddress);
          setMagicAddress(userAddress);
          setMagicConnected(true);

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
          message = err.message || "Failed to sign in with Magic.link";
        }
      }

      setMagicError(message);
      console.error("🔴 Magic.link login error:", {
        errorMsg: err instanceof Error ? err.message : String(err),
        isMagicConfigured,
      });
    } finally {
      setMagicLoading(false);
    }
  };

  const magicLogout = async () => {
    try {
      console.log("[UnifiedAuth] Magic logout...");
      const magic = getMagic();
      await magic.user.logout();
      setMagicConnected(false);
      setMagicAddress(undefined);
      // Clear any wagmi state too, in case the user also connected a wallet.
      clearWagmiStorage();
      console.log("[UnifiedAuth] Magic logout complete");
    } catch (err) {
      console.error("Magic logout error:", err);
    }
  };

  // Expose exactly one auth surface based on the user's selection.
  const value: AuthValue =
    selectedAuth === "wallet"
      ? {
          isConnected: wagmiConnected,
          address: wagmiAddress,
          isReady: true,
          loading: false,
          isFundingWallet: false,
          error: null,
          authType: "minipay", // Web3 wallet (name kept for downstream compatibility)
          login: async () => {
            // Connection is initiated via the WalletSelector modal, not here.
          },
          logout: walletLogout,
        }
      : {
          isConnected: magicConnected,
          address: magicAddress,
          isReady: magicReady,
          loading: magicLoading,
          isFundingWallet,
          error: magicError,
          authType: "magic",
          login: async (email?: string) => {
            if (!email) {
              setMagicError("Email is required for Magic login");
              return;
            }
            await magicLogin(email);
          },
          logout: magicLogout,
        };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
