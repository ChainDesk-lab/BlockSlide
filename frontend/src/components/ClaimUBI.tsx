import { useEffect, useState } from "react";
import { ClaimSDK, IdentitySDK } from "@goodsdks/citizen-sdk";
import { useGoodDollarIdentity } from "../hooks/useGoodDollarIdentity";
import { useGDollarBalance } from "../hooks/useGDollarBalance";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useContractAddress, useContractPublicClient, useContractWalletClient } from "../hooks/useContractData";
import { CoinIcon } from "./icons";
import { IconBadge } from "./IconBadge";

interface ClaimState {
  isEntitled: boolean;
  isClaiming: boolean;
  error: string | null;
  success: boolean;
  nextClaimTime: Date | null;
  txHash: string | null;
}

export default function ClaimUBI() {
  const { isConnected } = useAuth();
  const address = useContractAddress();
  const publicClient = useContractPublicClient();
  const walletClient = useContractWalletClient();
  const { showToast } = useToast();

  // Use unified GoodDollar identity hook
  const {
    isVerified,
    isLoading: isLoadingVerification,
    isVerifying,
    error: verificationError,
    startVerification,
  } = useGoodDollarIdentity();

  // Use separate hook for G$ balance refetching
  const { balance, refetch: refetchBalance } = useGDollarBalance();

  const [state, setState] = useState<ClaimState>({
    isEntitled: false,
    isClaiming: false,
    error: null,
    success: false,
    nextClaimTime: null,
    txHash: null,
  });

  const [countdown, setCountdown] = useState<string>("");

  // Listen for score submission events and refetch balance (milestone rewards)
  useEffect(() => {
    const handleScoreSubmitted = async () => {
      // Wait a moment for the transaction to be fully processed
      await new Promise((r) => setTimeout(r, 1500));
      await refetchBalance();
    };

    window.addEventListener("scoreSubmitted", handleScoreSubmitted);
    return () => window.removeEventListener("scoreSubmitted", handleScoreSubmitted);
  }, [refetchBalance]);

  useEffect(() => {
    refetchBalance();
  }, [refetchBalance]);

  // Check entitlement status using GoodDollar SDK
  useEffect(() => {
    if (!address || !isVerified) {
      setState((prev) => ({ ...prev, isEntitled: false }));
      return;
    }

    const checkEntitlement = async () => {
      try {
        setState((prev) => ({ ...prev, error: null }));

        if (!publicClient || !walletClient) {
          return;
        }

        // Initialize IdentitySDK to support ClaimSDK
        const identitySDK = await IdentitySDK.init({
          publicClient: publicClient as any,
          walletClient: walletClient as any,
          env: "production",
        });

        // Initialize ClaimSDK
        const claimSDK = await ClaimSDK.init({
          publicClient: publicClient as any,
          walletClient: walletClient as any,
          identitySDK,
          env: "production",
        });

        // Check wallet claim status
        const status = await claimSDK.getWalletClaimStatus();

        setState((prev) => ({
          ...prev,
          isEntitled: status.status === "can_claim",
          nextClaimTime: status.nextClaimTime || null,
        }));
      } catch (err) {
        console.error("Error checking entitlement:", err);
        setState((prev) => ({
          ...prev,
          isEntitled: false,
          error: "Could not check entitlement status",
        }));
      }
    };

    checkEntitlement();
  }, [address, isVerified, publicClient, walletClient]);

  // Auto-dismiss success message after 6 seconds
  useEffect(() => {
    if (!state.success) return;

    const timer = setTimeout(() => {
      setState((prev) => ({ ...prev, success: false, txHash: null }));
    }, 6000);

    return () => clearTimeout(timer);
  }, [state.success]);

  // Update countdown timer
  useEffect(() => {
    if (!state.nextClaimTime) {
      setCountdown("");
      return;
    }

    const updateCountdown = () => {
      const now = new Date();
      const diff = state.nextClaimTime!.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown("");
        setState((prev) => ({ ...prev, isEntitled: true, nextClaimTime: null }));
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setCountdown(`${hours}h ${minutes}m`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);
    return () => clearInterval(interval);
  }, [state.nextClaimTime]);

  const handleClaim = async () => {
    console.log("[CLAIM] Button clicked - starting claim flow");

    if (!address || !isVerified) {
      console.log("[CLAIM] Pre-condition failed - address or not verified", { address, isVerified });
      setState((prev) => ({ ...prev, error: "Please verify your identity first" }));
      return;
    }

    console.log("[CLAIM] Address verified", { address });

    if (!publicClient || !walletClient) {
      console.log("[CLAIM] Pre-condition failed - missing publicClient or walletClient", {
        hasPublicClient: !!publicClient,
        hasWalletClient: !!walletClient
      });
      setState((prev) => ({ ...prev, error: "Wallet not ready" }));
      return;
    }

    console.log("[CLAIM] Wallet clients ready");

    try {
      console.log("[CLAIM] Setting isClaiming state to true");
      setState((prev) => ({ ...prev, isClaiming: true, error: null }));

      // Initialize IdentitySDK
      console.log("[CLAIM] Initializing IdentitySDK...");
      const identitySDK = await IdentitySDK.init({
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        env: "production",
      });
      console.log("[CLAIM] IdentitySDK initialized successfully");

      // Initialize ClaimSDK
      console.log("[CLAIM] Initializing ClaimSDK...");
      const claimSDK = await ClaimSDK.init({
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        identitySDK,
        env: "production",
      });
      console.log("[CLAIM] ClaimSDK initialized successfully");

      // Execute claim with SDK - requests wallet signature for on-chain transaction
      console.log("[CLAIM] Calling claimSDK.claim() - about to submit transaction...");
      const receipt = await claimSDK.claim();
      console.log("[CLAIM] Transaction submitted, receipt:", receipt);

      console.log("[CLAIM] Receipt received:", receipt);

      if (!receipt?.transactionHash) {
        console.log("[CLAIM] ERROR: No transaction hash in receipt");
        throw new Error("Claim transaction did not return a hash");
      }

      const txHash = receipt.transactionHash;
      console.log("[CLAIM] Transaction hash:", txHash);

      // Get updated claim status
      console.log("[CLAIM] Fetching updated claim status...");
      const status = await claimSDK.getWalletClaimStatus();
      console.log("[CLAIM] Claim status updated:", status);

      // Successful claim - show success message inline
      console.log("[CLAIM] SUCCESS - setting success state");
      setState((prev) => ({
        ...prev,
        success: true,
        isClaiming: false,
        isEntitled: false,
        txHash,
        nextClaimTime: status.nextClaimTime || null,
      }));

      // Show success toast
      showToast("✓ Daily G$ claimed! Check your balance.", "success");

      // Wait for the transaction to be fully processed on-chain.
      // Celo blocks are ~5s, plus indexing time — use longer delay to be safe.
      // Also try refetching multiple times in case first attempt hits cache.
      console.log("[CLAIM] Waiting 3s for on-chain confirmation...");
      await new Promise((r) => setTimeout(r, 3000));

      // Refetch balance, with retry if it still shows 0
      console.log("[CLAIM] Refetching balance...");
      const newBalance = await refetchBalance();
      console.log("[CLAIM] New balance:", newBalance);
      if (newBalance === "0") {
        // Balance still 0 after claim — wait and retry once more
        console.log("[CLAIM] Balance still 0, retrying after 2s...");
        await new Promise((r) => setTimeout(r, 2000));
        await refetchBalance();
      }
      console.log("[CLAIM] Claim flow completed successfully");
    } catch (err) {
      console.log("[CLAIM] CAUGHT ERROR:", err);
      const errorMsg = err instanceof Error ? err.message : "Failed to claim G$";

      // Check if user rejected the transaction
      if (
        errorMsg.toLowerCase().includes("reject") ||
        errorMsg.toLowerCase().includes("denied") ||
        errorMsg.toLowerCase().includes("cancel")
      ) {
        console.log("[CLAIM] User rejected transaction - hiding error");
        setState((prev) => ({ ...prev, error: null, isClaiming: false }));
      } else {
        console.log("[CLAIM] Error occurred - showing to user:", errorMsg);
        setState((prev) => ({
          ...prev,
          error: errorMsg,
          isClaiming: false,
        }));
        showToast(`❌ ${errorMsg}`, "error");
      }
    }
  };

  if (!isConnected) {
    return (
      <section className="daily-claim">
        <div className="daily-claim__info">
          <span className="daily-claim__icon">
            <CoinIcon size={22} />
          </span>
          <div className="daily-claim__text">
            <h3 className="daily-claim__title">Claim Daily G$</h3>
            <p className="daily-claim__status">Connect wallet to claim your UBI</p>
          </div>
        </div>
        <button className="btn btn--primary" disabled>
          Connect Wallet
        </button>
      </section>
    );
  }

  if (isLoadingVerification) {
    return (
      <section className="daily-claim">
        <div className="daily-claim__info">
          <span className="daily-claim__icon">
            <CoinIcon size={22} />
          </span>
          <div className="daily-claim__text">
            <h3 className="daily-claim__title">Claim Daily G$</h3>
            <p className="daily-claim__status">Checking eligibility...</p>
          </div>
        </div>
        <button className="btn btn--primary" disabled>
          Loading...
        </button>
      </section>
    );
  }

  if (!isVerified) {
    return (
      <section className="daily-claim daily-claim--verify-needed">
        <div className="daily-claim__info">
          <span className="daily-claim__icon">
            <CoinIcon size={22} />
          </span>
          <div className="daily-claim__text">
            <h3 className="daily-claim__title">Verify to Claim G$</h3>
            <p className="daily-claim__status">
              Verify your identity to unlock daily G$ claims
            </p>
            {verificationError && (
              <p className="daily-claim__error">{verificationError}</p>
            )}
          </div>
        </div>
        <button
          className="btn btn--primary"
          onClick={startVerification}
          disabled={isVerifying}
        >
          {isVerifying ? (
            <>
              <span className="spinner" aria-hidden="true" /> Verifying…
            </>
          ) : (
            "Verify Identity"
          )}
        </button>
        {isVerifying && (
          <p className="daily-claim__help-text">
            Complete the face scan in the popup window. When done, come back and we'll check your status.
          </p>
        )}
      </section>
    );
  }

  if (!state.isEntitled) {
    return (
      <section className="daily-claim daily-claim--claimed">
        <div className="daily-claim__info">
          <span className="daily-claim__icon">
            <CoinIcon size={22} />
          </span>
          <div className="daily-claim__text">
            <h3 className="daily-claim__title">Claim Daily G$</h3>
            <p className="daily-claim__status">✓ Claimed!</p>
            {countdown && (
              <p className="daily-claim__countdown">Next claim available in {countdown}</p>
            )}
            {balance && (
              <p className="daily-claim__balance">
                Balance: <strong>{parseFloat(balance).toFixed(2)} G$</strong>
              </p>
            )}
          </div>
        </div>
        <button className="btn btn--disabled">
          Already Claimed Today
        </button>
      </section>
    );
  }

  return (
    <section className={`daily-claim daily-claim--ready ${state.success ? "daily-claim--success" : ""}`}>
      <div className="daily-claim__info">
        <IconBadge icon={<CoinIcon size={22} />} size="lg" />
        <div className="daily-claim__text">
          <h3 className="daily-claim__title">Claim Daily G$</h3>
          {state.success ? (
            <>
              <p className="daily-claim__status">✓ G$ added to your account!</p>
              <p className="daily-claim__success-message">
                Your daily UBI has been successfully claimed.
              </p>
              {balance && (
                <p className="daily-claim__balance">
                  New balance: <strong>{parseFloat(balance).toFixed(2)} G$</strong>
                </p>
              )}
              {state.txHash && (
                <p className="daily-claim__tx-hash">
                  <a
                    href={`https://celoscan.io/tx/${state.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="daily-claim__tx-link"
                    title="View on Celoscan"
                  >
                    View transaction →
                  </a>
                </p>
              )}
            </>
          ) : (
            <>
              <p className="daily-claim__status">Ready to claim your UBI</p>
              {balance && (
                <p className="daily-claim__balance">
                  Current balance: <strong>{parseFloat(balance).toFixed(2)} G$</strong>
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <button
        className="btn btn--primary"
        onClick={handleClaim}
        disabled={state.isClaiming || state.success}
      >
        {state.isClaiming ? (
          <>
            <span className="spinner" aria-hidden="true" /> Claiming…
          </>
        ) : state.success ? (
          "✓ Claimed!"
        ) : (
          "Claim Daily G$"
        )}
      </button>
      {state.error && <p className="daily-claim__error-message">{state.error}</p>}
    </section>
  );
}
