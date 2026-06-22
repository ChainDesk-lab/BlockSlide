import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { WalletIcon } from "./icons";

export default function LoginScreen() {
  const { login, connectWallet, ready } = usePrivy();
  const [isLoading, setIsLoading] = useState(false);
  const [activeMethod, setActiveMethod] = useState<"email" | "wallet" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEmailLogin = () => {
    setIsLoading(true);
    setActiveMethod("email");
    setError(null);
    try {
      login();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to sign in with email";
      setError(message);
      setActiveMethod(null);
      setIsLoading(false);
    }
  };

  const handleWalletConnect = () => {
    setIsLoading(true);
    setActiveMethod("wallet");
    setError(null);
    try {
      connectWallet();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      setActiveMethod(null);
      setIsLoading(false);
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
            onClick={handleEmailLogin}
            disabled={isLoading || !ready}
            aria-busy={isLoading && activeMethod === "email"}
          >
            <span className="login-option__icon">✉</span>
            <div className="login-option__text">
              <h2 className="login-option__title">
                {isLoading && activeMethod === "email" ? "Signing in..." : "Sign in with Email"}
              </h2>
              <p className="login-option__description">
                Get an OTP code sent to your email
              </p>
            </div>
            <span className="login-option__arrow">
              {isLoading && activeMethod === "email" ? "⏳" : "→"}
            </span>
          </button>

          {/* Wallet Connect Option */}
          <button
            className="login-option login-option--wallet"
            onClick={handleWalletConnect}
            disabled={isLoading || !ready}
            aria-busy={isLoading && activeMethod === "wallet"}
          >
            <span className="login-option__icon">
              <WalletIcon size={24} />
            </span>
            <div className="login-option__text">
              <h2 className="login-option__title">
                {isLoading && activeMethod === "wallet" ? "Connecting..." : "Connect Wallet"}
              </h2>
              <p className="login-option__description">
                Use MetaMask, MiniPay, or other EVM wallets
              </p>
            </div>
            <span className="login-option__arrow">
              {isLoading && activeMethod === "wallet" ? "⏳" : "→"}
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
