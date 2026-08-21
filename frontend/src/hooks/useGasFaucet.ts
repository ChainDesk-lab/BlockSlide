import { useCallback, useState } from "react";
import { useContractAddress } from "./useContractData";

export interface GasTopUpResult {
  ok: boolean;
  /** Error message if check failed */
  error: string | null;
}

interface UseGasFaucetResult {
  topUpGasIfNeeded: () => Promise<GasTopUpResult>;
  error: string | null;
}

/**
 * Gas balance checker for transactions
 *
 * NOTE: The gas faucet (triggerFaucet from @goodsdks/citizen-sdk) has been disabled
 * due to reliability issues causing false-negative errors even when wallets had sufficient
 * balance. This hook now only checks whether a wallet has enough CELO for gas.
 *
 * If balance is insufficient, the user is directed to manually fund their wallet.
 * If balance is sufficient, the transaction proceeds directly without any faucet dependency.
 */
export function useGasFaucet(): UseGasFaucetResult {
  const address = useContractAddress();
  const [error, setError] = useState<string | null>(null);

  const topUpGasIfNeeded = useCallback(async (): Promise<GasTopUpResult> => {
    // If we don't have the address, can't proceed
    if (!address) {
      const msg = "Wallet not connected";
      setError(msg);
      return { ok: false, error: msg };
    }

    try {
      console.log(`[Gas Check] Checking CELO balance for ${address.slice(0, 6)}...`);

      // Fetch current balance via GET endpoint (balance check only, no faucet trigger)
      const response = await fetch(`/api/gas-faucet?address=${address}`);

      if (!response.ok) {
        const msg = "Could not verify wallet balance. Please check your connection and try again.";
        console.error("[Gas Check] Balance fetch failed:", response.status);
        setError(msg);
        return { ok: false, error: msg };
      }

      const result = (await response.json()) as {
        balance: string;
        balanceSufficient: boolean;
      };

      const balanceBigInt = BigInt(result.balance);
      console.log(`[Gas Check] Balance for ${address.slice(0, 6)}...: ${balanceBigInt.toLocaleString()} wei (sufficient: ${result.balanceSufficient})`);

      // If balance is sufficient, proceed
      if (result.balanceSufficient) {
        setError(null);
        return { ok: true, error: null };
      }

      // Balance is insufficient — user needs to manually top up
      const celoInDecimal = Number(balanceBigInt) / 1e18;
      const msg = `Insufficient CELO for gas (${celoInDecimal.toFixed(3)} CELO). You need at least 0.001 CELO to submit transactions. Please top up your wallet.`;
      console.warn(`[Gas Check] Balance too low for ${address.slice(0, 6)}...`);
      setError(msg);
      return { ok: false, error: msg };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Gas Check] Exception during balance check:", { errorMessage: message, address: address?.slice(0, 6) });

      const userMsg = "Balance check failed. Please ensure you have sufficient CELO for gas and try again.";
      setError(userMsg);
      return { ok: false, error: userMsg };
    }
  }, [address]);

  return {
    topUpGasIfNeeded,
    error,
  };
}
