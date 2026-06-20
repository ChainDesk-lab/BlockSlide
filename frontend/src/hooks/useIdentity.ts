import { useCallback, useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { IDENTITY_ABI } from "../lib/abi";
import { IDENTITY_ADDRESS } from "../lib/constants";

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
 * Primary source of truth: the GoodDollar identity contract's isWhitelisted on
 * Celo mainnet. localStorage (keyed by wallet address) is used as a fallback so
 * the verified badge survives a transient RPC failure, and to remember that the
 * user has a face-verification in progress ("pending").
 */
export function useIdentity() {
  const { address } = useAccount();

  const { data, isLoading, refetch } = useReadContract({
    address: IDENTITY_ADDRESS,
    abi: IDENTITY_ABI,
    functionName: "isWhitelisted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const onChainVerified = data === true;

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
