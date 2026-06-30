import { useState } from "react";
import { useAuth, authErrMessage } from "../auth/AuthContext";
import { BoltIcon } from "./icons";

export default function LoginScreen() {
  const { isReady, loading, error: authError, login, authType } = useAuth();
  const [caughtError, setCaughtError] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  // Surface whichever error is present.
  const error = caughtError ?? authError;

  const isMiniPay = authType === "minipay";
  const isMagic = authType === "magic";
  // Busy while the SDK/connector is still booting OR a connect is in flight.
  const busy = loading || !isReady;

  const handleSignIn = async () => {
    if (!isReady) return;
    setCaughtError(null);
    try {
      if (isMagic) {
        // Magic: pass email to login
        if (!email.trim()) {
          setCaughtError("Please enter your email");
          return;
        }
        await login(email.trim());
      } else {
        // MiniPay: no email needed
        await login();
      }
    } catch (err) {
      const message = authErrMessage(err) ?? "Failed to sign in";
      console.error("Login error:", err);
      setCaughtError(message);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !busy && email.trim()) {
      handleSignIn();
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

        {/* Sign-in action */}
        <div className="login-options">
          {isMagic && (
            <div className="login-email-form">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={busy}
                className="login-email-form__input"
                autoComplete="email"
                required
              />
            </div>
          )}
          <button
            className="login-option login-option--wallet"
            onClick={handleSignIn}
            disabled={busy || (isMagic && !email.trim())}
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
                      : "Continue with Email"}
              </h2>
              <p className="login-option__description">
                {isMiniPay
                  ? "Connect your MiniPay wallet to play"
                  : "We'll send you a magic link to sign in instantly"}
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
