import { useCallback, useEffect, useState } from "react";
import { ClaimSDK, IdentitySDK } from "@goodsdks/citizen-sdk";
import { useGoodDollarIdentity } from "../hooks/useGoodDollarIdentity";
import { useGDollarBalance } from "../hooks/useGDollarBalance";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useContractAddress, useContractPublicClient } from "../hooks/useContractData";
import { useSigner } from "../hooks/useSigner";
import { CoinIcon } from "./icons";
import { IconBadge } from "./IconBadge";

// Mirrors WalletClaimStatus["status"] from @goodsdks/citizen-sdk, plus
// "unknown" (not checked yet) and "check_failed" (the status check itself
// threw — must never be displayed as "already claimed").
type ClaimStatus = "unknown" | "not_whitelisted" | "can_claim" | "already_claimed" | "check_failed";

interface ClaimState {
  claimStatus: ClaimStatus;
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
  // Single source of truth for the signer — for Magic/email users this builds
  // a real viem WalletClient with `account` set. The GoodDollar SDK throws
  // synchronously ("WalletClient must have an account attached") if it's
  // missing, which previously happened here because this component used to
  // call the old useContractWalletClient() directly, whose Magic branch
  // returns a stand-in object with account left undefined.
  const { signer, isReady: isSignerReady, error: signerError } = useSigner();
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
    claimStatus: "unknown",
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

  // Check entitlement status using GoodDollar SDK.
  // Defined outside the effect (via useCallback) so the "check failed" retry
  // button can re-run the exact same logic instead of duplicating it.
  const checkEntitlement = useCallback(async () => {
    if (!address || !isVerified) {
      setState((prev) => ({ ...prev, claimStatus: "unknown" }));
      return;
    }

    if (!publicClient || !signer) {
      if (isSignerReady) {
        // useSigner() finished trying and came up empty (wrong network, Magic
        // misconfigured, wagmi exhausted its retries, etc.) — this is a real
        // failure, not "still loading". Surface it instead of spinning forever.
        setState((prev) => ({
          ...prev,
          claimStatus: "check_failed",
          error: signerError || "Wallet signer not available",
        }));
      }
      // Otherwise still resolving — leave status as "unknown" (renders the
      // loading state below) rather than guessing at an outcome.
      return;
    }

    try {
      setState((prev) => ({ ...prev, error: null }));

      // Initialize IdentitySDK to support ClaimSDK
      const identitySDK = await IdentitySDK.init({
        publicClient: publicClient as any,
        walletClient: signer as any,
        env: "production",
      });

      // Initialize ClaimSDK
      const claimSDK = await ClaimSDK.init({
        publicClient: publicClient as any,
        walletClient: signer as any,
        identitySDK,
        env: "production",
      });

      // Check wallet claim status
      const status = await claimSDK.getWalletClaimStatus();

      setState((prev) => ({
        ...prev,
        claimStatus: status.status,
        nextClaimTime: status.nextClaimTime || null,
      }));
    } catch (err) {
      console.error("Error checking entitlement:", err);
      // IMPORTANT: this must stay distinct from "already_claimed" — collapsing
      // a thrown error into the same state as a real claim history is what
      // previously made SDK failures look like "Already Claimed Today".
      setState((prev) => ({
        ...prev,
        claimStatus: "check_failed",
        error: signerError || "Could not check entitlement status",
      }));
    }
  }, [address, isVerified, publicClient, signer, isSignerReady, signerError]);

  useEffect(() => {
    checkEntitlement();
  }, [checkEntitlement]);

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
        setState((prev) => ({ ...prev, claimStatus: "can_claim", nextClaimTime: null }));
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

    if (!publicClient || !signer) {
      console.log("[CLAIM] Pre-condition failed - missing publicClient or signer", {
        hasPublicClient: !!publicClient,
        hasSigner: !!signer,
      });
      setState((prev) => ({ ...prev, error: signerError || "Wallet not ready" }));
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
        walletClient: signer as any,
        env: "production",
      });
      console.log("[CLAIM] IdentitySDK initialized successfully");

      // Initialize ClaimSDK
      console.log("[CLAIM] Initializing ClaimSDK...");
      const claimSDK = await ClaimSDK.init({
        publicClient: publicClient as any,
        walletClient: signer as any,
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
        claimStatus: "already_claimed",
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
      // Notify other components (e.g. WalletButton) that G$ balance has changed
      window.dispatchEvent(new Event("gdBalanceChanged"));
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
            You'll be redirected to GoodDollar to complete the face scan, then brought back here automatically.
          </p>
        )}
      </section>
    );
  }

  // Still resolving the signer and/or the on-chain claim status — don't
  // guess. Showing "Already Claimed Today" here (the old behavior) is what
  // hid the actual bug for Magic/email users whose signer never resolved.
  if (state.claimStatus === "unknown") {
    return (
      <section className="daily-claim">
        <div className="daily-claim__info">
          <span className="daily-claim__icon">
            <CoinIcon size={22} />
          </span>
          <div className="daily-claim__text">
            <h3 className="daily-claim__title">Claim Daily G$</h3>
            <p className="daily-claim__status">Checking claim status...</p>
          </div>
        </div>
        <button className="btn btn--primary" disabled>
          Loading...
        </button>
      </section>
    );
  }

  // The status check itself failed (SDK init threw, RPC error, etc.) — this
  // must render distinctly from "already claimed" so a broken check never
  // masquerades as a legitimate claim history. Offer a retry instead of a
  // dead-end disabled button.
  if (state.claimStatus === "check_failed") {
    return (
      <section className="daily-claim daily-claim--error">
        <div className="daily-claim__info">
          <span className="daily-claim__icon">
            <CoinIcon size={22} />
          </span>
          <div className="daily-claim__text">
            <h3 className="daily-claim__title">Claim Daily G$</h3>
            <p className="daily-claim__status">Couldn't check your claim status</p>
            {state.error && <p className="daily-claim__error">{state.error}</p>}
          </div>
        </div>
        <button className="btn btn--secondary" onClick={checkEntitlement}>
          Retry
        </button>
      </section>
    );
  }

  // Rare divergence: our own identity check (getWhitelistedRoot) says
  // verified, but GoodDollar's claim contract hasn't picked that up yet
  // (on-chain sync lag). Distinct from "already claimed" so it's clear this
  // isn't a dead end — a retry after a short wait typically resolves it.
  if (state.claimStatus === "not_whitelisted") {
    return (
      <section className="daily-claim daily-claim--error">
        <div className="daily-claim__info">
          <span className="daily-claim__icon">
            <CoinIcon size={22} />
          </span>
          <div className="daily-claim__text">
            <h3 className="daily-claim__title">Claim Daily G$</h3>
            <p className="daily-claim__status">Still syncing your verification</p>
            <p className="daily-claim__error">
              Your identity was verified but hasn't synced with the claim contract yet. This
              can take a few minutes — try again shortly.
            </p>
          </div>
        </div>
        <button className="btn btn--secondary" onClick={checkEntitlement}>
          Retry
        </button>
      </section>
    );
  }

  if (state.claimStatus === "already_claimed") {
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
