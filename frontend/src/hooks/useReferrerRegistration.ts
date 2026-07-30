import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { isAddress } from "viem";
import { useSigner } from "./useSigner";
import { GAME2048_ADDRESS } from "../lib/constants";
import { getPendingReferrer, clearPendingReferrer } from "./useRefCapture";

/**
 * After user connects wallet, if there's a pending referrer from ?ref= param,
 * automatically register it once (set-once, non-critical).
 * Silent on error — referrer registration is optional incentive, not critical flow.
 */
export function useReferrerRegistration() {
  const { address, isConnected } = useAccount();
  const { signer } = useSigner();
  const attemptedRef = useRef(false);

  useEffect(() => {
    // Only attempt registration once per session
    if (attemptedRef.current) return;
    if (!address || !isConnected || !signer) return;

    const pendingReferrer = getPendingReferrer();
    if (!pendingReferrer || !isAddress(pendingReferrer)) {
      attemptedRef.current = true;
      return;
    }

    // Prevent self-referral
    if (pendingReferrer.toLowerCase() === address.toLowerCase()) {
      clearPendingReferrer();
      attemptedRef.current = true;
      return;
    }

    attemptedRef.current = true;

    // Attempt to register the referrer (non-blocking)
    // Encode: keccak256(abi.encodeWithSignature("registerReferrer(address)", referrer))
    (async () => {
      try {
        // registerReferrer(address) selector = first 4 bytes of keccak256("registerReferrer(address)")
        const selector = "0xe8a98a7a"; // keccak256("registerReferrer(address)") first 4 bytes
        const encodedData = selector + pendingReferrer.slice(2).padStart(64, "0");

        // Silently attempt via JSON-RPC (no gas estimation, simple broadcast)
        // If it fails, the user can still play; referrer is optional
        await (signer as any).request({
          method: "eth_sendTransaction",
          params: [{
            from: address,
            to: GAME2048_ADDRESS,
            data: encodedData,
            gas: "0x30D40", // ~200k gas
          }],
        });

        // On success, clear the stored referrer
        clearPendingReferrer();
        console.log("[Referrer] Registered:", pendingReferrer);
      } catch (err) {
        // Silent on error — not critical. User still plays normally.
        // Common causes: already set (contract guard), invalid referrer, etc.
        console.log("[Referrer] Registration skipped:", err instanceof Error ? err.message : err);
      }
    })();
  }, [address, isConnected, signer]);
}
