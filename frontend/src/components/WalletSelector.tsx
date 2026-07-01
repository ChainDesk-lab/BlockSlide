import { useState } from "react";
import { useConnect, useConnectors, useAccount } from "wagmi";

interface WalletSelectorProps {
  onClose: () => void;
}

export default function WalletSelector({ onClose }: WalletSelectorProps) {
  const { connect } = useConnect();
  const connectors = useConnectors();
  const { isConnecting } = useAccount();
  const [connectingTo, setConnectingTo] = useState<string | null>(null);

  const handleConnectWallet = (connectorName: string) => {
    const connector = connectors.find(
      (c) => c.name.toLowerCase().includes(connectorName.toLowerCase())
    );

    if (connector) {
      setConnectingTo(connectorName);
      connect(
        { connector },
        {
          onSuccess: () => {
            // Keep modal open briefly while connection completes
            setTimeout(() => {
              onClose();
            }, 500);
          },
          onError: (error) => {
            console.error("Connection error:", error);
            setConnectingTo(null);
          },
        }
      );
    }
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
        </div>
      </div>
    </div>
  );
}
