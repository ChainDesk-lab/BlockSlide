import { useCallback, useState } from "react";
import { useContractAddress, useContractPublicClient, useContractWalletClient } from "./useContractData";
import { triggerFaucet } from "@goodsdks/citizen-sdk";
import { TARGET_CHAIN, GOODDOLLAR_FAUCET_ADDRESS } from "../lib/constants";

export interface GasTopUpResult {
  ok: boolean;
  /** Error message if check failed */
  error: string | null;
}

interface UseGasFaucetResult {
  /**
   * Make sure the wallet can pay for gas. `onProgress` receives a player-facing
   * status line, only once a faucet top-up is actually under way.
   */
  topUpGasIfNeeded: (onProgress?: (message: string) => void) => Promise<GasTopUpResult>;
  error: string | null;
}

/** Player-facing status while the faucet top-up is in flight. */
export const GAS_TOP_UP_PROGRESS = "Getting you some gas, this takes a few seconds...";

/** Player-facing error when the faucet couldn't cover them and the modal opens. */
export const GAS_MANUAL_NEEDED = "You need a little CELO for gas. Follow the steps to top up, then try again.";

// A faucet top-up via GoodDollar's API returns as soon as the request is
// accepted, before the CELO lands. Checking once after 2s reported failure for
// wallets that were funded moments later — the "stuck at top up gas" reports
// from August. Poll instead, and only give up after POLL_TIMEOUT_MS.
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

/**
 * Whether `address` holds enough CELO for gas, via the server-side balance
 * check (/api/gas-faucet). Returns null when the check itself failed.
 */
export async function fetchHasEnoughGas(address: string): Promise<boolean | null> {
  try {
    const response = await fetch(`/api/gas-faucet?address=${address}`);
    if (!response.ok) return null;
    const data = (await response.json()) as { balanceSufficient: boolean };
    return data.balanceSufficient;
  } catch {
    return null;
  }
}

async function waitForGas(address: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (await fetchHasEnoughGas(address)) return true;
  }
  return false;
}

/**
 * Gas sponsorship, in two steps:
 *
 * 1. GoodDollar faucet: triggerFaucet() from @goodsdks/citizen-sdk, then poll
 *    the balance for up to 30s. The wallet is only marked as having used the
 *    faucet (Redis, /api/gas/tier1) once the CELO has actually arrived, so a
 *    slow or failed top-up doesn't burn the wallet's turn.
 * 2. Manual fallback: on any `ok: false` the caller opens GasNeededModal,
 *    which sends the player to Telegram for a top-up.
 */
export function useGasFaucet(): UseGasFaucetResult {
  const address = useContractAddress();
  const publicClient = useContractPublicClient();
  const walletClient = useContractWalletClient();
  const [error, setError] = useState<string | null>(null);

  const topUpGasIfNeeded = useCallback(async (onProgress?: (message: string) => void): Promise<GasTopUpResult> => {
    if (!address) {
      const msg = "No wallet address found";
      setError(msg);
      return { ok: false, error: msg };
    }

    try {
      console.log(`[Gas] Checking balance for ${address.slice(0, 6)}...`);

      const hasEnough = await fetchHasEnoughGas(address);
      if (hasEnough === null) {
        const msg = "Could not verify wallet balance. Please check your connection and try again.";
        console.error("[Gas] Balance check failed");
        setError(msg);
        return { ok: false, error: msg };
      }
      if (hasEnough) {
        setError(null);
        return { ok: true, error: null };
      }

      console.log(`[Gas] Insufficient balance for ${address.slice(0, 6)}..., trying GoodDollar faucet`);

      let canUseFaucet = true;
      try {
        const checkResponse = await fetch(`/api/gas/tier1?address=${address}`);
        if (checkResponse.ok) {
          const checkData = (await checkResponse.json()) as { canUseFaucet: boolean };
          canUseFaucet = checkData.canUseFaucet;
          if (!canUseFaucet) console.log("[Gas] Wallet already used the faucet, skipping to manual top-up");
        }
      } catch {
        console.warn("[Gas] Could not check faucet status, will attempt anyway");
      }

      if (canUseFaucet && publicClient && walletClient) {
        onProgress?.(GAS_TOP_UP_PROGRESS);
        try {
          const result = await triggerFaucet({
            chainId: TARGET_CHAIN.id,
            account: address,
            publicClient,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            walletClient: walletClient as any,
            faucetAddress: GOODDOLLAR_FAUCET_ADDRESS,
            env: "production",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);

          if (result === "topped_via_contract" || result === "topped_via_api") {
            console.log(`[Gas] Faucet accepted (${result}), waiting for CELO to land...`);
            if (await waitForGas(address)) {
              console.log("[Gas] Faucet top-up confirmed");
              try {
                await fetch(`/api/gas/tier1`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ address }),
                });
              } catch (markErr) {
                console.warn("[Gas] Could not mark faucet as used server-side:", markErr);
              }
              setError(null);
              return { ok: true, error: null };
            }
            console.warn(`[Gas] Faucet accepted but no CELO after ${POLL_TIMEOUT_MS / 1000}s`);
          } else {
            // "skipped": GoodDollar won't top this wallet (canTop false) or the
            // SDK's own 1h client-side throttle. "error": contract and API both failed.
            console.warn(`[Gas] Faucet did not top up: ${result}`);
          }
        } catch (faucetErr) {
          console.warn("[Gas] Faucet error", faucetErr);
        }
      } else if (canUseFaucet) {
        console.log("[Gas] Wallet/public client not ready, skipping faucet");
      }

      console.log("[Gas] Falling back to manual top-up modal");
      setError(GAS_MANUAL_NEEDED);
      return { ok: false, error: GAS_MANUAL_NEEDED };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Gas] Exception:", { errorMessage: message, address: address?.slice(0, 6) });
      setError(GAS_MANUAL_NEEDED);
      return { ok: false, error: GAS_MANUAL_NEEDED };
    }
  }, [address, publicClient, walletClient]);

  return {
    topUpGasIfNeeded,
    error,
  };
}
