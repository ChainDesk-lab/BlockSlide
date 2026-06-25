import { useState } from "react";
import { useWeb3AuthConnect, useWeb3Auth } from "@web3auth/modal/react";
import { BoltIcon } from "./icons";

function errMessage(e: unknown): string | null {
  if (!e) return null;
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const o = e as { message?: string; code?: number };
    if (o.message) return o.code ? `${o.message} (code ${o.code})` : o.message;
  }
  return String(e);
}

export default function LoginScreen() {
  const { isInitialized, initError } = useWeb3Auth();
  const { connect, loading, error: connectError } = useWeb3AuthConnect();
  const [caughtError, setCaughtError] = useState<string | null>(null);

  // Surface whichever error is present. A client-ID ↔ network mismatch (or an
  // un-whitelisted origin) typically lands on initError/connectError, not the
  // try/catch around connect() — without this it shows as a silent login loop.
  const error =
    caughtError ?? errMessage(connectError) ?? errMessage(initError);

  const ready = isInitialized;
  // Busy while the SDK is still booting OR a connect is in flight. We keep the
  // branded screen visible the whole time and reflect this on the button, so the
  // user never sees a bare "initializing" message.
  const busy = loading || !ready;

  const handleSignIn = async () => {
    if (!ready) return;
    setCaughtError(null);
    try {
      // Opens the Web3Auth modal — email passwordless and external wallets
      // (MetaMask, MiniPay, WalletConnect) are both offered there.
      await connect();
    } catch (err) {
      const message = errMessage(err) ?? "Failed to sign in";
      console.error("Web3Auth login error:", err);
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

        {/* Single sign-in action. The Web3Auth modal handles the email vs.
            wallet choice, so one button covers both. */}
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
                {loading ? "Signing in…" : !ready ? "Getting ready…" : "Sign In"}
              </h2>
              <p className="login-option__description">
                Continue with email or connect a wallet
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
