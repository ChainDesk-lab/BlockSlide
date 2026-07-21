"use client";

import { useState } from "react";
import { useConnect, useConnectors, useAccount, useDisconnect } from "wagmi";

interface WalletSelectorProps {
  onClose: () => void;
}

// A phone in a plain browser tab (not MetaMask's own in-app browser) has no
// injected provider at all — window.ethereum simply doesn't exist there, so
// there's nothing for the "MetaMask" option to connect to unless we send the
// user into the MetaMask app itself first.
const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const hasInjectedProvider = () =>
  typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;

export default function WalletSelector({ onClose }: WalletSelectorProps) {
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const connectors = useConnectors();
  const { isConnecting, connector: connectedConnector, isConnected, address } = useAccount();
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnectWallet = async (connectorName: string) => {
    // Mobile + no injected provider + user picked MetaMask: there's nothing
    // for injected() to connect to here — the MetaMask app isn't open. Send
    // them to MetaMask's official deep link, which reopens this exact page
    // inside the MetaMask app's own browser. That in-app browser injects
    // window.ethereum just like a desktop extension does, so the user lands
    // on the same reliable injected() path once they return — not on
    // MetaMask's separate SDK/relay bridge, which is what caused the
    // original "wallet is still connecting" bug for desktop users.
    if (
      connectorName.toLowerCase() === "metamask" &&
      !hasInjectedProvider() &&
      isMobileDevice()
    ) {
      const dappUrl = `${window.location.host}${window.location.pathname}${window.location.search}`;
      window.location.href = `https://metamask.app.link/dapp/${dappUrl}`;
      return;
    }

    // Find connector with case-insensitive match
    const connector = connectors.find(
      (c) => c.name.toLowerCase().includes(connectorName.toLowerCase())
    );

    if (!connector) {
      console.error(`[WalletSelector] Connector not found: ${connectorName}`, {
        available: connectors.map((c) => c.name),
      });
      setError(`${connectorName} wallet not found`);
      return;
    }

    setConnectingTo(connectorName);
    setError(null);

    // Check if this connector has a LIVE connection (not just a stale connector object)
    // Must have both isConnected=true AND address present to be considered a real connection
    const hasLiveConnection =
      connectedConnector?.id === connector.id && isConnected && address;

    if (hasLiveConnection) {
      console.log(
        `[WalletSelector] User is already connected to ${connectorName} with address ${address}`
      );
      // Already genuinely connected to this wallet - close modal without reconnecting
      setTimeout(() => {
        onClose();
      }, 300);
      return;
    }

    // If connector exists but NO real address (stale state), force clean disconnect first
    if (connectedConnector?.id === connector.id && !address) {
      console.warn(
        `[WalletSelector] Stale connection detected: connector=${connectorName} but no address. Force disconnecting...`
      );
      disconnect();
      // Wait for stale state to clear
      await new Promise((resolve) => setTimeout(resolve, 300));
      console.log(`[WalletSelector] Stale state cleared, proceeding with connect for ${connectorName}`);
    }

    // Disconnect current connector if switching to a DIFFERENT one
    // wagmi requires disconnecting before connecting a different connector
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

      // Wait for disconnect to fully complete before attempting new connection
      // 500ms is safe for wagmi's internal state to update
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(
        `[WalletSelector] Disconnection complete, now connecting ${connectorName}`
      );
    }

    // Set a timeout to reset connecting state if connection hangs
    const timeoutId = setTimeout(() => {
      console.warn(`[WalletSelector] Connection to ${connectorName} timed out after 30s`);
      setConnectingTo(null);
      setError(`Connection to ${connectorName} timed out. Please try again.`);
    }, 30000);

    connect(
      { connector },
      {
        onSuccess: () => {
          clearTimeout(timeoutId);
          console.log(`[WalletSelector] Successfully connected to ${connectorName}`);
          // Keep modal open briefly while connection completes
          setTimeout(() => {
            onClose();
          }, 500);
        },
        onError: (error) => {
          clearTimeout(timeoutId);
          console.error(`[WalletSelector] Connection error:`, error);
          setConnectingTo(null);

          // Provide user-friendly error messages for common failure modes
          let errorMessage = "Failed to connect wallet";
          const errorStr = error instanceof Error ? error.message : String(error);

          // Handle "Connector already connected" - try force-disconnect and retry
          if (errorStr.includes("Connector already connected")) {
            console.warn(`[WalletSelector] Connector already connected, attempting force-disconnect...`);
            // Force disconnect to clear stale state
            disconnect();
            setTimeout(() => {
              // Retry the connection after disconnect
              console.log(`[WalletSelector] Retrying connection after force-disconnect`);
              handleConnectWallet(connectorName);
            }, 500);
            return;
          }

          if (
            errorStr.includes("relay") ||
            errorStr.includes("websocket") ||
            errorStr.toLowerCase().includes("connection")
          ) {
            errorMessage =
              "Network error connecting to WalletConnect relay. Check your internet connection or try MetaMask instead.";
          } else if (errorStr.includes("Provider not found")) {
            if (connectorName.toLowerCase().includes("metamask")) {
              errorMessage = "MetaMask is not installed. Install it from https://metamask.io";
            } else if (connectorName.toLowerCase().includes("walletconnect")) {
              errorMessage = "WalletConnect failed to connect. Check your internet and try again.";
            } else {
              errorMessage = "No Web3 wallet found. Install MetaMask or another Web3 wallet.";
            }
          } else if (errorStr.includes("not installed")) {
            errorMessage = `${connectorName} is not installed. Please install it first.`;
          } else if (errorStr.includes("User rejected")) {
            errorMessage = "Connection cancelled by user";
          } else if (errorStr) {
            errorMessage = errorStr;
          }

          setError(errorMessage);
        },
      }
    );
  };

  const handleClose = () => {
    // Only allow closing if not actively connecting
    if (!connectingTo) {
      onClose();
    }
  };

  const walletOptions = [
    {
      id: "metamask",
      name: "MetaMask",
      icon: "🦊",
      description: "Browser extension wallet",
    },
    {
      id: "walletconnect",
      name: "WalletConnect",
      icon: "📱",
      description: "Connect mobile wallet via QR code",
    },
    {
      id: "injected",
      name: "Other Wallet",
      icon: "💳",
      description: "Any injected Web3 wallet",
    },
  ];

  return (
    <div className="wallet-selector-modal">
      <div className="wallet-selector-overlay" onClick={handleClose} />
      <div className="wallet-selector-dialog">
        <div className="wallet-selector-header">
          <h2 className="wallet-selector-title">Connect Wallet</h2>
          <button
            className="wallet-selector-close"
            onClick={handleClose}
            disabled={!!connectingTo}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="wallet-selector-content">
          <p className="wallet-selector-description">
            Select a wallet to sign in to BlockSlide
          </p>

          {error && (
            <div className="wallet-selector-error">
              <span className="wallet-selector-error__icon">⚠️</span>
              <span className="wallet-selector-error__text">{error}</span>
              <div className="wallet-selector-error__actions">
                {error.includes("already") && (
                  <button
                    className="wallet-selector-error__reset"
                    onClick={() => {
                      console.log("[WalletSelector] User triggered manual disconnect");
                      disconnect();
                      setError(null);
                      setConnectingTo(null);
                    }}
                    aria-label="Reset connection"
                  >
                    Reset Connection
                  </button>
                )}
                <button
                  className="wallet-selector-error__close"
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <div className="wallet-selector-options">
            {walletOptions.map((option) => (
              <button
                key={option.id}
                className={`wallet-option ${
                  connectingTo === option.id ? "wallet-option--connecting" : ""
                }`}
                onClick={() => handleConnectWallet(option.id)}
                disabled={isConnecting || connectingTo !== null}
              >
                <span className="wallet-option__icon">{option.icon}</span>
                <div className="wallet-option__content">
                  <span className="wallet-option__name">{option.name}</span>
                  <span className="wallet-option__description">
                    {option.description}
                  </span>
                </div>
                {connectingTo === option.id && (
                  <span className="wallet-option__spinner">
                    <span className="spinner" />
                  </span>
                )}
                {connectingTo !== option.id && (
                  <span className="wallet-option__arrow">→</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="wallet-selector-footer">
          <p className="wallet-selector-help">
            Don't have a wallet?{" "}
            <a
              href="https://metamask.io"
              target="_blank"
              rel="noopener noreferrer"
              className="wallet-selector-link"
            >
              Get MetaMask
            </a>
          </p>
          <p className="wallet-selector-help wallet-selector-help--note">
            <strong>Having connection issues?</strong> If WalletConnect fails, try MetaMask instead. Some networks may block WebSocket connections.
          </p>
        </div>
      </div>
    </div>
  );
}
