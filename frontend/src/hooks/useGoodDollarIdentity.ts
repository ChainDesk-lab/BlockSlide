import { useCallback, useEffect, useState } from "react";
import { useChainId, useSwitchChain } from "wagmi";
import { IdentitySDK } from "@goodsdks/citizen-sdk";
import { TARGET_CHAIN } from "../lib/constants";
import { useAuth } from "../auth/AuthContext";
import { useContractAddress, useContractPublicClient } from "./useContractData";
import { useSigner } from "./useSigner";

interface UseGoodDollarIdentityResult {
  isVerified: boolean;
  isLoading: boolean;
  isVerifying: boolean;
  error: string | null;
  isWrongChain: boolean;
  chainSwitchPending: boolean;
  startVerification: () => Promise<void>;
  switchToTargetChain: () => void;
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
 * - Full-page redirect to GoodDollar's face scan and back (no popup window,
 *   so there's nothing for a browser popup blocker to catch)
 * - Post-verification status recheck on return
 */
export function useGoodDollarIdentity(): UseGoodDollarIdentityResult {
  const { authType } = useAuth();
  const contractPublicClient = useContractPublicClient();
  const { signer, error: signerError } = useSigner();
  const chainId = useChainId();
  const { switchChain, isPending: chainSwitchPending } = useSwitchChain();
  const isWrongChain = authType !== "magic" && chainId !== TARGET_CHAIN.id;

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
      if (!signer) {
        // Read-only status check — fail quietly, same as any other status-check error.
        setIsVerified(false);
        return;
      }
      const sdk = new IdentitySDK({
        publicClient: contractPublicClient as any,
        walletClient: signer as any,
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
  }, [addressToVerify, contractPublicClient, authType, signer]);

  // Initial verification status check
  useEffect(() => {
    checkVerificationStatus();
  }, [checkVerificationStatus]);

  const startVerification = useCallback(async () => {
    if (!addressToVerify || !contractPublicClient) {
      setError("Wallet not connected");
      return;
    }

    if (isWrongChain) {
      setError("Wrong network — switch to Celo mainnet in your wallet, then try again.");
      return;
    }

    setError(null);
    setIsVerifying(true);

    try {
      // Initialize SDK with wallet and public clients
      if (!signer) {
        const signerErrMsg = signerError || "Wallet signer not available — please try again.";
        console.error("[Identity] No signer available", {
          address: addressToVerify,
          isWrongChain,
          chainId,
          signerError: signerErrMsg,
          authType,
        });
        throw new Error(signerErrMsg);
      }
      const sdk = new IdentitySDK({
        publicClient: contractPublicClient as any,
        walletClient: signer as any,
        env: "production",
      });

      console.log("[Identity] SDK initialized, generating verification link...", {
        address: addressToVerify,
        chainId,
        TARGET_CHAIN_ID: TARGET_CHAIN.id,
      });

      // popupMode=false generates a *redirect*-mode link (GoodDollar's SDK
      // encodes the callback as `rdu`, not `cbu`) — it's built for GoodDollar's
      // face-scan page to navigate the browser straight back to callbackUrl
      // when it's done, not for postMessage-to-a-popup. So we navigate the
      // current tab instead of window.open()-ing it: no new window is ever
      // created, which means there's nothing for a popup blocker to catch.
      const verificationLink = await sdk.generateFVLink(
        false,
        window.location.href,
        TARGET_CHAIN.id
      );

      if (!verificationLink) {
        throw new Error("Failed to generate verification link");
      }

      console.log("[Identity] Redirecting to GoodDollar face scan...", { address: addressToVerify });

      // Full-page redirect. checkVerificationStatus() will run again on
      // mount when GoodDollar redirects back to this same URL.
      window.location.href = verificationLink;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Identity] Face verification error", {
        address: addressToVerify,
        errorMessage: message,
        errorContainsNetwork: message.includes("network"),
        errorContainsChain: message.includes("chain"),
        errorContainsSigner: message.includes("signer"),
        signerError,
        isWrongChain,
        chainId,
        TARGET_CHAIN_ID: TARGET_CHAIN.id,
        authType,
        fullError: err,
      });

      // Map specific SDK errors to user-friendly messages
      if (
        message.toLowerCase().includes("reject") ||
        message.toLowerCase().includes("denied") ||
        message.toLowerCase().includes("cancel")
      ) {
        setError(null); // Don't show error for user cancellation
      } else if (message.includes("already linked") || message.includes("duplicate") || message.includes("twin")) {
        setError("This face is already verified on a different wallet. Please connect your verified wallet to claim.");
      } else if (message.includes("wrong network") || message.includes("signer") || message.includes("wallet isn't ready")) {
        // Signer/wallet/network-switch issues — user is likely on wrong chain or wallet not ready
        setError(message);
      } else if (message.includes("network") || message.includes("chain")) {
        // Genuine SDK network errors (not wallet/signer related)
        setError("Network error during verification. Check your internet connection or try switching networks again.");
      } else {
        setError("Could not start face verification. Please try again.");
      }

      setIsVerifying(false);
    }
  }, [addressToVerify, contractPublicClient, authType, isWrongChain, signer, signerError]);

  const recheckVerification = useCallback(async () => {
    await checkVerificationStatus();
  }, [checkVerificationStatus]);

  const switchToTargetChain = useCallback(() => {
    switchChain({ chainId: TARGET_CHAIN.id });
  }, [switchChain]);

  return {
    isVerified,
    isLoading,
    isVerifying,
    error,
    isWrongChain,
    chainSwitchPending,
    startVerification,
    switchToTargetChain,
    recheckVerification,
  };
}
