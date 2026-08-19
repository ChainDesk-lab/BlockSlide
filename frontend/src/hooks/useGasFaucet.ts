import { useCallback, useState, useEffect } from "react";
import { useContractAddress } from "./useContractData";

const LOW_GAS_THRESHOLD = 1_000_000_000_000_000n; // 0.001 CELO (sufficient for Celo gas costs)

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

  const [isTopingUpGas, setIsTopingUpGas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  // Fetch balance via server-side proxy to avoid CORS restrictions
  useEffect(() => {
    if (!address) {
      setBalance(null);
      return;
    }

    const fetchBalance = async () => {
      try {
        const response = await fetch(`/api/gas-faucet?address=${address}`);
        if (!response.ok) {
          console.error("[Gas Faucet] Balance check failed:", response.status);
          setBalance(null);
          return;
        }
        const data = (await response.json()) as { balance: string };
        const balanceBigInt = BigInt(data.balance);
        setBalance(balanceBigInt);
        console.log(`[Gas Faucet] Balance fetched: ${balanceBigInt.toLocaleString()} wei`);
      } catch (err) {
        console.error("[Gas Faucet] Failed to fetch balance:", err);
        setBalance(null);
      }
    };

    fetchBalance();
    // Refetch balance every 5 seconds to detect when faucet has topped up
    const interval = setInterval(fetchBalance, 5000);
    return () => clearInterval(interval);
  }, [address]);

  const topUpGasIfNeeded = useCallback(async (): Promise<GasTopUpResult> => {
    // If balance is sufficient, no faucet needed
    if (balance && balance >= LOW_GAS_THRESHOLD) {
      console.log(`[Gas Faucet] Sufficient balance: ${balance.toLocaleString()} wei`);
      return { ok: true, error: null };
    }

    // If we don't have the address, can't proceed
    if (!address) {
      const msg = "Cannot top up gas: wallet not connected";
      setError(msg);
      return { ok: false, error: msg };
    }

    setIsTopingUpGas(true);
    setError(null);

    try {
      console.log(`[Gas Faucet] Starting gas faucet via server proxy for ${address}`);

      // Call server-side gas faucet proxy (bypasses CORS, handles everything server-side)
      const response = await fetch("/api/gas-faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        const msg = "Gas faucet service temporarily unavailable. Please try again later.";
        console.error("[Gas Faucet] Server returned error:", response.status);
        setError(msg);
        return { ok: false, error: msg };
      }

      const result = (await response.json()) as {
        balance: string;
        balanceSufficient: boolean;
        faucetTriggered: boolean;
        faucetResult?: string;
        error?: string;
      };

      console.log(`[Gas Faucet] Server response:`, {
        balance: result.balance,
        balanceSufficient: result.balanceSufficient,
        faucetTriggered: result.faucetTriggered,
        faucetResult: result.faucetResult,
        address: address.slice(0, 6),
      });

      // If server reported an error
      if (result.error) {
        setError(result.error);
        return { ok: false, error: result.error };
      }

      // If faucet was triggered and succeeded, or balance was already sufficient
      if (result.balanceSufficient || result.faucetTriggered) {
        setError(null);
        return { ok: true, error: null };
      }

      // Faucet was skipped or not triggered — balance still too low
      const msg = "Could not top up gas. Please ensure your account is verified, or try again later.";
      setError(msg);
      return { ok: false, error: msg };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      console.error("[Gas Faucet] Exception during faucet trigger:", {
        errorMessage: message,
        address: address?.slice(0, 6),
        fullError: err,
      });

      // Provide user-friendly error message
      let userMsg = "Gas faucet error. ";
      if (message.includes("network") || message.includes("fetch")) {
        userMsg += "Network error — check your connection and try again.";
      } else if (message.includes("timeout")) {
        userMsg += "Request timed out. Please try again.";
      } else {
        userMsg += "Please try again or ensure you have sufficient CELO for gas.";
      }

      setError(userMsg);
      return { ok: false, error: userMsg };
    } finally {
      setIsTopingUpGas(false);
    }
  }, [address, balance]);

  return {
    isTopingUpGas,
    topUpGasIfNeeded,
    error,
  };
}
