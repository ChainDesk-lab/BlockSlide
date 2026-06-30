"use client";

import { type ReactNode, useEffect, useState } from "react";
import { AuthContext, type AuthValue } from "./AuthContext";
import { getMagic, isMagicConfigured } from "../magic";

/**
 * Magic.link bridge - handles email authentication via magic links.
 * Manages Magic auth state separately; wagmi reads contracts via Magic's RPC provider.
 */
export function MagicBridge({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const magic = getMagic();

      // Send magic link to email
      const didToken = await magic.auth.loginWithMagicLink({
        email,
        showUI: true,
      });

      if (didToken) {
        // Get wallet address via the provider
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
      let message = "Failed to sign in with Magic.link";

      if (err instanceof Error) {
        if (err.message.includes("Magic.link is not configured")) {
          message = "Email login is not configured. Please try again later.";
        } else if (err.message.includes("User denied")) {
          message = "You cancelled the sign-in. Please try again.";
        } else {
          message = err.message;
        }
      }

      setError(message);
      console.error("Magic.link login error:", err);
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
