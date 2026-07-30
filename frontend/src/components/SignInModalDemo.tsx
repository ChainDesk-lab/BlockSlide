"use client";

import { useState } from "react";

/**
 * DEV-ONLY: Demo component to show both steps of the redesigned SignInModal
 *
 * ⚠️ THIS IS NOT USED IN PRODUCTION
 * The real sign-in UI is in SignInModal.tsx, which is integrated into App.tsx
 * This file is only for visual design review at /demo route
 *
 * Do not import or use this component anywhere in the app.
 */
export default function SignInModalDemo() {
  const [activeStep, setActiveStep] = useState<"step1" | "step2">("step1");
  const [email, setEmail] = useState("");

  const validateEmail = (value: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };

  return (
    <div className="demo-container">
      <div className="demo-controls">
        <h1>SignInModal Design Review</h1>
        <div className="demo-tabs">
          <button
            className={`demo-tab ${activeStep === "step1" ? "demo-tab--active" : ""}`}
            onClick={() => setActiveStep("step1")}
          >
            Step 1: Sign in
          </button>
          <button
            className={`demo-tab ${activeStep === "step2" ? "demo-tab--active" : ""}`}
            onClick={() => setActiveStep("step2")}
          >
            Step 2: Choose wallet
          </button>
        </div>
      </div>

      <div className="demo-content">
        {activeStep === "step1" ? (
          // STEP 1: Sign in
          <div className="signin-modal-wrapper">
            <div className="signin-modal-overlay" style={{ pointerEvents: "none" }} />
            <div className="signin-modal-card">
              <div className="signin-modal-header">
                <h1 className="signin-modal-title">Sign in to BlockSlide</h1>
                <button className="signin-modal-close" aria-label="Close">
                  ✕
                </button>
              </div>

              <p className="signin-modal-tagline">Play 2048 onchain and earn G$.</p>

              {/* Primary action: Email login */}
              <form className="signin-form">
                <div className="signin-field">
                  <div className="signin-input-wrapper">
                    <span className="signin-input-icon">✉️</span>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="signin-email-input"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="signin-primary-button"
                  disabled={!validateEmail(email)}
                >
                  Continue with email
                </button>
              </form>

              {/* Divider */}
              <div className="signin-divider">
                <span className="signin-divider-text">OR</span>
              </div>

              {/* Secondary action: Wallet connect */}
              <button className="signin-secondary-button" onClick={() => setActiveStep("step2")}>
                <span className="signin-secondary-icon">👛</span>
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
        ) : (
          // STEP 2: Choose wallet
          <div className="signin-modal-wrapper">
            <div className="signin-modal-overlay" style={{ pointerEvents: "none" }} />
            <div className="signin-modal-card signin-modal-card--wallet">
              <div className="signin-modal-header signin-modal-header--wallet">
                <button
                  className="signin-modal-back"
                  onClick={() => setActiveStep("step1")}
                  aria-label="Go back"
                >
                  ←
                </button>
                <h2 className="signin-modal-title">Choose a wallet</h2>
                <button className="signin-modal-close" aria-label="Close">
                  ✕
                </button>
              </div>
              <p className="signin-modal-subtitle">Connect the wallet that holds your G$.</p>

              {/* Wallet list preview */}
              <div className="signin-modal-wallet-list">
                <div className="wallet-selector-options">
                  {/* MetaMask - shows real EIP-6963 icon or fallback */}
                  <button className="wallet-option">
                    <div className="wallet-option__icon-container">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-option__icon-fallback">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                        <path d="M1 8h22" />
                        <path d="M17 14a2 2 0 0 1 2 2" />
                      </svg>
                    </div>
                    <div className="wallet-option__content">
                      <div className="wallet-option__name-row">
                        <span className="wallet-option__name">MetaMask</span>
                        <span className="wallet-option__badge">Installed</span>
                      </div>
                    </div>
                    <span className="wallet-option__arrow">→</span>
                  </button>

                  {/* WalletConnect - uses official logo */}
                  <button className="wallet-option">
                    <div className="wallet-option__icon-container">
                      <img src="/walletconnect-logo.svg" alt="WalletConnect" className="wallet-option__icon-image" />
                    </div>
                    <div className="wallet-option__content">
                      <div className="wallet-option__name-row">
                        <span className="wallet-option__name">WalletConnect</span>
                      </div>
                      <span className="wallet-option__description">Connect mobile wallet via QR</span>
                    </div>
                    <span className="wallet-option__arrow">→</span>
                  </button>

                  {/* Phantom - shows fallback icon */}
                  <button className="wallet-option">
                    <div className="wallet-option__icon-container">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-option__icon-fallback">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                        <path d="M1 8h22" />
                        <path d="M17 14a2 2 0 0 1 2 2" />
                      </svg>
                    </div>
                    <div className="wallet-option__content">
                      <div className="wallet-option__name-row">
                        <span className="wallet-option__name">Phantom</span>
                        <span className="wallet-option__badge">Installed</span>
                      </div>
                    </div>
                    <span className="wallet-option__arrow">→</span>
                  </button>

                  {/* Rabby - shows fallback icon */}
                  <button className="wallet-option">
                    <div className="wallet-option__icon-container">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-option__icon-fallback">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                        <path d="M1 8h22" />
                        <path d="M17 14a2 2 0 0 1 2 2" />
                      </svg>
                    </div>
                    <div className="wallet-option__content">
                      <div className="wallet-option__name-row">
                        <span className="wallet-option__name">Rabby Wallet</span>
                        <span className="wallet-option__badge">Installed</span>
                      </div>
                    </div>
                    <span className="wallet-option__arrow">→</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .demo-container {
          padding: 40px 20px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .demo-controls {
          margin-bottom: 40px;
        }

        .demo-controls h1 {
          margin: 0 0 20px 0;
          font-size: 2rem;
          font-weight: 800;
        }

        .demo-tabs {
          display: flex;
          gap: 12px;
        }

        .demo-tab {
          padding: 10px 20px;
          background: #f0f0f0;
          border: 1px solid #ddd;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
        }

        .demo-tab:hover {
          background: #e0e0e0;
        }

        .demo-tab--active {
          background: #6b4eff;
          color: white;
          border-color: #6b4eff;
        }

        .demo-content {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 600px;
          background: #fafafa;
          border-radius: 12px;
          padding: 20px;
        }
      `}</style>
    </div>
  );
}
