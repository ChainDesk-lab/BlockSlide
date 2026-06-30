import { useCallback, useEffect, useState } from "react";
import { zeroAddress } from "viem";
import { IDENTITY_ABI } from "../lib/abi";
import { IDENTITY_ADDRESS } from "../lib/constants";
import { useContractAddress, useContractPublicClient } from "./useContractData";

export type IdentityStatus =
  | "no-wallet"   // wallet not connected
  | "loading"     // reading the on-chain status
  | "unverified"  // confirmed not whitelisted, no verification started
  | "pending"     // user started face verification, not yet confirmed on-chain
  | "verified";   // whitelisted on the GoodDollar identity contract

const VERIFIED_KEY = (a: string) => `blockslide_verified_${a.toLowerCase()}`;
const PENDING_KEY  = (a: string) => `blockslide_fv_pending_${a.toLowerCase()}`;
// How long a "pending" verification stays pending before reverting to
// unverified (so a user who never finishes the scan can retry cleanly).
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Verification status for the connected wallet.
 *
 * Primary source of truth: the GoodDollar identity contract's getWhitelistedRoot
 * on Celo mainnet — a non-zero root means verified. We use this (not
 * isWhitelisted) so the gate/badge agrees with the claim block (useGoodDollar
 * identity) AND recognises wallets LINKED to a verified root, so a connected
 * account no longer shows "needs verification" while it can claim. localStorage
 * (keyed by wallet address) is a fallback so the badge survives a transient RPC
 * failure, and to remember an in-progress face verification ("pending").
 */
export function useIdentity() {
  const address = useContractAddress();
  const publicClient = useContractPublicClient();

  const [data, setData] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  // Read identity status whenever address changes
  useEffect(() => {
    if (!address || !publicClient) {
      setData(undefined);
      return;
    }

    const readIdentity = async () => {
      setIsLoading(true);
      try {
        const result = await publicClient.readContract({
          address: IDENTITY_ADDRESS,
          abi: IDENTITY_ABI,
          functionName: "getWhitelistedRoot",
          args: [address],
        });
        setData(result as string);
      } catch (err) {
        console.error("Error reading identity:", err);
        setData(undefined);
      } finally {
        setIsLoading(false);
      }
    };

    readIdentity();
  }, [address, publicClient]);

  const refetch = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      const result = await publicClient.readContract({
        address: IDENTITY_ADDRESS,
        abi: IDENTITY_ABI,
        functionName: "getWhitelistedRoot",
        args: [address],
      });
      setData(result as string);
    } catch (err) {
      console.error("Error refetching identity:", err);
    }
  }, [address, publicClient]);

  const onChainVerified = !!data && data !== zeroAddress;

  // localStorage-backed fallback state, re-synced whenever the wallet changes.
  const [cachedVerified, setCachedVerified] = useState(false);
  const [pendingActive, setPendingActive] = useState(false);

  useEffect(() => {
    if (!address) {
      setCachedVerified(false);
      setPendingActive(false);
      return;
    }
    setCachedVerified(localStorage.getItem(VERIFIED_KEY(address)) === "true");
    const ts = Number(localStorage.getItem(PENDING_KEY(address)) || 0);
    setPendingActive(ts > 0 && Date.now() - ts < PENDING_TTL_MS);
  }, [address]);

  // When the contract confirms verification, persist it and clear any pending.
  useEffect(() => {
    if (!address || !onChainVerified) return;
    localStorage.setItem(VERIFIED_KEY(address), "true");
    localStorage.removeItem(PENDING_KEY(address));
    setCachedVerified(true);
    setPendingActive(false);
  }, [address, onChainVerified]);

  // Called when the user kicks off the GoodDollar face-verification flow.
  const markPending = useCallback(() => {
    if (!address) return;
    localStorage.setItem(PENDING_KEY(address), String(Date.now()));
    setPendingActive(true);
  }, [address]);

  const isVerified = onChainVerified || cachedVerified;

  let status: IdentityStatus;
  if (!address)            status = "no-wallet";
  else if (isVerified)     status = "verified";
  else if (isLoading)      status = "loading";
  else if (pendingActive)  status = "pending";
  else                     status = "unverified";

  return { status, isVerified, refetch, markPending };
}
