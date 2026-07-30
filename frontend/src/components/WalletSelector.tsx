"use client";

import { useState } from "react";
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

// Map connector rdns to fallback icon paths in public/wallet-icons/
const WALLET_ICON_FALLBACKS: Record<string, string> = {
  "io.metamask": "/wallet-icons/metamask.svg",
  "com.rabby": "/wallet-icons/rabby.svg",
  "com.trustwallet": "/wallet-icons/trust.svg",
  "app.phantom": "/wallet-icons/phantom.svg",
  "com.brave": "/wallet-icons/brave.svg",
  "com.uniswap": "/wallet-icons/uniswap.svg",
};

export default function WalletSelector({ onClose }: WalletSelectorProps) {
  const { connect } = useConnect();
  const connectors = useConnectors();
  const { isConnecting, connector: connectedConnector, isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());

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
