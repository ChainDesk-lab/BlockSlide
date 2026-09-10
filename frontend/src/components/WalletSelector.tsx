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

// Opens BlockSlide inside the MetaMask app's own in-app browser, where it
// injects window.ethereum like a desktop extension so the normal injected
// connector works with an in-page approval. Always-available mobile fallback.
const metamaskDappLink = () => {
  const path = `${window.location.host}${window.location.pathname}`;
  return `https://metamask.app.link/dapp/${path}`;
};

const MOBILE_MM_ID = "mm-sdk";
const MOBILE_OTHER_ID = "wc-other";
const MM_SDK_CONNECTOR_ID = "metaMaskSDK";
const WC_CONNECTOR_ID = "walletConnect";
const MM_CONNECT_TIMEOUT_MS = 120_000;
const WC_PAIRING_TIMEOUT_MS = 15_000;

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

  // --- mobile-only state (never affects the desktop path) ------------------
  const [mobileNoInjected, setMobileNoInjected] = useState(false);
  const [wcError, setWcError] = useState<string | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcUriCopied, setWcUriCopied] = useState(false);
  const [returnedStuck, setReturnedStuck] = useState(false);

  useEffect(() => {
    // WalletSelector only ever renders client-side (behind a click), so this is
    // safe; it just gates the alternate mobile layout.
    setMobileNoInjected(isMobileDevice() && !hasInjectedProvider());
  }, []);

  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wcPairStartedRef = useRef(false);
  const pairFailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leftForWalletRef = useRef(false);

  const mmSdkConnector = connectors.find((c) => c.id === MM_SDK_CONNECTOR_ID);
  const walletConnectConnector = connectors.find((c) => c.id === WC_CONNECTOR_ID);
  const walletConnectAvailable = !!walletConnectConnector;

  const clearPairFailTimer = () => {
    if (pairFailTimerRef.current) {
      clearTimeout(pairFailTimerRef.current);
      pairFailTimerRef.current = null;
    }
  };

  const beginWalletConnectPairing = useCallback(() => {
    if (!walletConnectConnector) return;
    setWcError(null);
    setWcUri(null);
    clearPairFailTimer();
    pairFailTimerRef.current = setTimeout(() => {
      console.warn("[WalletSelector] No WalletConnect pairing URI within timeout");
    }, WC_PAIRING_TIMEOUT_MS);

    connect(
      { connector: walletConnectConnector },
      {
        onSuccess: () => {
          clearPairFailTimer();
          setTimeout(() => onCloseRef.current(), 400);
        },
        onError: (error) => {
          clearPairFailTimer();
          console.warn(
            "[WalletSelector] WalletConnect pairing error:",
            error instanceof Error ? error.message : String(error)
          );
        },
      }
    );
  }, [walletConnectConnector, connect]);

  // Capture the pairing URI wagmi's WalletConnect connector emits (mobile only).
  useEffect(() => {
    if (!walletConnectConnector) return;
    const emitter = (walletConnectConnector as unknown as { emitter?: WcEmitter }).emitter;
    if (!emitter?.on) return;
    const onMessage = (payload: { type: string; data?: unknown }) => {
      if (payload?.type !== "display_uri" || typeof payload.data !== "string") return;
      clearPairFailTimer();
      setWcUri(payload.data);
      setWcUriCopied(false);
    };
    emitter.on("message", onMessage);
    return () => emitter.off("message", onMessage);
  }, [walletConnectConnector]);

  useEffect(() => {
    if (wcPairStartedRef.current) return;
    if (!mobileNoInjected || !walletConnectAvailable || isConnected) return;
    wcPairStartedRef.current = true;
    beginWalletConnectPairing();
  }, [mobileNoInjected, walletConnectAvailable, isConnected, beginWalletConnectPairing]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!leftForWalletRef.current || isConnectedRef.current) return;
      window.setTimeout(() => {
        if (!isConnectedRef.current && leftForWalletRef.current) {
          leftForWalletRef.current = false;
          setConnectingTo(null);
          setReturnedStuck(true);
        }
      }, 2500);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => () => clearPairFailTimer(), []);

  const openInMetaMaskBrowser = () => {
    window.location.href = metamaskDappLink();
  };

  const connectMetaMaskSdk = () => {
    if (!mmSdkConnector) {
      openInMetaMaskBrowser();
      return;
    }
    setWcError(null);
    setReturnedStuck(false);
    leftForWalletRef.current = true;
    setConnectingTo(MOBILE_MM_ID);

    const timeoutId = setTimeout(() => {
      setConnectingTo(null);
      setReturnedStuck(true);
    }, MM_CONNECT_TIMEOUT_MS);

    connect(
      { connector: mmSdkConnector },
      {
        onSuccess: () => {
          clearTimeout(timeoutId);
          setTimeout(() => onCloseRef.current(), 400);
        },
        onError: (error) => {
          clearTimeout(timeoutId);
          setConnectingTo(null);
          leftForWalletRef.current = false;
          const msg = error instanceof Error ? error.message : String(error);
          console.warn("[WalletSelector] MetaMask SDK connect error:", msg);
          if (!/reject|denied|cancell?ed|user rejected/i.test(msg)) {
            setWcError(
              "MetaMask didn't connect. Try again, or open BlockSlide in the MetaMask app browser below."
            );
            setReturnedStuck(true);
          }
        },
      }
    );
  };

  const onOtherWalletClick = () => {
    leftForWalletRef.current = true;
    setConnectingTo(MOBILE_OTHER_ID);
    setReturnedStuck(false);
  };

  const retryMobile = () => {
    setConnectingTo(null);
    setReturnedStuck(false);
    setWcError(null);
    leftForWalletRef.current = false;
    wcPairStartedRef.current = false;
    try {
      disconnect();
    } catch {
      /* noop */
    }
    setTimeout(() => {
      if (mobileNoInjected && walletConnectAvailable) {
        wcPairStartedRef.current = true;
        beginWalletConnectPairing();
      }
    }, 300);
  };

  // ======================================================================
  //  DESKTOP / injected / in-app-browser path — unchanged from before the
  //  mobile work. Do not alter.
  // ======================================================================
  const handleConnectWallet = async (connectorId: string, connectorName: string) => {
    // For injected wallets with the same ID, also match by name to get the right connector
    const connector = connectors.find((c) =>
      c.id === connectorId &&
      (c.id !== "injected" || c.name.toLowerCase() === connectorName.toLowerCase())
    );

    if (!connector) {
      console.error(`[WalletSelector] Connector not found: ${connectorId}`, {
        available: connectors.map((c) => ({ id: c.id, name: c.name })),
      });
      return;
    }

    if (
      (connectorId === "injected" || connectorName.toLowerCase().includes("metamask")) &&
      !hasInjectedProvider() &&
      isMobileDevice()
    ) {
      const dappUrl = `${window.location.host}${window.location.pathname}${window.location.search}`;
      window.location.href = `https://metamask.app.link/dapp/${dappUrl}`;
      return;
    }

    setConnectingTo(connectorId);

    const hasLiveConnection =
      connectedConnector?.id === connector.id && isConnected && address;

    if (hasLiveConnection) {
      console.log(
        `[WalletSelector] User is already connected to ${connectorName} with address ${address}`
      );
      setTimeout(() => {
        onClose();
      }, 300);
      return;
    }

    if (connectedConnector?.id === connector.id && !address) {
      console.warn(
        `[WalletSelector] Stale connection detected: connector=${connectorName} but no address. Force disconnecting...`
      );
      disconnect();
      await new Promise((resolve) => setTimeout(resolve, 300));
      console.log(`[WalletSelector] Stale state cleared, proceeding with connect for ${connectorName}`);
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
      console.log(
        `[WalletSelector] Disconnecting ${connectedConnector.name} before connecting ${connectorName}`
      );
      disconnect();

      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(
        `[WalletSelector] Disconnection complete, now connecting ${connectorName}`
      );
    }

    const timeoutId = setTimeout(() => {
      console.warn(`[WalletSelector] Connection to ${connectorName} timed out after 30s`);
      setConnectingTo(null);
    }, 30000);

    connect(
      { connector },
      {
        onSuccess: () => {
          clearTimeout(timeoutId);
          console.log(`[WalletSelector] Successfully connected to ${connectorName}`);
          setTimeout(() => {
            onClose();
          }, 500);
        },
        onError: (error) => {
          clearTimeout(timeoutId);
          console.error(`[WalletSelector] Connection error:`, error);
          setConnectingTo(null);

          const errorStr = error instanceof Error ? error.message : String(error);

          if (errorStr.includes("Connector already connected")) {
            console.warn(`[WalletSelector] Connector already connected, attempting force-disconnect...`);
            disconnect();
            setTimeout(() => {
              console.log(`[WalletSelector] Retrying connection after force-disconnect`);
              handleConnectWallet(connectorId, connectorName);
            }, 500);
            return;
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

    // The MetaMask SDK connector only exists on mobile and is handled by the
    // mobile layout below — never list it as a desktop row.
    if (connector.id === MM_SDK_CONNECTOR_ID) continue;

    // Process all injected/EIP-6963 connectors (id like "io.metamask", "com.rabby", or generic "injected")
    if (connector.id === "injected" || connector.id.includes(".")) {
      const normalizedName = connector.name.toLowerCase().trim();

      if (walletOptionsMap.has(normalizedName)) {
        console.log(`[WalletSelector] Skipping duplicate: ${connector.name}`);
        continue;
      }

      // Get icon from connector.icon (EIP-6963) or fallback map
      let iconUrl: string | null = connector.icon || null;

      // Try fallback map if no EIP-6963 icon
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

  // Build ordered list: MetaMask first, other wallets, then WalletConnect
  const walletOptions: WalletOption[] = [];

  // Find and add MetaMask first if present
  for (const [key, option] of walletOptionsMap) {
    if (key.includes("metamask")) {
      walletOptions.push(option);
      walletOptionsMap.delete(key);
      break;
    }
  }

  // Add other discovered wallets in order
  walletOptions.push(...walletOptionsMap.values());

  // Add WalletConnect last if configured
  if (walletConnectOption) {
    walletOptions.push(walletConnectOption);
  }

  // Only show "Injected" fallback if NO wallets were discovered
  const showFallbackInjected = walletOptions.length === 0;
  if (showFallbackInjected) {
    walletOptions.push({
      id: "injected",
      name: "Other Wallet",
      iconUrl: null,
      isWalletConnect: false,
    });
  }

  const handleIconError = (id: string) => {
    setFailedIcons((prev) => new Set(prev).add(id));
  };

  const shouldShowIcon = (option: WalletOption): boolean => {
    return option.iconUrl !== null && !failedIcons.has(option.id);
  };

  // ======================================================================
  //  MOBILE (phone browser, no injected provider) — the deep-link layout.
  //  Desktop never reaches this branch.
  // ======================================================================
  if (mobileNoInjected) {
    const showFallback = returnedStuck;
    const otherReady = !!wcUri;
    const mmBusy = connectingTo === MOBILE_MM_ID;
    const otherBusy = connectingTo === MOBILE_OTHER_ID;
    const anyBusy = connectingTo !== null;

    return (
      <div className="wallet-list-container">
        {wcError && (
          <div className="wallet-list-error" role="alert">
            {wcError}
          </div>
        )}

        <button
          className={`wallet-list-row ${mmBusy ? "wallet-list-row--connecting" : ""}`}
          onClick={connectMetaMaskSdk}
          disabled={anyBusy}
        >
          <div className="wallet-list-icon-box">
            <img src="/wallet-icons/metamask.svg" alt="MetaMask" className="wallet-list-icon" />
          </div>
          <span className="wallet-list-name">MetaMask</span>
          {mmBusy ? <span className="wallet-list-spinner" /> : <span className="wallet-list-chevron" />}
        </button>

        {walletConnectAvailable &&
          (otherReady ? (
            <a
              className={`wallet-list-row ${otherBusy ? "wallet-list-row--connecting" : ""}`}
              href={wcUri as string}
              onClick={onOtherWalletClick}
              rel="noopener noreferrer"
            >
              <div className="wallet-list-icon-box">
                <img src="/wallet-icons/walletconnect.svg" alt="Other wallet" className="wallet-list-icon" />
              </div>
              <span className="wallet-list-name">Other wallet</span>
              <span className="wallet-list-chevron" />
            </a>
          ) : (
            <button className="wallet-list-row" disabled>
              <div className="wallet-list-icon-box">
                <img src="/wallet-icons/walletconnect.svg" alt="Other wallet" className="wallet-list-icon" />
              </div>
              <span className="wallet-list-name">Other wallet</span>
              <span className="wallet-list-spinner" />
            </button>
          ))}

        {showFallback ? (
          <div className="wallet-list-cta-group">
            <a className="wallet-list-cta" href={metamaskDappLink()}>
              Open BlockSlide in the MetaMask app browser
            </a>
            <button type="button" className="wallet-list-fallback" onClick={retryMobile}>
              Try again
            </button>
          </div>
        ) : (
          <button type="button" className="wallet-list-fallback" onClick={openInMetaMaskBrowser}>
            Trouble connecting? Open BlockSlide in the MetaMask app browser →
          </button>
        )}

        {wcUri && showFallback && (
          <div className="wallet-list-wcuri">
            <p className="wallet-list-wcuri__label">Or paste this into your wallet’s WalletConnect:</p>
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
      </div>
    );
  }

  // ======================================================================
  //  DESKTOP render — verbatim original.
  // ======================================================================
  return (
    <div className="wallet-list-container">
      {walletOptions.map((option) => (
        <button
          key={option.id}
          className={`wallet-list-row ${connectingTo === option.id ? "wallet-list-row--connecting" : ""}`}
          onClick={() => handleConnectWallet(option.id, option.name)}
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
    </div>
  );
}
