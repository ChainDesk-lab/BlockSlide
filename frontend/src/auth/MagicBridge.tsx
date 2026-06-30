"use client";

import { type ReactNode, useEffect, useState } from "react";
import { AuthContext, type AuthValue } from "./AuthContext";
import { getMagic, isMagicConfigured } from "../magic";

/**
 * Magic.link bridge - handles email authentication via magic links.
 * No device verification, no MFA prompts, purely frictionless email signup/login.
 */
export function MagicBridge({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if user is already logged in via Magic
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
          // Magic creates an EVM wallet on email login
          // The address is accessible through the provider
          const provider = magic.rpcProvider;
          const accounts = await (provider as any).request({
            method: "eth_accounts",
          });
          if (accounts && accounts.length > 0) {
            setAddress(accounts[0] as `0x${string}`);
            setIsConnected(true);
          }
        }
      } catch (err) {
        console.error("Error checking Magic auth status:", err);
      } finally {
        setIsReady(true);
      }
    };

    checkAuth();
  }, []);

  const login = async (email: string) => {
    if (!isMagicConfigured) {
      setError("Magic is not configured");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const magic = getMagic();

      // Send magic link to email
      const didToken = await magic.auth.loginWithMagicLink({
        email,
        showUI: true, // Show Magic's UI for email verification
      });

      if (didToken) {
        // Get user's wallet address from the provider
        const provider = magic.rpcProvider;
        const accounts = await (provider as any).request({
          method: "eth_accounts",
        });
        if (accounts && accounts.length > 0) {
          setAddress(accounts[0] as `0x${string}`);
          setIsConnected(true);
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to login with Magic";
      setError(message);
      console.error("Magic login error:", err);
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
