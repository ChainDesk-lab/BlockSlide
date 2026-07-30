import { useEffect, useState, useCallback, useRef } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { useAuth } from "../auth/AuthContext";
import { TARGET_CHAIN } from "../lib/constants";

export interface NetworkGuardState {
  isWrongNetwork: boolean;
  switchPending: boolean;
  switchError: string | null;
  retrySwitch: () => void;
}

/**
 * Auto-switches connected wallets to Celo mainnet if they're on a different chain.
 *
 * Flow:
 * 1. User connects external wallet (MetaMask, etc) on wrong chain
 * 2. Hook detects chainId !== 42220, triggers switchChain immediately
 * 3. User sees wallet approval prompt (no manual steps)
 * 4. If wallet doesn't recognize Celo (error 4902), adds Celo network first
 * 5. If user rejects, shows blocking banner "Please switch networks to continue"
 * 6. If user accepts, connection proceeds normally
 * 7. If user switches away during session, guard re-triggers
 *
 * Skips for embedded wallets (Magic.link email login) since they're always on Celo.
 */
export function useNetworkGuard(): NetworkGuardState {
  const { authType } = useAuth();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchPending, error: switchError } = useSwitchChain();

  const [isWrongNetwork, setIsWrongNetwork] = useState(false);
  const [switchPending, setSwitchPending] = useState(false);
  const [displayError, setDisplayError] = useState<string | null>(null);

  // Track if we've already attempted a switch to avoid loops
  const switchAttemptedRef = useRef(false);
  const addNetworkAttemptedRef = useRef(false);

  // Skip guard for embedded wallets (Magic.link)
  const isEmbeddedWallet = authType === "magic";

  // Check if user is on wrong network
  const isOnWrongChain = !isEmbeddedWallet && isConnected && chainId !== TARGET_CHAIN.id;

  // Handle adding Celo network to wallet (wallet_addEthereumChain RPC call)
  const addCeloNetwork = useCallback(async () => {
    if (addNetworkAttemptedRef.current) return;
    addNetworkAttemptedRef.current = true;

    try {
      console.log("[NetworkGuard] Requesting to add Celo network to wallet...");

      // Use ethereum provider from window (works with MetaMask and most wallets)
      const provider = (window as any).ethereum;
      if (!provider) {
        setDisplayError("Wallet provider not available");
        return;
      }

      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${TARGET_CHAIN.id.toString(16)}`, // 0xaec4 for Celo
            chainName: "Celo Mainnet",
            nativeCurrency: {
              name: "CELO",
              symbol: "CELO",
              decimals: 18,
            },
            rpcUrls: ["https://forno.celo.org"],
            blockExplorerUrls: ["https://celoscan.io"],
          },
        ],
      });

      console.log("[NetworkGuard] Celo network added. Retrying switch...");
      // Reset attempt flag to allow retry
      switchAttemptedRef.current = false;
      addNetworkAttemptedRef.current = false;
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("[NetworkGuard] Failed to add Celo network:", msg);

      // User rejected the add network prompt
      if (err.code === 4001 || msg.toLowerCase().includes("user rejected")) {
        setDisplayError("Please add Celo network to your wallet to continue");
      } else {
        setDisplayError("Could not add Celo network. Please try again.");
      }
    }
  }, []);

  // Attempt to switch to Celo mainnet
  const attemptSwitch = useCallback(async () => {
    if (switchAttemptedRef.current || !isOnWrongChain) {
      return;
    }

    switchAttemptedRef.current = true;
    setSwitchPending(true);
    setDisplayError(null);

    try {
      console.log(`[NetworkGuard] Switching from chain ${chainId} to Celo (${TARGET_CHAIN.id})...`);

      switchChain({ chainId: TARGET_CHAIN.id }, {
        onSuccess: () => {
          console.log("[NetworkGuard] Successfully switched to Celo");
          setSwitchPending(false);
          switchAttemptedRef.current = false;
          setIsWrongNetwork(false);
          setDisplayError(null);
        },
        onError: (err: any) => {
          setSwitchPending(false);
          const errCode = err?.code;
          const errMsg = err?.message || String(err);

          console.error(`[NetworkGuard] Switch failed (code: ${errCode}):`, errMsg);

          // Unrecognized chain (wallet doesn't have Celo)
          if (errCode === 4902 || errMsg.includes("Unrecognized chain")) {
            console.log("[NetworkGuard] Celo network not in wallet. Requesting add...");
            addCeloNetwork();
          } else if (errCode === 4001 || errMsg.toLowerCase().includes("user rejected")) {
            // User rejected the switch prompt
            console.log("[NetworkGuard] User rejected network switch");
            setDisplayError("Please switch to Celo network to use BlockSlide");
            setIsWrongNetwork(true);
          } else {
            // Other errors
            setDisplayError(`Network switch failed: ${errMsg.slice(0, 80)}`);
            setIsWrongNetwork(true);
          }
        },
      });
    } catch (err) {
      console.error("[NetworkGuard] Unexpected error during switch:", err);
      setSwitchPending(false);
    }
  }, [chainId, isOnWrongChain, switchChain, addCeloNetwork]);

  // Retry switch (called by banner button)
  const retrySwitch = useCallback(() => {
    console.log("[NetworkGuard] User tapped retry");
    switchAttemptedRef.current = false;
    addNetworkAttemptedRef.current = false;
    setDisplayError(null);
    attemptSwitch();
  }, [attemptSwitch]);

  // Trigger switch when wallet connects on wrong chain
  useEffect(() => {
    if (!isEmbeddedWallet && isConnected && isOnWrongChain && !switchAttemptedRef.current) {
      console.log(
        `[NetworkGuard] Wallet connected on wrong chain (${chainId}). Auto-switching to Celo (${TARGET_CHAIN.id})...`
      );
      attemptSwitch();
    }
  }, [isConnected, chainId, isOnWrongChain, isEmbeddedWallet, attemptSwitch]);

  // Reset wrong-network state if connection closes or embedded wallet is used
  useEffect(() => {
    if (isEmbeddedWallet || !isConnected) {
      setIsWrongNetwork(false);
      setDisplayError(null);
      switchAttemptedRef.current = false;
      addNetworkAttemptedRef.current = false;
    }
  }, [isConnected, isEmbeddedWallet]);

  // Update wrong-network state based on current chain
  useEffect(() => {
    if (isConnected && !isEmbeddedWallet) {
      setIsWrongNetwork(chainId !== TARGET_CHAIN.id);
    }
  }, [chainId, isConnected, isEmbeddedWallet]);

  return {
    isWrongNetwork,
    switchPending: switchPending || isSwitchPending,
    switchError: displayError || (switchError ? switchError.message : null),
    retrySwitch,
  };
}
