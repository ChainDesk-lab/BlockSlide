import { useCallback, useState } from "react";
import { useContractAddress, useContractPublicClient, useContractWalletClient } from "./useContractData";
import { triggerFaucet } from "@goodsdks/citizen-sdk";
import { TARGET_CHAIN, GOODDOLLAR_FAUCET_ADDRESS } from "../lib/constants";
import { runGasTopUp, type GasTopUpResult } from "../lib/gasTopUp";

export type { GasTopUpResult } from "../lib/gasTopUp";
export { GAS_TOP_UP_PROGRESS, GAS_MANUAL_NEEDED, fetchGasStatus } from "../lib/gasTopUp";

interface UseGasFaucetResult {
  /**
   * Make sure the wallet can pay for the next transaction.
   *
   * `requiredWei` is that transaction's requirement (gas limit × fee cap, from
   * lib/gasPlan.ts); without it /api/gas-faucet uses its default budget at
   * live fees. `onProgress` receives a player-facing status line, only once a
   * faucet top-up is actually under way.
   */
  topUpGasIfNeeded: (requiredWei?: bigint, onProgress?: (message: string) => void) => Promise<GasTopUpResult>;
  error: string | null;
}

/**
 * Gas sponsorship: the GoodDollar faucet first, then the manual (Telegram)
 * fallback. The flow itself lives in lib/gasTopUp.ts; this hook supplies the
 * wallet clients, the faucet SDK and the /api/gas/tier1 bookkeeping.
 */
export function useGasFaucet(): UseGasFaucetResult {
  const address = useContractAddress();
  const publicClient = useContractPublicClient();
  const walletClient = useContractWalletClient();
  const [error, setError] = useState<string | null>(null);

  const topUpGasIfNeeded = useCallback(
    async (requiredWei?: bigint, onProgress?: (message: string) => void): Promise<GasTopUpResult> => {
      if (!address) {
        const msg = "No wallet address found";
        setError(msg);
        return { ok: false, error: msg };
      }

      const result = await runGasTopUp({
        address,
        requiredWei,
        onProgress,
        deps: {
          triggerFaucet:
            publicClient && walletClient
              ? () =>
                  triggerFaucet({
                    chainId: TARGET_CHAIN.id,
                    account: address,
                    publicClient,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    walletClient: walletClient as any,
                    faucetAddress: GOODDOLLAR_FAUCET_ADDRESS,
                    env: "production",
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  } as any) as Promise<string>
              : null,
          canUseFaucet: async () => {
            const res = await fetch(`/api/gas/tier1?address=${address}`);
            if (!res.ok) return true; // fail open; GoodDollar enforces its own limits
            return ((await res.json()) as { canUseFaucet: boolean }).canUseFaucet;
          },
          markFaucetUsed: async () => {
            await fetch(`/api/gas/tier1`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address }),
            });
          },
        },
      });

      setError(result.ok ? null : result.error);
      return result;
    },
    [address, publicClient, walletClient],
  );

  return {
    topUpGasIfNeeded,
    error,
  };
}
