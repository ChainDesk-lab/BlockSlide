import { useCallback, useEffect, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { IdentitySDK } from "@goodsdks/citizen-sdk";
import { TARGET_CHAIN } from "../lib/constants";

interface UseGoodDollarIdentityResult {
  isVerified: boolean;
  isLoading: boolean;
  isVerifying: boolean;
  error: string | null;
  startVerification: () => Promise<void>;
  recheckVerification: () => Promise<void>;
}

/**
 * Unified GoodDollar identity verification hook
 * Used by both IdentityGate and ClaimUBI for consistent SDK integration
 *
 * Handles:
 * - On-chain verification status check against identity registry
 * - SDK initialization with wallet and public clients
 * - Face verification link generation with wallet signature
 * - Verification popup management
 * - Post-verification status recheck
 */
export function useGoodDollarIdentity(): UseGoodDollarIdentityResult {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [isVerified, setIsVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check on-chain verification status
  const checkVerificationStatus = useCallback(async () => {
    if (!publicClient || !walletClient?.account) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Initialize SDK for on-chain status check
      const sdk = new IdentitySDK({
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        env: "production",
      });

      // Check if wallet is whitelisted on the identity registry
      // This reads from the on-chain identity contract
      const whitelistStatus = await sdk.getWhitelistedRoot(walletClient.account.address);

      setIsVerified(!!whitelistStatus);
    } catch (err) {
      console.error("Error checking GoodDollar verification status:", err);
      // Don't show error for status check failures - just mark as unverified
      setIsVerified(false);
    } finally {
      setIsLoading(false);
    }
  }, [publicClient, walletClient]);

  // Initial verification status check
  useEffect(() => {
    checkVerificationStatus();
  }, [checkVerificationStatus]);

  const startVerification = useCallback(async () => {
    if (!publicClient || !walletClient?.account) {
      setError("Wallet not connected");
      return;
    }

    setError(null);
    setIsVerifying(true);

    // Open popup immediately on user-click stack frame to avoid popup blockers
    const width = 500;
    const height = 700;
    const left = window.innerWidth / 2 - width / 2;
    const top = window.innerHeight / 2 - height / 2;

    const popup = window.open("about:blank", "_blank",
      `width=${width},height=${height},left=${left},top=${top}`);

    try {
      // Initialize SDK with wallet and public clients
      const sdk = new IdentitySDK({
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        env: "production",
      });

      // Generate face verification link with wallet signature attached
      // This ensures the verification is tied to this specific wallet
      const verificationLink = await sdk.generateFVLink(
        false,
        window.location.href,
        TARGET_CHAIN.id
      );

      if (popup) {
        popup.location.href = verificationLink;
      } else {
        // Popup was blocked
        setError(
          `Popup blocked. Please allow popups and try again, or visit: ${verificationLink}`
        );
        setIsVerifying(false);
        return;
      }

      // Poll for popup closure and recheck verification status
      const pollInterval = setInterval(async () => {
        if (popup?.closed) {
          clearInterval(pollInterval);

          // User closed the popup - recheck their verification status on-chain
          // They may have completed the verification
          setTimeout(() => {
            checkVerificationStatus();
          }, 1500); // Wait 1.5s for on-chain confirmation

          setIsVerifying(false);
        }
      }, 500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Check if this was a wallet signature rejection
      if (
        message.toLowerCase().includes("reject") ||
        message.toLowerCase().includes("denied") ||
        message.toLowerCase().includes("cancel")
      ) {
        popup?.close();
        setError(null); // Don't show error for user cancellation
      } else {
        setError("Could not generate verification link. Please try again.");
        if (popup && !popup.closed) popup.close();
      }

      setIsVerifying(false);
    }
  }, [publicClient, walletClient, checkVerificationStatus]);

  const recheckVerification = useCallback(async () => {
    await checkVerificationStatus();
  }, [checkVerificationStatus]);

  return {
    isVerified,
    isLoading,
    isVerifying,
    error,
    startVerification,
    recheckVerification,
  };
}
