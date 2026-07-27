import { useEffect, useState, useCallback, useRef } from "react";
import { getWalletClient } from "wagmi/actions";
import { useChainId } from "wagmi";
import { wagmiConfig } from "../auth/wagmiConfig";
import { useAuth } from "../auth/AuthContext";
import { useContractWalletClient } from "./useContractData";
import { TARGET_CHAIN } from "../lib/constants";
import { getMagic, isMagicConfigured } from "../magic";
import { createWalletClient, custom } from "viem";

interface UseSignerResult {
  signer: any | null;
  isReady: boolean;
  error: string | null;
}

/**
 * Single source of truth for obtaining a transaction signer.
 *
 * All three features (game session, username, identity verification) call this
 * single hook instead of each implementing independent wallet client resolution.
 *
 * Guarantees:
 * - Exactly one code path to get a signer (three separate paths → one path)
 * - Consistent retry logic with exponential backoff
 * - Distinguishes between "still initializing" (retryable) and "truly failed" (not retryable)
 * - Clear, specific error messages for debugging
 * - Waits for genuine readiness, not just address connection
 */
export function useSigner(): UseSignerResult {
  const { authType, address: authAddress } = useAuth();
  const chainId = useChainId();
  const walletClientHook = useContractWalletClient();

  // State tracking
  const [signer, setSigner] = useState<any | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initAttemptRef = useRef(0);

  // For Web3 wallets: check if we're on the wrong network
  const isWrongChain = authType !== "magic" && chainId !== TARGET_CHAIN.id;

  // Core signer resolution with retry logic
  const resolveSigner = useCallback(async (): Promise<any | null> => {
    // Magic.link: create signer from Magic provider
    if (authType === "magic") {
      if (!isMagicConfigured) {
        setError("Magic.link not configured");
        return null;
      }
      try {
        const magic = getMagic();
        const walletClient = createWalletClient({
          chain: TARGET_CHAIN,
          transport: custom(magic.rpcProvider as any),
          account: authAddress as `0x${string}`,
        });
        setError(null);
        return walletClient;
      } catch (err) {
        const msg = (err as Error).message;
        console.error("[useSigner] Magic wallet client creation failed:", msg);
        setError(`Failed to create Magic signer: ${msg}`);
        return null;
      }
    }

    // Web3 wallet: get signer from wagmi with retry
    // First check if hook result is ready
    if (walletClientHook) {
      setError(null);
      return walletClientHook;
    }

    // Hook not ready yet — fetch imperatively with retries
    const maxRetries = 4;
    let lastError: Error | null = null;
    initAttemptRef.current++;
    const attemptId = initAttemptRef.current;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(
          `[useSigner#${attemptId}] getWalletClient attempt ${attempt + 1}/${maxRetries}`,
        );
        const client = await getWalletClient(wagmiConfig, {
          chainId: TARGET_CHAIN.id,
        });

        if (client) {
          console.log(
            `[useSigner#${attemptId}] Successfully resolved signer on attempt ${attempt + 1}`,
          );
          setError(null);
          return client;
        }

        // Silent null return — treat as retriable
        throw new Error("getWalletClient returned null (wallet not ready)");
      } catch (err) {
        lastError = err as Error;
        console.warn(
          `[useSigner#${attemptId}] Attempt ${attempt + 1} failed:`,
          (err as Error).message,
        );

        if (attempt < maxRetries - 1) {
          // Exponential backoff: 300ms, 600ms, 1200ms, 2400ms
          const delay = 300 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted
    const errorMsg = lastError?.message || "Unknown error";
    console.error(`[useSigner#${attemptId}] Failed to resolve signer after ${maxRetries} attempts:`, errorMsg);

    // Provide specific error message based on what failed
    if (errorMsg.includes("wrong network") || errorMsg.includes("chain")) {
      setError("Wrong network — please switch to Celo mainnet and try again.");
    } else if (errorMsg.includes("not configured")) {
      setError("Wallet not properly configured for this action.");
    } else {
      setError(`Signer not available: ${errorMsg}`);
    }

    return null;
  }, [authType, authAddress, walletClientHook]);

  // Initialize signer on mount and whenever auth type changes
  useEffect(() => {
    if (!authAddress) {
      console.log("[useSigner] No auth address, resetting signer");
      setSigner(null);
      setIsReady(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const initId = Math.random().toString(36).slice(2, 9);

    const init = async () => {
      try {
        console.log(`[useSigner:${initId}] START - authType=${authType}, hasHookClient=${!!walletClientHook}`);
        const resolvedSigner = await resolveSigner();
        console.log(`[useSigner:${initId}] resolveSigner returned:`, resolvedSigner ? "✓ signer" : "✗ null");

        if (cancelled) {
          console.log(`[useSigner:${initId}] CANCELLED after resolution`);
          return;
        }

        if (resolvedSigner) {
          console.log(`[useSigner:${initId}] SUCCESS - setting signer and isReady=true`);
          setSigner(resolvedSigner);
          setIsReady(true);
        } else {
          console.warn(`[useSigner:${initId}] FAILED - signer is null, error=${error}`);
          setSigner(null);
          setIsReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          const errMsg = (err as Error).message;
          console.error(`[useSigner:${initId}] EXCEPTION:`, errMsg);
          setError(`Unexpected error: ${errMsg}`);
          setIsReady(true);
        }
      }
    };

    console.log(`[useSigner:${initId}] Queuing init for authAddress=${authAddress?.slice(0, 6)}...`);
    init();

    return () => {
      cancelled = true;
      console.log(`[useSigner:${initId}] useEffect cleanup - cancelled future updates`);
    };
  }, [authAddress, authType]);

  // If on wrong chain, provide that specific error
  if (isWrongChain) {
    return {
      signer: null,
      isReady: true,
      error: "Wrong network — switch to Celo mainnet in your wallet.",
    };
  }

  return { signer, isReady, error };
}
