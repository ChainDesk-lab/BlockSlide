import { useCallback, useEffect, useState } from "react";
import { getWalletClient } from "wagmi/actions";
import { IdentitySDK } from "@goodsdks/citizen-sdk";
import { createWalletClient, custom } from "viem";
import { TARGET_CHAIN } from "../lib/constants";
import { useAuth } from "../auth/AuthContext";
import { wagmiConfig } from "../auth/wagmiConfig";
import { useContractAddress, useContractPublicClient, useContractWalletClient } from "./useContractData";
import { getMagic } from "../magic";

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
  const { authType } = useAuth();
  const walletClient = useContractWalletClient();
  const contractPublicClient = useContractPublicClient();

  // Helper to create wallet client on-demand (not memoized to avoid dependency issues)
  // Note: only called after addressToVerify has been verified as non-undefined
  const createWalletClientForAuth = async (addr?: `0x${string}`) => {
    if (authType === "magic") {
      try {
        const magic = getMagic();
        // Create viem wallet client from Magic's EIP-1193 provider
        // Include the account so the SDK knows which address to sign with
        return createWalletClient({
          chain: TARGET_CHAIN,
          transport: custom(magic.rpcProvider as any),
          account: addr,
        });
      } catch (err) {
        console.error("Failed to create Magic wallet client:", err);
        return undefined;
      }
    }
    // useContractWalletClient() can still be resolving right after a fresh
    // connect — fetch it imperatively once before giving up, instead of
    // treating "not resolved yet" as "not connected".
    if (walletClient) return walletClient;
    try {
      return await getWalletClient(wagmiConfig, { chainId: TARGET_CHAIN.id });
    } catch (err) {
      console.error("Failed to fetch wallet client:", err);
      return undefined;
    }
  };

  const [isVerified, setIsVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Address to verify — the same reliably-connected address the rest of the
  // app (header balance, username, game session) uses. Deliberately NOT
  // derived from the wallet *signing* client: checking verification status is
  // a read-only lookup and never needed a signer, so gating it on one caused
  // the "wallet not connected" false negative even while clearly connected.
  const addressToVerify = useContractAddress();

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
      const walletClient = await createWalletClientForAuth(addressToVerify);
      const sdk = new IdentitySDK({
        publicClient: contractPublicClient as any,
        walletClient: walletClient as any,
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
  }, [addressToVerify, contractPublicClient, authType]);

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
      const walletClient = await createWalletClientForAuth(addressToVerify);
      const sdk = new IdentitySDK({
        publicClient: contractPublicClient as any,
        walletClient: walletClient as any,
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
  }, [addressToVerify, contractPublicClient, authType, checkVerificationStatus]);

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
