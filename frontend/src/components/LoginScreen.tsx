import { useState, useEffect } from "react";
import { authErrMessage } from "../auth/AuthContext";
import { useCleanAuth } from "../hooks/useCleanAuth";
import { useAuthSelection } from "../contexts/AuthSelectionContext";
import { useAccount } from "wagmi";
import { BoltIcon } from "./icons";
import WalletSelector from "./WalletSelector";

export default function LoginScreen() {
  const { isReady, loading, error: authError, login } = useCleanAuth();
  const { selectedAuth, setSelectedAuth } = useAuthSelection();
  const { isConnected: wagmiConnected } = useAccount();
  const [caughtError, setCaughtError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [showWalletSelector, setShowWalletSelector] = useState(false);

  // Show wallet selector when wallet tab selected
  // Also reset all state when switching tabs for a clean experience
  useEffect(() => {
    if (selectedAuth === "wallet") {
      setShowWalletSelector(true);
      // Clear email when switching to wallet
      setEmail("");
    } else {
      // Close modal and clear state when switching away from wallet tab
      setShowWalletSelector(false);
    }
    // Always clear error state when switching tabs
    setCaughtError(null);
  }, [selectedAuth]);

  // Auto-sign in once wallet is connected
  useEffect(() => {
    if (wagmiConnected && selectedAuth === "wallet" && isReady && !loading) {
      handleSignIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wagmiConnected, isReady, loading]);

  // Surface whichever error is present.
  const error = caughtError ?? authError;

  // Busy while the SDK/connector is still booting OR a connect is in flight.
  const busy = loading || !isReady;

  // Show tabs to let user choose auth method
  const showAuthTabs = true;

  const handleSignIn = async () => {
    console.log("📌 handleSignIn called", { isReady, selectedAuth, email: email ? "***" : "empty", wagmiConnected });

    if (!isReady) {
      console.log("⚠️ Not ready yet, returning");
      return;
    }

    setCaughtError(null);
    try {
      if (selectedAuth === "email") {
        console.log("📧 Email auth path");
        // Email auth: pass email to login
        if (!email.trim()) {
          console.log("⚠️ Email is empty");
          setCaughtError("Please enter your email");
          return;
        }
        console.log("🚀 Calling login() with email");
        await login(email.trim());
        console.log("✨ Login completed");
      } else if (selectedAuth === "wallet" && wagmiConnected) {
        console.log("💰 Wallet auth path");
        // Wallet auth: wagmi handles connection, just call login
        await login();
      } else {
        console.log("⚠️ No valid auth path: selectedAuth=" + selectedAuth + ", wagmiConnected=" + wagmiConnected);
      }
    } catch (err) {
      const message = authErrMessage(err) ?? "Failed to sign in";
      console.error("🔴 Login error:", err);
      setCaughtError(message);
    }
  };

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

        {/* Auth method tabs (browser only, not in MiniPay) */}
        {showAuthTabs && (
          <div className="login-tabs">
            <button
              className={`login-tab ${selectedAuth === "email" ? "login-tab--active" : ""}`}
              onClick={() => setSelectedAuth("email")}
              disabled={busy}
            >
              Email
            </button>
            <button
              className={`login-tab ${selectedAuth === "wallet" ? "login-tab--active" : ""}`}
              onClick={() => setSelectedAuth("wallet")}
              disabled={busy}
            >
              Wallet
            </button>
          </div>
        )}

        {/* Sign-in action */}
        <div className="login-options">
          {selectedAuth === "email" && (
            <>
              <div className="login-email-form">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && email.trim() && handleSignIn()}
                  disabled={busy}
                  className="login-email-form__input"
                  autoComplete="email"
                  required
                />
              </div>
              <button
                className="login-option login-option--wallet"
                onClick={handleSignIn}
                disabled={busy || !email.trim()}
                aria-busy={busy}
              >
                <span className="login-option__icon">
                  {busy ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    <BoltIcon size={26} />
                  )}
                </span>
                <div className="login-option__text">
                  <h2 className="login-option__title">
                    {loading ? "Signing in…" : !isReady ? "Getting ready…" : "Continue with Email"}
                  </h2>
                  <p className="login-option__description">
                    We'll send you a magic link to sign in instantly
                  </p>
                </div>
                <span className="login-option__arrow">→</span>
              </button>
            </>
          )}

          {selectedAuth === "wallet" && (
            <button
              className="login-option login-option--wallet"
              onClick={() => setShowWalletSelector(true)}
              disabled={busy}
              aria-busy={busy}
            >
              <span className="login-option__icon">
                {busy ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <BoltIcon size={26} />
                )}
              </span>
              <div className="login-option__text">
                <h2 className="login-option__title">
                  {busy ? "Signing in…" : !wagmiConnected ? "Connect Wallet" : "Continue"}
                </h2>
                <p className="login-option__description">
                  Connect your Web3 wallet to play
                </p>
              </div>
              <span className="login-option__arrow">→</span>
            </button>
          )}
        </div>

        {/* Wallet Selector Modal */}
        {showWalletSelector && (
          <WalletSelector onClose={() => setShowWalletSelector(false)} />
        )}

        {/* Error State */}
        {error && (
          <div className="login-error" role="alert">
            <p className="login-error__title">Authentication failed</p>
            <p className="login-error__message">{error}</p>
            <button
              className="login-error__dismiss"
              onClick={() => setCaughtError(null)}
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
