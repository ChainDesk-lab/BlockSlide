import { useNetworkGuard } from "../hooks/useNetworkGuard";
import { FAILURE_COPY } from "../lib/celoOnboarding";
import Notice from "./Notice";

/**
 * Shown on any page when a connected browser wallet still isn't on Celo and needs the player:
 * a declined switch, a wallet that can't switch, one that moved off Celo again, and so on. The
 * guard prompts on its own first, so this only appears once an attempt has settled. On the
 * sign-in screen the setup view says the same thing, so this stays hidden there.
 */
export function NetworkGuardBanner() {
  const { status, failure, surfaceVisible, retrySwitch, disconnectWallet } = useNetworkGuard();

  if (status !== "needs-action" || !failure || surfaceVisible) {
    return null;
  }

  const copy = FAILURE_COPY[failure];
  return (
    <div className="network-guard-banner">
      <Notice
        tone="warning"
        title={copy.title}
        titleAs="h3"
        className="network-guard-banner__content"
        floating
        actions={
          <button
            className="network-guard-banner__button btn btn--sm btn--primary"
            onClick={copy.action === "reconnect" ? disconnectWallet : retrySwitch}
            type="button"
          >
            {copy.actionLabel}
          </button>
        }
      >
        <p className="network-guard-banner__message">{copy.message}</p>
      </Notice>
    </div>
  );
}
