import { useNetworkGuard } from "../hooks/useNetworkGuard";

/**
 * Fallback for when the automatic Celo switch doesn't complete — almost always
 * because the user dismissed the wallet prompt. The guard prompts on its own
 * first, so this only appears after an attempt has settled and left the wallet
 * on the wrong chain.
 */
export function NetworkGuardBanner() {
  const { isWrongNetwork, switchPending, switchError, hasAttempted, retrySwitch } =
    useNetworkGuard();

  // While the wallet prompt is open, let the wallet UI speak for itself.
  // `hasAttempted` keeps the banner from flashing before the first prompt.
  if (!isWrongNetwork || switchPending || !hasAttempted) {
    return null;
  }

  return (
    <div className="network-guard-banner">
      <div className="network-guard-banner__content">
        <div className="network-guard-banner__icon">⚠️</div>
        <div className="network-guard-banner__text">
          <h3 className="network-guard-banner__title">Wrong Network</h3>
          <p className="network-guard-banner__message">
            {switchError ?? "Switch to Celo in your wallet to keep playing."}
          </p>
        </div>
        <button
          className="network-guard-banner__button"
          onClick={retrySwitch}
          disabled={switchPending}
          type="button"
        >
          {switchPending ? "Switching..." : "Switch to Celo"}
        </button>
      </div>
    </div>
  );
}
