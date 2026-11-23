"use client";

import { useState, useRef, useEffect } from "react";
import { useAuthSelection } from "../contexts/AuthSelectionContext";
import { useCleanAuth } from "../hooks/useCleanAuth";
import { useNetworkGuard } from "../hooks/useNetworkGuard";
import { useAccount } from "wagmi";
import { authErrMessage } from "../auth/AuthContext";
import { FAILURE_COPY, connectErrorMessage } from "../lib/celoOnboarding";
import WalletSelector from "./WalletSelector";
import WalletSetupPanel from "./WalletSetupPanel";
import Notice from "./Notice";

type SignInStep = "signin" | "wallet";

export default function SignInModal({ onClose }: { onClose?: () => void } = {}) {
  const { selectedAuth, setSelectedAuth } = useAuthSelection();
  const { isReady, loading, login } = useCleanAuth();
  const { isConnected: wagmiConnected } = useAccount();
  const walletSetup = useNetworkGuard();

  const [step, setStep] = useState<SignInStep>("signin");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // A browser wallet that is connecting, being set up on Celo, or just became ready keeps the
  // wallet view up whichever step this was on: after a reload, or when the wallet moves off
  // Celo mid-game, the player sees the setup instead of the email form. So does a wallet that
  // disconnected mid-setup, so the player learns why and can pick a wallet again.
  const walletInPlay = selectedAuth === "wallet" && (walletSetup.status !== "idle" || walletSetup.interrupted);
  const showWallet = step === "wallet" || walletInPlay;
  const choosing = walletSetup.status === "idle" || walletSetup.status === "connecting";

  // Auto-sign in once wallet is connected
  useEffect(() => {
    if (wagmiConnected && isReady && !loading && step === "wallet") {
      handleWalletConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wagmiConnected, isReady, loading, step]);

  // While the setup is on screen it speaks for itself; the floating banner stays out of the way.
  const { registerSurface } = walletSetup;
  useEffect(() => {
    if (!showWallet) return;
    return registerSurface();
  }, [showWallet, registerSurface]);

  // When a caller can close this modal, close it once the wallet is ready on Celo. (As the
  // app's sign-in gate there is no onClose: the app takes over once it reports signed in.)
  useEffect(() => {
    if (showWallet && wagmiConnected && walletSetup.status === "ready" && !walletSetup.celebrating) onClose?.();
  }, [showWallet, wagmiConnected, walletSetup.status, walletSetup.celebrating, onClose]);

  const validateEmail = (value: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setEmailError(null);
  };

  const handleEmailSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    setIsSubmitting(true);
    setEmailError(null);

    try {
      setSelectedAuth("email");
      await login(email.trim());
      // Login successful, parent component will close modal
    } catch (err) {
      const message = authErrMessage(err) ?? "Failed to sign in";
      setEmailError(message);
      setIsSubmitting(false);
    }
  };

  const handleWalletClick = () => {
    setSelectedAuth("wallet");
    setStep("wallet");
  };

  const handleWalletConnect = async () => {
    if (!wagmiConnected || !isReady) return;

    try {
      // For browser wallets this is a no-op: WalletSelector connects, and the Celo setup runs on
      // its own. It doesn't mark the modal busy, so Back and the setup actions stay usable.
      await login();
    } catch (err) {
      const message = authErrMessage(err) ?? "Failed to connect wallet";
      console.error("[SignInModal] Wallet connection error:", err);
      setEmailError(message);
      // Stay on wallet step to allow retry
    }
  };

  // Drop a wallet that is connected but not set up, and go back to the wallet list.
  const pickDifferentWallet = () => {
    walletSetup.disconnectWallet();
    setWalletName(null);
    setConnectError(null);
    setStep("wallet");
  };

  const handleSetupAction = () => {
    const failure = walletSetup.failure;
    if (failure && FAILURE_COPY[failure].action === "reconnect") pickDifferentWallet();
    else walletSetup.retrySwitch();
  };

  const handleBackToSignIn = () => {
    // A wallet left half set up behind the email form would keep prompting; let it go.
    if (walletSetup.status !== "idle") walletSetup.disconnectWallet();
    setStep("signin");
    setEmail("");
    setEmailError(null);
    setConnectError(null);
    setWalletName(null);
  };

  const isBusy = loading || !isReady || isSubmitting;

  if (showWallet) {
    const title = choosing ? "Choose a wallet" : walletSetup.status === "ready" ? "Wallet ready" : "Setting up your wallet";
    // On a phone without a wallet browser, WalletConnect starts pairing in the background before
    // the player picks anything: until they do, there's nothing for them to approve yet.
    const panelStatus =
      walletSetup.status === "connecting" && !walletSetup.restoring && !walletName ? "idle" : walletSetup.status;
    return (
      <div className="signin-modal-wrapper">
        <div className="signin-modal-overlay" onClick={onClose} />
        <div className="signin-modal-card signin-modal-card--wallet">
          <div className="signin-modal-header signin-modal-header--wallet">
            <button
              className="signin-modal-back"
              onClick={handleBackToSignIn}
              aria-label="Go back"
              disabled={isBusy}
            >
              ←
            </button>
            <h2 className="signin-modal-title">{title}</h2>
            {onClose && (
              <button
                className="signin-modal-close"
                onClick={onClose}
                aria-label="Close"
                disabled={isBusy}
              >
                ✕
              </button>
            )}
          </div>
          {choosing && <p className="signin-modal-subtitle">Connect the wallet that holds your G$. We'll set it up on Celo for you.</p>}

          <WalletSetupPanel
            status={panelStatus}
            failure={walletSetup.failure}
            walletName={walletName}
            restoring={walletSetup.restoring}
            onAction={handleSetupAction}
            onUseDifferentWallet={pickDifferentWallet}
          />

          {emailError && (
            <Notice
              tone="error"
              className="signin-error-box"
              onDismiss={() => setEmailError(null)}
              dismissLabel="Dismiss"
            >
              <span className="signin-error-text">{emailError}</span>
            </Notice>
          )}

          {choosing && walletSetup.interrupted && (
            <Notice
              tone="warning"
              title={FAILURE_COPY.disconnected.title}
              className="signin-error-box"
              onDismiss={walletSetup.dismissInterrupted}
              dismissLabel="Dismiss"
            >
              <span className="signin-error-text">{FAILURE_COPY.disconnected.message}</span>
            </Notice>
          )}

          {walletSetup.status === "idle" && connectError && (
            <Notice
              tone="error"
              className="signin-error-box"
              onDismiss={() => setConnectError(null)}
              dismissLabel="Dismiss"
            >
              <span className="signin-error-text">{connectError}</span>
            </Notice>
          )}

          {choosing && (
            <div className="signin-modal-wallet-list">
              <WalletSelector
                // Connected is not done yet: this modal moves on once the wallet is on Celo.
                onClose={() => {}}
                onConnectStart={(name) => {
                  setWalletName(name);
                  setConnectError(null);
                  walletSetup.dismissInterrupted();
                }}
                onConnectError={(err) => setConnectError(connectErrorMessage(err))}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="signin-modal-wrapper">
      <div className="signin-modal-overlay" onClick={onClose} />
      <div className="signin-modal-card">
        <div className="signin-modal-header">
          <h1 className="signin-modal-title">Sign in to BlockSlide</h1>
          {/* Only when the caller can close it: as the app's sign-in gate there is
              nothing behind it to return to, and the button did nothing. */}
          {onClose && (
            <button
              className="signin-modal-close"
              onClick={onClose}
              aria-label="Close"
              disabled={isBusy}
            >
              ✕
            </button>
          )}
        </div>

        <p className="signin-modal-tagline">Play 2048 onchain and earn G$.</p>

        {/* Error message */}
        {emailError && (
          <Notice
            tone="error"
            className="signin-error-box"
            onDismiss={() => setEmailError(null)}
            dismissLabel="Dismiss"
          >
            <span className="signin-error-text">{emailError}</span>
          </Notice>
        )}

        {/* Primary action: Email login */}
        <form onSubmit={handleEmailSubmit} className="signin-form">
          <div className="signin-field">
            <div className="signin-input-wrapper">
              <svg className="signin-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              <input
                ref={emailInputRef}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                className="signin-email-input"
                disabled={isBusy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && validateEmail(email)) {
                    handleEmailSubmit();
                  }
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            className={`signin-primary-button ${
              isBusy ? "signin-primary-button--loading" : ""
            }`}
            disabled={!validateEmail(email) || isBusy}
          >
            {isBusy ? (
              <>
                <span className="signin-spinner" />
                Sending magic link...
              </>
            ) : (
              "Continue with email"
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="signin-divider">
          <span className="signin-divider-text">OR</span>
        </div>

        {/* Secondary action: Wallet connect */}
        <button
          className="signin-secondary-button"
          onClick={handleWalletClick}
          disabled={isBusy}
        >
          <svg className="signin-secondary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <path d="M1 8h22" />
            <circle cx="17" cy="15" r="1" />
          </svg>
          <span className="signin-secondary-text">
            <span className="signin-secondary-label">Connect a wallet</span>
          </span>
          <span className="signin-secondary-chevron">›</span>
        </button>

        {/* Footer reassurance */}
        <p className="signin-footer-text">
          Email creates a secure wallet for you automatically. No seed phrase needed.
        </p>
      </div>
    </div>
  );
}
