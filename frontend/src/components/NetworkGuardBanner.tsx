import { useNetworkGuard } from "../hooks/useNetworkGuard";

/**
 * Displays blocking banner when user is on wrong network and has rejected auto-switch.
 * Shows clear action: "Switch to Celo" button to retry the switch prompt.
 */
export function NetworkGuardBanner() {
  const { isWrongNetwork, switchPending, switchError, retrySwitch } = useNetworkGuard();

  // Only show if user is on wrong network and switch was rejected (switchError present)
  if (!isWrongNetwork || !switchError) {
    return null;
  }

  return (
    <div className="network-guard-banner">
      <div className="network-guard-banner__content">
        <div className="network-guard-banner__icon">⚠️</div>
        <div className="network-guard-banner__text">
          <h3 className="network-guard-banner__title">Wrong Network</h3>
          <p className="network-guard-banner__message">{switchError}</p>
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
