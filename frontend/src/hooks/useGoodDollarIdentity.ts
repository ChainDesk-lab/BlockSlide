import { useCallback, useEffect, useState } from "react";
import { useWalletClient } from "wagmi";
import { IdentitySDK } from "@goodsdks/citizen-sdk";
import { TARGET_CHAIN } from "../lib/constants";
import { useAuth } from "../auth/AuthContext";
import { useContractPublicClient } from "./useContractData";

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
  const { authType, address: magicAddress } = useAuth();
  const { data: wagmiWalletClient } = useWalletClient();
  const contractPublicClient = useContractPublicClient();

  const [isVerified, setIsVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get the address to verify - Magic or wagmi
  const addressToVerify = authType === "magic" ? magicAddress : wagmiWalletClient?.account?.address;

  // Check on-chain verification status
  const checkVerificationStatus = useCallback(async () => {
    if (!addressToVerify || !contractPublicClient) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Initialize SDK for on-chain status check
      // For Magic.link, we use a simplified SDK config since we only need to read
      const sdk = new IdentitySDK({
        publicClient: contractPublicClient as any,
        walletClient: authType === "magic" ? undefined : (wagmiWalletClient as any),
        env: "production",
      });

      // getWhitelistedRoot returns { isWhitelisted, root } — NOT a boolean.
      // The old `!!whitelistStatus` was truthy for the object EVERY time, so
      // every wallet looked verified (hence the claim block showing for
      // unverified wallets). `.isWhitelisted` also correctly recognises a wallet
      // LINKED to a verified root — GoodDollar allows one identity across
      // multiple wallets, so a connected account reads as whitelisted too.
      const { isWhitelisted } = await sdk.getWhitelistedRoot(addressToVerify);

      setIsVerified(isWhitelisted);
    } catch (err) {
      console.error("Error checking GoodDollar verification status:", err);
      // Don't show error for status check failures - just mark as unverified
      setIsVerified(false);
    } finally {
      setIsLoading(false);
    }
  }, [addressToVerify, contractPublicClient, wagmiWalletClient, authType]);

  // Initial verification status check
  useEffect(() => {
    checkVerificationStatus();
  }, [checkVerificationStatus]);

  const startVerification = useCallback(async () => {
    if (!addressToVerify || !contractPublicClient) {
      setError("Wallet not connected");
      return;
    }

    setError(null);
    setIsVerifying(true);

    let popup: Window | null = null;
    let pollInterval: ReturnType<typeof setTimeout> | undefined;

    try {
      // Initialize SDK with wallet and public clients
      const sdk = new IdentitySDK({
        publicClient: contractPublicClient as any,
        walletClient: authType === "magic" ? undefined : (wagmiWalletClient as any),
        env: "production",
      });

      // Generate face verification link with wallet signature attached
      const verificationLink = await sdk.generateFVLink(
        false,
        window.location.href,
        TARGET_CHAIN.id
      );

      if (!verificationLink) {
        throw new Error("Failed to generate verification link");
      }

      console.log("Opening face verification popup...");

      // Open popup immediately on user-click stack frame to avoid popup blockers
      const width = 500;
      const height = 700;
      const left = window.innerWidth / 2 - width / 2;
      const top = window.innerHeight / 2 - height / 2;

      popup = window.open(
        verificationLink,
        "FaceVerification",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        // Popup was blocked - provide direct link
        setError(
          `Please enable popups for this site, or click the link below to verify. We'll check your verification status when you return.`
        );

        // Create a clickable link as fallback
        const link = document.createElement("a");
        link.href = verificationLink;
        link.target = "_blank";
        link.textContent = "Open Face Verification";
        link.style.display = "block";
        link.style.marginTop = "10px";
        link.style.color = "#845ef7";

        setIsVerifying(false);
        return;
      }

      // Focus the popup window
      if (popup) {
        popup.focus();
      }

      // Poll for popup closure with longer interval and timeout
      let pollCount = 0;
      const maxPolls = 300; // 5 minutes max (300 * 1000ms)

      pollInterval = setInterval(async () => {
        pollCount++;

        // Check if popup is closed
        if (popup?.closed || pollCount > maxPolls) {
          clearInterval(pollInterval);

          // User closed the popup - recheck their verification status on-chain
          console.log("Popup closed, checking verification status...");
          setTimeout(() => {
            checkVerificationStatus();
          }, 2000); // Wait 2s for on-chain confirmation

          setIsVerifying(false);
          return;
        }
      }, 1000); // Check every 1 second

    } catch (err) {
      if (pollInterval) clearInterval(pollInterval);
      if (popup && !popup.closed) popup.close();

      const message = err instanceof Error ? err.message : String(err);
      console.error("Face verification error:", message);

      // Check if this was a wallet signature rejection
      if (
        message.toLowerCase().includes("reject") ||
        message.toLowerCase().includes("denied") ||
        message.toLowerCase().includes("cancel")
      ) {
        setError(null); // Don't show error for user cancellation
      } else {
        setError("Could not start face verification. Please try again.");
      }

      setIsVerifying(false);
    }
  }, [addressToVerify, contractPublicClient, wagmiWalletClient, authType, checkVerificationStatus]);

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
