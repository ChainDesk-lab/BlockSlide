import { useState } from "react";
import { useConnect, useConnectors, useAccount, useDisconnect } from "wagmi";

interface WalletSelectorProps {
  onClose: () => void;
}

export default function WalletSelector({ onClose }: WalletSelectorProps) {
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const connectors = useConnectors();
  const { isConnecting, connector: connectedConnector } = useAccount();
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnectWallet = (connectorName: string) => {
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

    // Disconnect current connector if switching to a different one
    if (connectedConnector && connectedConnector.id !== connector.id) {
      console.log(`[WalletSelector] Disconnecting ${connectedConnector.name} before connecting ${connectorName}`);
      disconnect();
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

          if (
            errorStr.includes("relay") ||
            errorStr.includes("websocket") ||
            errorStr.toLowerCase().includes("connection")
          ) {
            errorMessage =
              "Network error connecting to WalletConnect relay. Check your internet connection or try MetaMask instead.";
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
              <button
                className="wallet-selector-error__close"
                onClick={() => setError(null)}
                aria-label="Dismiss error"
              >
                ✕
              </button>
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
