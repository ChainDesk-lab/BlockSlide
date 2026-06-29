import { useState } from "react";
import { useAuth, authErrMessage } from "../auth/AuthContext";
import { BoltIcon } from "./icons";

export default function LoginScreen() {
  const { isReady, loading, error: authError, login, authType } = useAuth();
  const [caughtError, setCaughtError] = useState<string | null>(null);

  // Surface whichever error is present. A client-ID ↔ network mismatch (or an
  // un-whitelisted origin) typically lands on the SDK error, not the try/catch
  // around login() — without this it shows as a silent login loop.
  const error = caughtError ?? authError;

  const isMiniPay = authType === "minipay";
  // Busy while the SDK/connector is still booting OR a connect is in flight. We
  // keep the branded screen visible the whole time and reflect this on the
  // button, so the user never sees a bare "initializing" message.
  const busy = loading || !isReady;

  const handleSignIn = async () => {
    if (!isReady) return;
    setCaughtError(null);
    try {
      // Web3Auth: opens the modal (email passwordless + external wallets).
      // MiniPay: (re)triggers the injected connector — usually auto-connects.
      await login();
    } catch (err) {
      const message = authErrMessage(err) ?? "Failed to sign in";
      console.error("Login error:", err);
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

        {/* Single sign-in action. In a browser the Web3Auth modal handles the
            email vs. wallet choice; inside MiniPay this connects the injected
            wallet (and auto-connect usually means this screen flashes briefly). */}
        <div className="login-options">
          <button
            className="login-option login-option--wallet"
            onClick={handleSignIn}
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
                {isMiniPay
                  ? busy
                    ? "Connecting to MiniPay…"
                    : "Connect MiniPay"
                  : loading
                    ? "Signing in…"
                    : !isReady
                      ? "Getting ready…"
                      : "Sign In"}
              </h2>
              <p className="login-option__description">
                {isMiniPay
                  ? "Connect your MiniPay wallet to play"
                  : "Continue with email or connect a wallet"}
              </p>
            </div>
            <span className="login-option__arrow">→</span>
          </button>
        </div>

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
