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
// connector works with an in-page approval (no round-trip). This is the
// reliable fallback whenever the WalletConnect deep link can't be used.
const metamaskDappLink = () => {
  const path = `${window.location.host}${window.location.pathname}`;
  return `https://metamask.app.link/dapp/${path}`;
};

// MetaMask universal link that carries a WalletConnect pairing request. Opening
// it launches MetaMask straight to its "Connect to BlockSlide?" sheet; after
// approval MetaMask returns the user to this tab. Must be opened from a real
// user gesture (a tapped link) — iOS ignores it from async JS navigation.
const metamaskWcLink = (uri: string) =>
  `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`;

// Synthetic option ids for the mobile rows, which have no injected connector
// behind them and instead pair over WalletConnect.
const MOBILE_MM_ID = "mm-walletconnect";
const MOBILE_OTHER_ID = "wc-other";

// How long to wait for the WalletConnect relay to hand us a pairing URI before
// treating the attempt as failed (bad project id, relay unreachable, offline).
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

type WcPhase = "idle" | "pairing" | "ready" | "failed";

export default function WalletSelector({ onClose }: WalletSelectorProps) {
  const { connect } = useConnect();
  const connectors = useConnectors();
  const { isConnecting, connector: connectedConnector, isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());
  const [wcError, setWcError] = useState<string | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcUriCopied, setWcUriCopied] = useState(false);
  const [wcPhase, setWcPhase] = useState<WcPhase>("idle");
  // Set when the user left for the wallet app and came back without connecting.
  const [returnedStuck, setReturnedStuck] = useState(false);

  // Resolved on the client only, so render logic can branch on device/provider
  // without a flash of the wrong list or a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [injectedPresent, setInjectedPresent] = useState(false);
  useEffect(() => {
    setIsMobile(isMobileDevice());
    setInjectedPresent(hasInjectedProvider());
    setMounted(true);
  }, []);

  const wcUriRef = useRef<string | null>(null);
  wcUriRef.current = wcUri;
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const autoStartedRef = useRef(false);
  const pairFailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leftForWalletRef = useRef(false);

  const walletConnectConnector = connectors.find((c) => c.id === "walletConnect");
  const walletConnectAvailable = !!walletConnectConnector;
  // A phone browser with no extension: connecting means pairing over
  // WalletConnect and deep-linking into the wallet app.
  const mobileNoInjected = isMobile && !injectedPresent;

  const clearPairFailTimer = () => {
    if (pairFailTimerRef.current) {
      clearTimeout(pairFailTimerRef.current);
      pairFailTimerRef.current = null;
    }
  };

  // Begin a WalletConnect pairing now so the wc: URI is ready before the user
  // taps a wallet — the deep link then fires from within their tap gesture,
  // which is the only way iOS will actually open the wallet app.
  const beginWalletConnectPairing = useCallback(() => {
    if (!walletConnectConnector) return;
    setWcPhase("pairing");
    setWcError(null);
    setWcUri(null);
    setReturnedStuck(false);
    clearPairFailTimer();

    pairFailTimerRef.current = setTimeout(() => {
      setWcPhase((p) => (p === "ready" ? p : "failed"));
      setWcError(
        "Couldn't reach WalletConnect. Use “Open in the MetaMask app browser” below, or try again."
      );
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
          const msg = error instanceof Error ? error.message : String(error);
          console.warn("[WalletSelector] WalletConnect pairing error:", msg);
          if (/reject|denied|cancell?ed|reset|closed modal|user closed/i.test(msg)) {
            // Benign — user backed out. Keep the URI usable if we got one.
            setWcPhase(wcUriRef.current ? "ready" : "idle");
          } else if (/already connected/i.test(msg)) {
            disconnect();
            setWcPhase("idle");
          } else {
            setWcPhase("failed");
            setWcError("Couldn't reach WalletConnect. Please try again.");
          }
        },
      }
    );
  }, [walletConnectConnector, connect, disconnect]);

  // Capture the pairing URI the wagmi WalletConnect connector emits.
  useEffect(() => {
    if (!walletConnectConnector) return;
    const emitter = (walletConnectConnector as unknown as { emitter?: WcEmitter }).emitter;
    if (!emitter?.on) return;

    const onMessage = (payload: { type: string; data?: unknown }) => {
      if (payload?.type !== "display_uri" || typeof payload.data !== "string") return;
      clearPairFailTimer();
      setWcUri(payload.data);
      setWcUriCopied(false);
      setWcPhase("ready");
    };

    emitter.on("message", onMessage);
    return () => emitter.off("message", onMessage);
  }, [walletConnectConnector]);

  // On a phone with no extension, start pairing as soon as the wallet list is
  // shown (the user has already chosen "Connect a wallet" to get here).
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!mobileNoInjected || !walletConnectAvailable || isConnected) return;
    autoStartedRef.current = true;
    beginWalletConnectPairing();
  }, [mobileNoInjected, walletConnectAvailable, isConnected, beginWalletConnectPairing]);

  // If the user leaves for the wallet app and comes back without a connection,
  // stop the row spinner and offer the fallback rather than spinning forever.
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

  // Only clear the timer on unmount — do NOT disconnect here. Tapping the deep
  // link can unmount this component while the pairing must stay alive for the
  // user to approve in their wallet and come back.
  useEffect(() => () => clearPairFailTimer(), []);

  const openInMetaMaskBrowser = () => {
    window.location.href = metamaskDappLink();
  };

  const onWalletDeepLinkClick = (id: string) => {
    // Runs inside the tap gesture; the <a href> does the actual navigation.
    leftForWalletRef.current = true;
    setConnectingTo(id);
    setReturnedStuck(false);
  };

  const retryPairing = () => {
    try {
      disconnect();
    } catch {
      /* noop */
    }
    setConnectingTo(null);
    leftForWalletRef.current = false;
    setTimeout(() => beginWalletConnectPairing(), 300);
  };

  // ---- Desktop / injected / in-app-browser path (unchanged) -----------------
  const handleConnectWallet = async (connectorId: string, connectorName: string) => {
    setWcError(null);

    const wantsWalletConnect =
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
        if (isMobileDevice()) openInMetaMaskBrowser();
        else console.error("[WalletSelector] WalletConnect connector unavailable and no injected provider");
        return;
      }
      targetId = "walletConnect";
      targetName = "WalletConnect";
    } else {
      connector = connectors.find(
        (c) =>
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

    setConnectingTo(connectorId);

    const hasLiveConnection = connectedConnector?.id === connector.id && isConnected && address;
    if (hasLiveConnection) {
      setTimeout(() => onClose(), 300);
      return;
    }

    if (connectedConnector?.id === connector.id && !address) {
      disconnect();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    if (connectedConnector && connectedConnector.id !== connector.id && isConnected && address) {
      disconnect();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const timeoutId = setTimeout(() => {
      console.warn(`[WalletSelector] Connection to ${targetName} timed out`);
      setConnectingTo(null);
    }, targetId === "walletConnect" ? 180_000 : 30_000);

    connect(
      { connector },
      {
        onSuccess: () => {
          clearTimeout(timeoutId);
          setTimeout(() => onClose(), 500);
        },
        onError: (error) => {
          clearTimeout(timeoutId);
          console.error(`[WalletSelector] Connection error:`, error);
          setConnectingTo(null);
          const errorStr = error instanceof Error ? error.message : String(error);
          if (errorStr.includes("Connector already connected")) {
            disconnect();
            setTimeout(() => handleConnectWallet(targetId, targetName), 500);
            return;
          }
          if (!/reject|denied|cancell?ed|user closed/i.test(errorStr)) {
            setWcError("Wallet connection failed. Please try again.");
          }
        },
      }
    );
  };

  // ---- Build the desktop / injected option list (unchanged) ----------------
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

    if (connector.id === "injected" || connector.id.includes(".")) {
      if (connector.id === "injected" && mobileNoInjected) continue;

      const normalizedName = connector.name.toLowerCase().trim();
      if (walletOptionsMap.has(normalizedName)) continue;

      let iconUrl: string | null = connector.icon || null;
      if (!iconUrl) {
        for (const [rdns, fallback] of Object.entries(WALLET_ICON_FALLBACKS)) {
          if (
            normalizedName.includes(rdns.split(".")[0]) ||
            connector.id.includes(rdns.split(".")[0]) ||
            connector.name.toLowerCase().includes(rdns)
          ) {
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

  const walletOptions: WalletOption[] = [];
  if (!mobileNoInjected) {
    for (const [key, option] of walletOptionsMap) {
      if (key.includes("metamask")) {
        walletOptions.push(option);
        walletOptionsMap.delete(key);
        break;
      }
    }
    walletOptions.push(...walletOptionsMap.values());
    if (walletConnectOption) walletOptions.push(walletConnectOption);
    if (walletOptions.length === 0) {
      walletOptions.push({ id: "injected", name: "Other Wallet", iconUrl: null, isWalletConnect: false });
    }
  }

  const handleIconError = (id: string) => setFailedIcons((prev) => new Set(prev).add(id));
  const shouldShowIcon = (option: WalletOption) =>
    option.iconUrl !== null && !failedIcons.has(option.id);

  // Avoid a one-frame flash of the desktop list before device detection runs.
  if (!mounted) return <div className="wallet-list-container" />;

  // ---- Mobile (no extension) view -----------------------------------------
  if (mobileNoInjected) {
    if (!walletConnectAvailable) {
      // WalletConnect not configured — the in-app browser is the only way in.
      return (
        <div className="wallet-list-container">
          <a className="wallet-list-row" href={metamaskDappLink()}>
            <div className="wallet-list-icon-box">
              <img src="/wallet-icons/metamask.svg" alt="MetaMask" className="wallet-list-icon" />
            </div>
            <span className="wallet-list-name">Open in MetaMask</span>
            <span className="wallet-list-chevron" />
          </a>
        </div>
      );
    }

    const uriReady = wcPhase === "ready" && !!wcUri;
    const showFallback = wcPhase === "failed" || returnedStuck;

    const renderWalletRow = (id: string, name: string, icon: string, href: string | null) => {
      const busy = connectingTo === id;
      const content = (
        <>
          <div className="wallet-list-icon-box">
            <img src={icon} alt={name} className="wallet-list-icon" />
          </div>
          <span className="wallet-list-name">{name}</span>
          {busy ? <span className="wallet-list-spinner" /> : <span className="wallet-list-chevron" />}
        </>
      );
      if (href) {
        return (
          <a
            key={id}
            className={`wallet-list-row ${busy ? "wallet-list-row--connecting" : ""}`}
            href={href}
            onClick={() => onWalletDeepLinkClick(id)}
            rel="noopener noreferrer"
          >
            {content}
          </a>
        );
      }
      return (
        <button key={id} className="wallet-list-row" disabled>
          {content}
        </button>
      );
    };

    return (
      <div className="wallet-list-container">
        {wcError && (
          <div className="wallet-list-error" role="alert">
            {wcError}
          </div>
        )}

        {renderWalletRow(
          MOBILE_MM_ID,
          "MetaMask",
          "/wallet-icons/metamask.svg",
          uriReady ? metamaskWcLink(wcUri as string) : null
        )}
        {renderWalletRow(
          MOBILE_OTHER_ID,
          "Other wallet",
          "/wallet-icons/walletconnect.svg",
          uriReady ? (wcUri as string) : null
        )}

        {!uriReady && !showFallback && (
          <p className="wallet-list-note">Preparing a secure connection…</p>
        )}

        {showFallback && (
          <div className="wallet-list-cta-group">
            <a className="wallet-list-cta" href={metamaskDappLink()}>
              Open BlockSlide in the MetaMask app browser
            </a>
            <button type="button" className="wallet-list-fallback" onClick={retryPairing}>
              Try WalletConnect again
            </button>
          </div>
        )}

        {uriReady && !showFallback && (
          <button type="button" className="wallet-list-fallback" onClick={openInMetaMaskBrowser}>
            Trouble connecting? Open BlockSlide in the MetaMask app browser →
          </button>
        )}

        {wcUri && (wcPhase === "failed" || returnedStuck) && (
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

  // ---- Desktop / injected / in-app-browser view (unchanged behaviour) -----
  return (
    <div className="wallet-list-container">
      {wcError && (
        <div className="wallet-list-error" role="alert">
          {wcError}
        </div>
      )}

      {wcUri && !isMobile && (
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
