"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { numberToHex } from "viem";
import { useAuth } from "../auth/AuthContext";
import { useWalletChainId } from "./useWalletChainId";
import { TARGET_CHAIN } from "../lib/constants";

export interface NetworkGuardState {
  /** Connected external wallet is on a chain other than Celo. */
  isWrongNetwork: boolean;
  /** A switch/add prompt is currently open in the wallet. */
  switchPending: boolean;
  /** Human-readable reason the last attempt failed, or null. */
  switchError: string | null;
  /** True once an attempt has settled — used to avoid flashing the banner. */
  hasAttempted: boolean;
  retrySwitch: () => void;
}

/**
 * EIP-3085 payload used to register Celo with wallets that don't know it.
 * Values come from the viem chain definition so they can't drift from the
 * chain the app actually talks to.
 */
const CELO_ADD_CHAIN_PARAMS = {
  chainId: numberToHex(TARGET_CHAIN.id), // 42220 -> 0xa4ec
  chainName: TARGET_CHAIN.name,
  nativeCurrency: TARGET_CHAIN.nativeCurrency, // CELO / CELO / 18
  rpcUrls: [TARGET_CHAIN.rpcUrls.default.http[0]], // https://forno.celo.org
  blockExplorerUrls: [
    TARGET_CHAIN.blockExplorers?.default.url ?? "https://celoscan.io",
  ],
};

/** EIP-1193 "user rejected request". */
function isUserRejection(err: any): boolean {
  const code = err?.code ?? err?.cause?.code;
  if (code === 4001) return true;
  if (err?.name === "UserRejectedRequestError") return true;
  const msg = String(err?.message ?? err).toLowerCase();
  return msg.includes("user rejected") || msg.includes("user denied");
}

/** EIP-3326 "unrecognized chain" — wallet has no Celo entry yet. */
function isUnrecognizedChain(err: any): boolean {
  const code = err?.code ?? err?.cause?.code;
  // MetaMask Mobile nests the original error.
  const nested = err?.data?.originalError?.code ?? err?.cause?.data?.originalError?.code;
  if (code === 4902 || nested === 4902) return true;
  const msg = String(err?.message ?? err).toLowerCase();
  return msg.includes("unrecognized chain") || msg.includes("chain is not added");
}

const NetworkGuardContext = createContext<NetworkGuardState | null>(null);

/** Inert state for trees rendered outside the provider (e.g. SSR). */
const INERT: NetworkGuardState = {
  isWrongNetwork: false,
  switchPending: false,
  switchError: null,
  hasAttempted: false,
  retrySwitch: () => {},
};

/**
 * Keeps external wallets on Celo mainnet.
 *
 * On connect (and any time the wallet moves to another chain) this fires a
 * `wallet_switchEthereumChain` request. If the wallet has never heard of Celo
 * it falls back to `wallet_addEthereumChain` and then switches again, so the
 * user only ever sees wallet prompts — never a "go add this network yourself"
 * instruction. Rejecting a prompt is not an error state: it drops through to
 * the NetworkGuardBanner, which offers a retry.
 *
 * Magic.link email wallets are provisioned on Celo directly and are not wagmi
 * connections at all, so they're skipped on both counts.
 *
 * Mounted once by UnifiedAuthBridge. Consumers read the shared result via
 * useNetworkGuard(); running one instance per consumer would fire a duplicate
 * wallet prompt for every component that asked.
 */
export function NetworkGuardProvider({ children }: { children: ReactNode }) {
  const { authType } = useAuth();
  const { isConnected, connector } = useAccount();
  const walletChainId = useWalletChainId();
  const { switchChainAsync } = useSwitchChain();

  const [switchError, setSwitchError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);

  // Magic.link email wallets never need this. They aren't wagmi connections,
  // so `isConnected` already excludes them; the authType check keeps the
  // intent explicit if that ever changes.
  const isEmbeddedWallet = authType === "magic";

  const isWrongNetwork =
    !isEmbeddedWallet &&
    isConnected &&
    walletChainId !== undefined &&
    walletChainId !== TARGET_CHAIN.id;

  const switchToCelo = useCallback(async () => {
    setInFlight(true);
    setSwitchError(null);

    try {
      console.log(
        `[NetworkGuard] Requesting switch from chain ${walletChainId} to Celo (${TARGET_CHAIN.id})...`
      );
      // wagmi's injected connector already handles 4902 internally by calling
      // wallet_addEthereumChain with these params and re-switching, so most
      // wallets are fully served by this one call.
      await switchChainAsync({
        chainId: TARGET_CHAIN.id,
        addEthereumChainParameter: CELO_ADD_CHAIN_PARAMS,
      });
      console.log("[NetworkGuard] Now on Celo");
      setSwitchError(null);
      return;
    } catch (err: any) {
      if (isUserRejection(err)) {
        console.log("[NetworkGuard] User declined the switch");
        setSwitchError("Switch to Celo in your wallet to keep playing.");
        return;
      }

      if (!isUnrecognizedChain(err)) {
        const msg = String(err?.shortMessage ?? err?.message ?? err).slice(0, 120);
        console.error("[NetworkGuard] Switch failed:", msg);
        setSwitchError(`Couldn't switch to Celo: ${msg}`);
        return;
      }

      // Connector surfaced a raw 4902 instead of handling it (some
      // WalletConnect wallets, older injected providers). Add Celo ourselves,
      // then switch again. Uses the connector's own provider so this works for
      // WalletConnect, not just window.ethereum.
      console.log("[NetworkGuard] Wallet doesn't know Celo — adding it...");
      try {
        const provider: any = await connector?.getProvider();
        if (!provider?.request) {
          setSwitchError("Couldn't reach your wallet to add the Celo network.");
          return;
        }

        await provider.request({
          method: "wallet_addEthereumChain",
          params: [CELO_ADD_CHAIN_PARAMS],
        });
        console.log("[NetworkGuard] Celo added — switching...");

        await switchChainAsync({
          chainId: TARGET_CHAIN.id,
          addEthereumChainParameter: CELO_ADD_CHAIN_PARAMS,
        });
        console.log("[NetworkGuard] Now on Celo");
        setSwitchError(null);
      } catch (addErr: any) {
        if (isUserRejection(addErr)) {
          console.log("[NetworkGuard] User declined adding Celo");
          setSwitchError("Add the Celo network in your wallet to keep playing.");
        } else {
          const msg = String(addErr?.shortMessage ?? addErr?.message ?? addErr).slice(0, 120);
          console.error("[NetworkGuard] Add network failed:", msg);
          setSwitchError(`Couldn't add the Celo network: ${msg}`);
        }
      }
    } finally {
      setInFlight(false);
      setHasAttempted(true);
    }
  }, [connector, switchChainAsync, walletChainId]);

  // Auto-prompt once per (account, chain) pair. Keying on the pair means a
  // rejection doesn't spin into a prompt loop, while a wallet that later moves
  // to some other wrong chain still gets prompted again.
  const attemptKey = isWrongNetwork ? `${connector?.uid ?? "?"}:${walletChainId}` : null;
  const attemptedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!attemptKey) {
      attemptedForRef.current = null;
      return;
    }
    if (attemptedForRef.current === attemptKey) return;
    attemptedForRef.current = attemptKey;
    void switchToCelo();
  }, [attemptKey, switchToCelo]);

  // Clear stale failure text once the wallet is back on Celo or disconnects.
  useEffect(() => {
    if (!isWrongNetwork) {
      setSwitchError(null);
      setHasAttempted(false);
    }
  }, [isWrongNetwork]);

  const retrySwitch = useCallback(() => {
    console.log("[NetworkGuard] Retry requested");
    void switchToCelo();
  }, [switchToCelo]);

  const value = useMemo<NetworkGuardState>(
    () => ({
      isWrongNetwork,
      switchPending: inFlight,
      switchError,
      hasAttempted,
      retrySwitch,
    }),
    [isWrongNetwork, inFlight, switchError, hasAttempted, retrySwitch]
  );

  return (
    <NetworkGuardContext.Provider value={value}>{children}</NetworkGuardContext.Provider>
  );
}

export function useNetworkGuard(): NetworkGuardState {
  return useContext(NetworkGuardContext) ?? INERT;
}
