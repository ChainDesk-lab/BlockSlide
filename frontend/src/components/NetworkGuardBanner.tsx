import { useNetworkGuard } from "../hooks/useNetworkGuard";
import Notice from "./Notice";

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
      <Notice
        tone="warning"
        title="Wrong Network"
        titleAs="h3"
        className="network-guard-banner__content"
        floating
        actions={
          <button
            className="network-guard-banner__button btn btn--sm btn--primary"
            onClick={retrySwitch}
            disabled={switchPending}
            type="button"
          >
            {switchPending ? "Switching..." : "Switch to Celo"}
          </button>
        }
      >
        <p className="network-guard-banner__message">
          {switchError ?? "Switch to Celo in your wallet to keep playing."}
        </p>
      </Notice>
    </div>
  );
}
