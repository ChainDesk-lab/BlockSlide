"use client";

import { useState, useRef, useEffect } from "react";
import { useAuthSelection } from "../contexts/AuthSelectionContext";
import { useCleanAuth } from "../hooks/useCleanAuth";
import { useAccount } from "wagmi";
import { authErrMessage } from "../auth/AuthContext";
import WalletSelector from "./WalletSelector";

type SignInStep = "signin" | "wallet";

export default function SignInModal({ onClose }: { onClose?: () => void } = {}) {
  const { setSelectedAuth } = useAuthSelection();
  const { isReady, loading, login } = useCleanAuth();
  const { isConnected: wagmiConnected } = useAccount();

  const [step, setStep] = useState<SignInStep>("signin");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Auto-sign in once wallet is connected
  useEffect(() => {
    if (wagmiConnected && isReady && !loading && step === "wallet") {
      handleWalletConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wagmiConnected, isReady, loading, step]);

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
      setIsSubmitting(true);
      await login();
      // Login successful, parent component will close modal
    } catch (err) {
      const message = authErrMessage(err) ?? "Failed to connect wallet";
      console.error("[SignInModal] Wallet connection error:", err);
      setEmailError(message);
      setIsSubmitting(false);
      // Stay on wallet step to allow retry
    }
  };

  const handleBackToSignIn = () => {
    setStep("signin");
    setEmail("");
    setEmailError(null);
  };

  const isBusy = loading || !isReady || isSubmitting;

  if (step === "wallet") {
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
            <h2 className="signin-modal-title">Choose a wallet</h2>
            <button
              className="signin-modal-close"
              onClick={() => onClose?.()}
              aria-label="Close"
              disabled={isBusy}
            >
              ✕
            </button>
          </div>
          <p className="signin-modal-subtitle">Connect the wallet that holds your G$.</p>

          {emailError && (
            <div className="signin-error-box">
              <span className="signin-error-icon">⚠️</span>
              <span className="signin-error-text">{emailError}</span>
              <button
                className="signin-error-close"
                onClick={() => setEmailError(null)}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          <div className="signin-modal-wallet-list">
            <WalletSelector onClose={() => onClose?.()} />
          </div>
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
          <button
            className="signin-modal-close"
            onClick={() => onClose?.()}
            aria-label="Close"
            disabled={isBusy}
          >
            ✕
          </button>
        </div>

        <p className="signin-modal-tagline">Play 2048 onchain and earn G$.</p>

        {/* Error message */}
        {emailError && (
          <div className="signin-error-box">
            <span className="signin-error-icon">⚠️</span>
            <span className="signin-error-text">{emailError}</span>
            <button
              className="signin-error-close"
              onClick={() => setEmailError(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
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
