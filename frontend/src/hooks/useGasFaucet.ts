import { useCallback, useState, useEffect } from "react";
import { usePublicClient } from "wagmi";
import { triggerFaucet, chainConfigs, type SupportedChains } from "@goodsdks/citizen-sdk";
import { useSigner } from "./useSigner";
import { useContractAddress } from "./useContractData";
import { TARGET_CHAIN } from "../lib/constants";

const LOW_GAS_THRESHOLD = 1_000_000_000_000_000n; // 0.001 CELO (sufficient for Celo gas costs)
const FAUCET_ENV = "production" as const;

// Resolved from the SDK's own chain registry rather than hardcoded — GoodDollar
// can (and has) migrated this contract, and the SDK is the source of truth for
// which address is currently live per chain/env.
const FAUCET_ADDRESS = chainConfigs[TARGET_CHAIN.id as SupportedChains]?.contracts[FAUCET_ENV]
  ?.faucetContract;

export interface GasTopUpResult {
  ok: boolean;
  /** Fresh, ready-to-display error — never read component state right after
   *  calling topUpGasIfNeeded(), since that state hasn't re-rendered yet. */
  error: string | null;
}

interface UseGasFaucetResult {
  isTopingUpGas: boolean;
  topUpGasIfNeeded: () => Promise<GasTopUpResult>;
  error: string | null;
}

/**
 * Gas faucet hook for GoodDollar's sponsored gas feature
 * Integrates @goodsdks/citizen-sdk's triggerFaucet to top up CELO for verified players
 *
 * Handles:
 * - Checking current CELO balance
 * - Triggering faucet only when balance is below threshold
 * - Handling all faucet response states (skipped, topped_via_contract, topped_via_api, error)
 * - Providing clear error messages to users
 */
export function useGasFaucet(): UseGasFaucetResult {
  const address = useContractAddress();
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN.id });
  const { signer } = useSigner();

  const [isTopingUpGas, setIsTopingUpGas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  // Fetch balance directly via RPC (not wagmi) since Magic wallets aren't wagmi connectors
  // and wagmi's useBalance may return stale/undefined data for embedded wallets
  useEffect(() => {
    if (!address || !publicClient) {
      setBalance(null);
      return;
    }

    const fetchBalance = async () => {
      try {
        const rawBalance = await publicClient.getBalance({ address });
        setBalance(rawBalance);
        console.log(`[Gas Faucet] Balance fetched: ${rawBalance.toLocaleString()} wei`);
      } catch (err) {
        console.error("[Gas Faucet] Failed to fetch balance:", err);
        setBalance(null);
      }
    };

    fetchBalance();
    // Refetch balance every 5 seconds to detect when faucet has topped up
    const interval = setInterval(fetchBalance, 5000);
    return () => clearInterval(interval);
  }, [address, publicClient]);

  const topUpGasIfNeeded = useCallback(async (): Promise<GasTopUpResult> => {
    // If balance is sufficient, no faucet needed
    if (balance && balance >= LOW_GAS_THRESHOLD) {
      console.log(`[Gas Faucet] Sufficient balance: ${balance.toLocaleString()} wei`);
      return { ok: true, error: null };
    }

    // If we don't have the required dependencies, can't use faucet
    if (!address || !publicClient || !signer) {
      const msg = "Cannot top up gas: wallet not fully connected";
      setError(msg);
      console.warn("[Gas Faucet] Missing dependencies for faucet trigger", {
        hasAddress: !!address,
        hasPublicClient: !!publicClient,
        hasSigner: !!signer,
      });
      return { ok: false, error: msg };
    }

    if (!FAUCET_ADDRESS) {
      const msg = "Gas faucet is not configured for this network.";
      console.error("[Gas Faucet] No faucetContract resolved from chainConfigs", {
        chainId: TARGET_CHAIN.id,
        env: FAUCET_ENV,
      });
      setError(msg);
      return { ok: false, error: msg };
    }

    setIsTopingUpGas(true);
    setError(null);

    try {
      console.log(`[Gas Faucet] Starting faucet trigger for ${address}`);

      // Trigger the faucet with required parameters
      const result = await triggerFaucet({
        chainId: TARGET_CHAIN.id,
        account: address,
        faucetAddress: FAUCET_ADDRESS,
        publicClient: publicClient as any,
        walletClient: signer as any,
        env: FAUCET_ENV,
      });

      console.log(`[Gas Faucet] Faucet result: ${result}`, {
        chainId: TARGET_CHAIN.id,
        account: address,
        timestamp: new Date().toISOString(),
      });

      switch (result) {
        case "skipped":
          // Faucet was skipped - likely already topped up or hit rate limit
          console.log("[Gas Faucet] Faucet was skipped (already topped or rate limited)");
          setError(null);
          return { ok: true, error: null };

        case "topped_via_contract":
          // Successfully topped up via contract
          console.log("[Gas Faucet] Gas topped via contract successfully");
          setError(null);
          return { ok: true, error: null };

        case "topped_via_api":
          // Successfully topped up via API
          console.log("[Gas Faucet] Gas topped via API successfully");
          setError(null);
          return { ok: true, error: null };

        case "error": {
          // Faucet encountered an error - log detailed diagnostic info
          const errorMsg =
            "Could not top up gas from faucet. Please ensure you have sufficient CELO for gas, or try again later.";
          console.error("[Gas Faucet] Faucet trigger failed with error result", {
            result,
            account: address,
            chainId: TARGET_CHAIN.id,
            balanceWei: balance?.toLocaleString() ?? "unknown",
            timestamp: new Date().toISOString(),
          });
          setError(errorMsg);
          return { ok: false, error: errorMsg };
        }

        default: {
          const unknownMsg = `Unexpected faucet response: ${result}`;
          console.error("[Gas Faucet] Unexpected faucet response", {
            result,
            account: address,
            chainId: TARGET_CHAIN.id,
            balanceWei: balance?.toLocaleString() ?? "unknown",
            expectedResponses: ["skipped", "topped_via_contract", "topped_via_api", "error"],
          });
          setError(unknownMsg);
          return { ok: false, error: unknownMsg };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as any)?.code;
      const name = (err as any)?.name;

      console.error("[Gas Faucet] Exception during faucet trigger", {
        errorMessage: message,
        errorCode: code,
        errorName: name,
        account: address,
        chainId: TARGET_CHAIN.id,
        balanceWei: balance?.toLocaleString() ?? "unknown",
        fullError: err,
        timestamp: new Date().toISOString(),
      });

      // Provide user-friendly error messages based on error details
      let userMsg = "Gas faucet error. ";
      if (message.includes("network") || message.includes("rpc") || message.includes("fetch")) {
        userMsg +=
          "Network error — check your connection and try again.";
      } else if (message.includes("rate") || message.includes("429")) {
        userMsg += "Faucet rate limit reached. Please try again later.";
      } else if (message.includes("whitelisted") || message.includes("verified") || message.includes("401") || message.includes("403")) {
        userMsg +=
          "Only verified GoodDollar accounts can use the gas faucet. Verify your identity first.";
      } else if (message.includes("insufficient") || message.includes("balance")) {
        userMsg += "Faucet temporarily out of funds. Please try again later.";
      } else {
        userMsg += "Please try again or ensure you have sufficient CELO for gas.";
      }

      setError(userMsg);
      return { ok: false, error: userMsg };
    } finally {
      setIsTopingUpGas(false);
    }
  }, [address, publicClient, signer, balance]);

  return {
    isTopingUpGas,
    topUpGasIfNeeded,
    error,
  };
}
