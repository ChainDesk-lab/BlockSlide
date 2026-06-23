import { useState } from "react";
import { useWeb3AuthConnect, useWeb3Auth } from "@web3auth/modal/react";
import { WalletIcon } from "./icons";

export default function LoginScreen() {
  const { isInitialized } = useWeb3Auth();
  const { connect, loading } = useWeb3AuthConnect();
  const [activeMethod, setActiveMethod] = useState<"email" | "wallet" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = isInitialized;

  // Both options open the Web3Auth modal, which offers email passwordless login
  // and external wallets (MetaMask, WalletConnect, injected) in one place.
  const openLogin = async (method: "email" | "wallet") => {
    if (!ready) {
      setError("Authentication is still initializing...");
      return;
    }

    setActiveMethod(method);
    setError(null);

    try {
      await connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to sign in";
      console.error("Web3Auth login error:", message);
      setError(message);
    } finally {
      setActiveMethod(null);
    }
  };

  if (!ready) {
    return (
      <div className="login-screen">
        <div className="login-container">
          <div className="login-header">
            <h1 className="login-title">BlockSlide</h1>
          </div>
          <div className="login-loading">
            <p>Initializing authentication...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-container">
        {/* Header */}
        <div className="login-header">
          <h1 className="login-title">BlockSlide</h1>
          <p className="login-subtitle">
            Slide tiles, climb the leaderboard, earn G$ on Celo
          </p>
        </div>

        {/* Login Options */}
        <div className="login-options">
          {/* Email Login Option */}
          <button
            className="login-option login-option--email"
            onClick={() => openLogin("email")}
            disabled={loading || !ready}
            aria-busy={loading && activeMethod === "email"}
          >
            <span className="login-option__icon">✉</span>
            <div className="login-option__text">
              <h2 className="login-option__title">
                {loading && activeMethod === "email" ? "Signing in..." : "Sign in with Email"}
              </h2>
              <p className="login-option__description">
                Get an OTP code sent to your email
              </p>
            </div>
            <span className="login-option__arrow">
              {loading && activeMethod === "email" ? "⏳" : "→"}
            </span>
          </button>

          {/* Wallet Connect Option */}
          <button
            className="login-option login-option--wallet"
            onClick={() => openLogin("wallet")}
            disabled={loading || !ready}
            aria-busy={loading && activeMethod === "wallet"}
          >
            <span className="login-option__icon">
              <WalletIcon size={24} />
            </span>
            <div className="login-option__text">
              <h2 className="login-option__title">
                {loading && activeMethod === "wallet" ? "Connecting..." : "Connect Wallet"}
              </h2>
              <p className="login-option__description">
                Use MetaMask, MiniPay, or other EVM wallets
              </p>
            </div>
            <span className="login-option__arrow">
              {loading && activeMethod === "wallet" ? "⏳" : "→"}
            </span>
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="login-error" role="alert">
            <p className="login-error__title">Authentication failed</p>
            <p className="login-error__message">{error}</p>
            <button
              className="login-error__dismiss"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="login-footer">
          <p className="login-disclaimer">
            BlockSlide requires{" "}
            <a
              href="https://www.gooddollar.org"
              target="_blank"
              rel="noopener noreferrer"
              className="login-link"
            >
              GoodDollar
            </a>{" "}
            identity verification to play.
          </p>
          <p className="login-features">
            Requires: Verified identity • Celo wallet • Internet connection
          </p>
        </div>
      </div>
    </div>
  );
}
