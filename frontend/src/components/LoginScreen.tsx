import { useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useWeb3Auth } from "../hooks/useWeb3Auth";
import { MailIcon, WalletIcon } from "./icons";

export default function LoginScreen() {
  const { openConnectModal } = useConnectModal();
  const { login: web3AuthLogin, isLoading: isWeb3AuthLoading, error: web3AuthError } = useWeb3Auth();
  const [isWalletConnecting, setIsWalletConnecting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const handleWalletConnect = async () => {
    setIsWalletConnecting(true);
    setEmailError(null);
    try {
      openConnectModal?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setEmailError(message);
    } finally {
      setTimeout(() => setIsWalletConnecting(false), 100);
    }
  };

  const handleEmailLogin = async () => {
    setEmailError(null);
    try {
      await web3AuthLogin();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email login failed";
      setEmailError(message);
      console.error("Email login failed:", error);
    }
  };

  const isLoading = isWalletConnecting || isWeb3AuthLoading;
  const errorMessage = emailError || (web3AuthError?.message || null);

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

        {/* Options */}
        <div className="login-options">
          {/* Connect Wallet Option */}
          <button
            className="login-option login-option--wallet"
            onClick={handleWalletConnect}
            disabled={isLoading}
            aria-busy={isWalletConnecting}
          >
            <span className="login-option__icon">
              <WalletIcon size={32} />
            </span>
            <div className="login-option__text">
              <h2 className="login-option__title">
                {isWalletConnecting ? "Connecting..." : "Connect Wallet"}
              </h2>
              <p className="login-option__description">
                Use MetaMask, Coinbase Wallet, or other EVM wallets
              </p>
            </div>
            <span className="login-option__arrow">{isWalletConnecting ? "⏳" : "→"}</span>
          </button>

          {/* Email Login Option */}
          <button
            className="login-option login-option--email"
            onClick={handleEmailLogin}
            disabled={isLoading}
            aria-busy={isWeb3AuthLoading}
          >
            <span className="login-option__icon">
              <MailIcon size={32} />
            </span>
            <div className="login-option__text">
              <h2 className="login-option__title">
                {isWeb3AuthLoading ? "Signing in..." : "Sign in with Email"}
              </h2>
              <p className="login-option__description">
                Create an embedded wallet with email or social login
              </p>
            </div>
            <span className="login-option__arrow">{isWeb3AuthLoading ? "⏳" : "→"}</span>
          </button>
        </div>

        {/* Error State */}
        {errorMessage && (
          <div className="login-error" role="alert">
            <p className="login-error__title">Authentication failed</p>
            <p className="login-error__message">{errorMessage}</p>
            <button
              className="login-error__dismiss"
              onClick={() => setEmailError(null)}
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
