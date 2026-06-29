"use client";

import { createContext, useContext } from "react";

export type AuthType = "minipay" | "web3auth" | null;

/**
 * Uniform auth surface consumed by the app, regardless of whether the user is
 * inside MiniPay (injected wallet) or on a regular browser (Web3Auth email /
 * external wallet). The matching bridge component (MiniPayBridge or
 * Web3AuthBridge) fills this in from the underlying SDK so that App,
 * LoginScreen and WalletButton never call Web3Auth hooks directly — which
 * matters because the MiniPay tree has no Web3AuthProvider.
 */
export interface AuthValue {
  /** Fully authenticated: a usable wallet address is connected. */
  isConnected: boolean;
  address?: `0x${string}`;
  /** Underlying SDK/connector is ready to accept a login. */
  isReady: boolean;
  /** A login attempt is in flight. */
  loading: boolean;
  error: string | null;
  authType: AuthType;
  login: () => void | Promise<void>;
  logout: () => void | Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within MiniPayBridge or Web3AuthBridge");
  }
  return value;
}

/** Shared error-message normaliser used by both bridges. */
export function authErrMessage(e: unknown): string | null {
  if (!e) return null;
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const o = e as { message?: string; code?: number };
    if (o.message) return o.code ? `${o.message} (code ${o.code})` : o.message;
  }
  return String(e);
}
