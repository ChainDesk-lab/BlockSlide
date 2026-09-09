"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnect, useConnectors, useAccount, useDisconnect } from "wagmi";

interface WalletSelectorProps {
  onClose: () => void;
}

interface WalletOption {
  id: string;
  name: string;
  iconUrl: string | null;
  isWalletConnect: boolean;
}

const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const hasInjectedProvider = () =>
  typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;

// Opens BlockSlide inside the MetaMask app's own in-app browser (which injects
// window.ethereum like a desktop extension). This moves the session into
// MetaMask's browser rather than connecting and returning here, so it is only a
// labelled fallback / the last resort when WalletConnect can't be reached.
const metamaskDappLink = () => {
  const path = `${window.location.host}${window.location.pathname}`;
  return `https://metamask.app.link/dapp/${path}`;
};

// WalletConnect pairing deep links. The wallet opens straight to its
// "Connect to BlockSlide?" sheet and, after approval, returns the user to this
// tab. The MetaMask universal link is the reliable path on iOS; the raw wc:
// URI lets the OS hand any other installed wallet the same pairing request.
const walletConnectDeepLink = (uri: string, target: "metamask" | "other") => {
  const encoded = encodeURIComponent(uri);
  return target === "metamask"
    ? `https://metamask.app.link/wc?uri=${encoded}`
    : uri;
};

// Synthetic option id for the mobile "MetaMask" row, which has no injected
// connector behind it and instead routes through WalletConnect.
const MOBILE_WC_METAMASK_ID = "mm-walletconnect";

// How long to wait for WalletConnect to hand us a pairing URI before treating
// the attempt as failed (bad project id, domain not allow-listed, relay
// unreachable). Prevents an indefinite spinner.
const WC_URI_TIMEOUT_MS = 20_000;

// Map connector rdns to fallback icon paths in public/wallet-icons/
const WALLET_ICON_FALLBACKS: Record<string, string> = {
  "io.metamask": "/wallet-icons/metamask.svg",
  "com.rabby": "/wallet-icons/rabby.svg",
  "com.trustwallet": "/wallet-icons/trust.svg",
  "app.phantom": "/wallet-icons/phantom.svg",
  "com.brave": "/wallet-icons/brave.svg",
  "com.uniswap": "/wallet-icons/uniswap.svg",
};

type WcEmitter = {
  on: (event: "message", listener: (payload: { type: string; data?: unknown }) => void) => void;
  off: (event: "message", listener: (payload: { type: string; data?: unknown }) => void) => void;
};

export default function WalletSelector({ onClose }: WalletSelectorProps) {
  const { connect } = useConnect();
  const connectors = useConnectors();
  const { isConnecting, connector: connectedConnector, isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());
  const [wcError, setWcError] = useState<string | null>(null);
  // Desktop-with-no-extension fallback: show the pairing URI to paste/scan.
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcUriCopied, setWcUriCopied] = useState(false);

  // Resolved on the client only, so render logic can branch on device/provider
  // without a hydration mismatch.
  const [isMobile, setIsMobile] = useState(false);
  const [injectedPresent, setInjectedPresent] = useState(false);
  useEffect(() => {
    setIsMobile(isMobileDevice());
    setInjectedPresent(hasInjectedProvider());
  }, []);

  // Which wallet the in-flight WalletConnect attempt is for, so the
  // display_uri handler knows where to deep-link. null when no WC attempt.
  const pendingWcTargetRef = useRef<"metamask" | "other" | null>(null);
  const wcRedirectedRef = useRef(false);
  const wcUriTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;

  const clearWcAttempt = useCallback(() => {
    pendingWcTargetRef.current = null;
    wcRedirectedRef.current = false;
    if (wcUriTimerRef.current) {
      clearTimeout(wcUriTimerRef.current);
      wcUriTimerRef.current = null;
    }
  }, []);

  const walletConnectConnector = connectors.find((c) => c.id === "walletConnect");
  const walletConnectAvailable = !!walletConnectConnector;
  // A phone browser with no extension: every connect has to go through
  // WalletConnect's deep link into the wallet app.
  const mobileNoInjected = isMobile && !injectedPresent;

  // Listen for the pairing URI wagmi's WalletConnect connector emits, and on a
  // phone hand it straight to the wallet app. Without this the connect() call
  // just waits on WalletConnect's own modal, which does not reliably open in a
  // mobile browser.
  useEffect(() => {
    if (!walletConnectConnector) return;
    const emitter = (walletConnectConnector as unknown as { emitter: WcEmitter }).emitter;
    if (!emitter?.on) return;

    const onMessage = (payload: { type: string; data?: unknown }) => {
      if (payload?.type !== "display_uri" || typeof payload.data !== "string") return;
      const target = pendingWcTargetRef.current;
      if (!target || wcRedirectedRef.current) return;
      wcRedirectedRef.current = true;
      if (wcUriTimerRef.current) {
        clearTimeout(wcUriTimerRef.current);
        wcUriTimerRef.current = null;
      }
      if (isMobileDevice()) {
        window.location.href = walletConnectDeepLink(payload.data, target);
      } else {
        // Desktop with no extension: no wallet app to jump to. Surface the URI
        // so the user can paste it into a wallet's WalletConnect prompt.
        setWcUri(payload.data);
        setWcUriCopied(false);
      }
    };

    emitter.on("message", onMessage);
    return () => emitter.off("message", onMessage);
  }, [walletConnectConnector]);

  // If the user comes back from the wallet app without finishing, don't leave a
  // spinner running forever.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!pendingWcTargetRef.current || isConnectedRef.current) return;
      window.setTimeout(() => {
        if (pendingWcTargetRef.current && !isConnectedRef.current) {
          clearWcAttempt();
          setConnectingTo(null);
        }
      }, 2500);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clearWcAttempt]);

  useEffect(() => () => clearWcAttempt(), [clearWcAttempt]);

  const openInMetaMaskBrowser = () => {
    window.location.href = metamaskDappLink();
  };

  const handleConnectWallet = async (connectorId: string, connectorName: string) => {
    setWcError(null);
    setWcUri(null);

    // The mobile "MetaMask"/generic rows and any explicit WalletConnect choice
    // all resolve to the WalletConnect connector. So does a bare injected tap on
    // a phone with no extension — there is nothing else it could connect to.
    const wantsWalletConnect =
      connectorId === MOBILE_WC_METAMASK_ID ||
      connectorId === "walletConnect" ||
      ((connectorId === "injected" || connectorName.toLowerCase().includes("metamask")) &&
        !hasInjectedProvider() &&
        isMobileDevice());

    let connector;
    let targetId = connectorId;
    let targetName = connectorName;

    if (wantsWalletConnect) {
      connector = walletConnectConnector;
      if (!connector) {
        // WalletConnect isn't configured. On mobile the only remaining way in is
        // MetaMask's in-app browser; on desktop there's nothing to do.
        if (isMobileDevice()) {
          openInMetaMaskBrowser();
        } else {
          console.error("[WalletSelector] WalletConnect connector unavailable and no injected provider");
        }
        return;
      }
      targetId = "walletConnect";
      targetName = connectorName.toLowerCase().includes("metamask") ? "MetaMask" : "WalletConnect";
      pendingWcTargetRef.current = connectorName.toLowerCase().includes("metamask") ? "metamask" : "other";
      wcRedirectedRef.current = false;
    } else {
      // For injected wallets sharing the same id, also match by name.
      connector = connectors.find((c) =>
        c.id === connectorId &&
        (c.id !== "injected" || c.name.toLowerCase() === connectorName.toLowerCase())
      );
    }

    if (!connector) {
      console.error(`[WalletSelector] Connector not found: ${connectorId}`, {
        available: connectors.map((c) => ({ id: c.id, name: c.name })),
      });
      return;
    }

    // Key the row spinner off the tapped option id (a synthetic id like
    // "mm-walletconnect" still maps to the WalletConnect connector below).
    setConnectingTo(connectorId);

    const hasLiveConnection =
      connectedConnector?.id === connector.id && isConnected && address;

    if (hasLiveConnection) {
      console.log(
        `[WalletSelector] User is already connected to ${targetName} with address ${address}`
      );
      clearWcAttempt();
      setTimeout(() => {
        onClose();
      }, 300);
      return;
    }

    if (connectedConnector?.id === connector.id && !address) {
      console.warn(
        `[WalletSelector] Stale connection detected: connector=${targetName} but no address. Force disconnecting...`
      );
      disconnect();
      await new Promise((resolve) => setTimeout(resolve, 300));
      console.log(`[WalletSelector] Stale state cleared, proceeding with connect for ${targetName}`);
    }

    if (
      connectedConnector &&
      connectedConnector.id !== connector.id &&
      isConnected &&
      address
    ) {
      console.log(
        `[WalletSelector] Switching from ${connectedConnector.id} to ${connector.id}`
      );
      disconnect();
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(
        `[WalletSelector] Disconnection complete, now connecting ${targetName}`
      );
    }

    if (targetId === "walletConnect") {
      // If no pairing URI has arrived, WalletConnect can't be reached — surface
      // it instead of spinning forever.
      if (wcUriTimerRef.current) clearTimeout(wcUriTimerRef.current);
      wcUriTimerRef.current = setTimeout(() => {
        if (wcRedirectedRef.current || isConnectedRef.current) return;
        console.warn("[WalletSelector] No WalletConnect pairing URI within timeout");
        clearWcAttempt();
        setConnectingTo(null);
        setWcError(
          "Couldn't reach WalletConnect. Check your connection, then try again — or use the MetaMask app browser link below."
        );
      }, WC_URI_TIMEOUT_MS);
    }

    // Hard cap: injected connections resolve in-page fast; WalletConnect needs
    // room for the user to leave for their wallet app, approve, and come back.
    const connectTimeoutMs = targetId === "walletConnect" ? 180_000 : 30_000;
    const timeoutId = setTimeout(() => {
      console.warn(`[WalletSelector] Connection to ${targetName} timed out`);
      clearWcAttempt();
      setConnectingTo(null);
    }, connectTimeoutMs);

    connect(
      { connector },
      {
        onSuccess: () => {
          clearTimeout(timeoutId);
          clearWcAttempt();
          console.log(`[WalletSelector] Successfully connected to ${targetName}`);
          setTimeout(() => {
            onClose();
          }, 500);
        },
        onError: (error) => {
          clearTimeout(timeoutId);
          clearWcAttempt();
          console.error(`[WalletSelector] Connection error:`, error);
          setConnectingTo(null);

          const errorStr = error instanceof Error ? error.message : String(error);

          if (errorStr.includes("Connector already connected")) {
            console.warn(`[WalletSelector] Connector already connected, attempting force-disconnect...`);
            disconnect();
            setTimeout(() => {
              console.log(`[WalletSelector] Retrying connection after force-disconnect`);
              handleConnectWallet(targetId, targetName);
            }, 500);
            return;
          }

          // A user rejecting in their wallet is expected — don't shout about it.
          if (!/reject|denied|cancell?ed|user closed/i.test(errorStr)) {
            setWcError("Wallet connection failed. Please try again.");
          }
        },
      }
    );
  };

  // Build wallet options with real icons
  const walletOptionsMap = new Map<string, WalletOption>();
  let walletConnectOption: WalletOption | null = null;

  for (const connector of connectors) {
    if (connector.id === "walletConnect") {
      walletConnectOption = {
        id: connector.id,
        name: "WalletConnect",
        iconUrl: "/wallet-icons/walletconnect.svg",
        isWalletConnect: true,
      };
      continue;
    }

    // Process all injected/EIP-6963 connectors (id like "io.metamask", "com.rabby", or generic "injected")
    if (connector.id === "injected" || connector.id.includes(".")) {
      // A bare "injected" connector on a phone with no extension can't connect
      // to anything — skip it so it doesn't render as a dead "Injected" row.
      if (connector.id === "injected" && mobileNoInjected) continue;

      const normalizedName = connector.name.toLowerCase().trim();

      if (walletOptionsMap.has(normalizedName)) {
        console.log(`[WalletSelector] Skipping duplicate: ${connector.name}`);
        continue;
      }

      // Get icon from connector.icon (EIP-6963) or fallback map
      let iconUrl: string | null = connector.icon || null;

      if (!iconUrl) {
        for (const [rdns, fallback] of Object.entries(WALLET_ICON_FALLBACKS)) {
          if (normalizedName.includes(rdns.split(".")[0]) || connector.id.includes(rdns.split(".")[0]) || connector.name.toLowerCase().includes(rdns)) {
            iconUrl = fallback;
            break;
          }
        }
      }

      walletOptionsMap.set(normalizedName, {
        id: connector.id,
        name: connector.name,
        iconUrl,
        isWalletConnect: false,
      });
    }
  }

  // Build the ordered list shown to the user.
  const walletOptions: WalletOption[] = [];

  if (mobileNoInjected) {
    // No browser-extension wallet on this device. Offer familiar names that all
    // route through WalletConnect: it deep-links into the wallet app to approve
    // and returns the user straight back to this tab.
    if (walletConnectAvailable) {
      walletOptions.push({
        id: MOBILE_WC_METAMASK_ID,
        name: "MetaMask",
        iconUrl: "/wallet-icons/metamask.svg",
        isWalletConnect: true,
      });
      walletOptions.push({
        id: "walletConnect",
        name: "Other wallet",
        iconUrl: "/wallet-icons/walletconnect.svg",
        isWalletConnect: true,
      });
    } else {
      // WalletConnect not configured — the in-app browser is the only way in.
      walletOptions.push({
        id: "metamask-browser",
        name: "Open in MetaMask",
        iconUrl: "/wallet-icons/metamask.svg",
        isWalletConnect: false,
      });
    }
  } else {
    // Desktop, or a mobile in-app browser that injects a provider.
    for (const [key, option] of walletOptionsMap) {
      if (key.includes("metamask")) {
        walletOptions.push(option);
        walletOptionsMap.delete(key);
        break;
      }
    }
    walletOptions.push(...walletOptionsMap.values());
    if (walletConnectOption) walletOptions.push(walletConnectOption);

    // Only show the "Other Wallet" injected fallback if nothing was discovered.
    if (walletOptions.length === 0) {
      walletOptions.push({
        id: "injected",
        name: "Other Wallet",
        iconUrl: null,
        isWalletConnect: false,
      });
    }
  }

  const handleRowClick = (option: WalletOption) => {
    if (option.id === "metamask-browser") {
      openInMetaMaskBrowser();
      return;
    }
    handleConnectWallet(option.id, option.name);
  };

  const handleIconError = (id: string) => {
    setFailedIcons((prev) => new Set(prev).add(id));
  };

  const shouldShowIcon = (option: WalletOption): boolean => {
    return option.iconUrl !== null && !failedIcons.has(option.id);
  };

  // Escape hatch shown only when there's a real WalletConnect path above it and
  // the device would otherwise be stuck if that path fails. When WalletConnect
  // is unavailable the "Open in MetaMask" row above already is this fallback.
  const showBrowserFallbackLink = mobileNoInjected && walletConnectAvailable;

  return (
    <div className="wallet-list-container">
      {wcError && (
        <div className="wallet-list-error" role="alert">
          {wcError}
        </div>
      )}

      {wcUri && (
        <div className="wallet-list-wcuri">
          <p className="wallet-list-wcuri__label">
            Open your wallet, choose WalletConnect, and paste this:
          </p>
          <code className="wallet-list-wcuri__value">{wcUri}</code>
          <button
            type="button"
            className="wallet-list-wcuri__copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(wcUri);
                setWcUriCopied(true);
              } catch {
                setWcUriCopied(false);
              }
            }}
          >
            {wcUriCopied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      )}

      {walletOptions.map((option) => (
        <button
          key={option.id}
          className={`wallet-list-row ${connectingTo === option.id ? "wallet-list-row--connecting" : ""}`}
          onClick={() => handleRowClick(option)}
          disabled={isConnecting || connectingTo !== null}
        >
          <div className="wallet-list-icon-box">
            {shouldShowIcon(option) && option.iconUrl ? (
              <img
                src={option.iconUrl}
                alt={option.name}
                className="wallet-list-icon"
                onError={() => handleIconError(option.id)}
              />
            ) : (
              <div className="wallet-list-icon-fallback" />
            )}
          </div>
          <span className="wallet-list-name">{option.name}</span>
          {connectingTo === option.id ? (
            <span className="wallet-list-spinner" />
          ) : (
            <span className="wallet-list-chevron" />
          )}
        </button>
      ))}

      {showBrowserFallbackLink && (
        <button
          type="button"
          className="wallet-list-fallback"
          onClick={openInMetaMaskBrowser}
          disabled={connectingTo !== null}
        >
          Trouble connecting? Open BlockSlide in the MetaMask app browser →
        </button>
      )}
    </div>
  );
}
