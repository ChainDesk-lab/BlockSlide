import { createPublicClient, http } from "viem";
import { celo } from "wagmi/chains";
import { useAuth } from "../auth/AuthContext";
import { isMagicConfigured, getMagic } from "../magic";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useCallback, useMemo } from "react";

/**
 * Get the correct address for contract operations based on auth type.
 * For Magic.link, uses the Magic address. For Web3 wallets, uses wagmi address.
 */
export function useContractAddress() {
  const { address: wagmiAddress } = useAccount();
  const { address: magicAddress, authType } = useAuth();

  if (authType === "magic") {
    return magicAddress;
  }
  return wagmiAddress;
}

/**
 * Get the correct public client for contract reads based on auth type.
 * For Magic.link, uses Magic's RPC provider (memoized to prevent recreating on every render).
 * For Web3 wallets, uses wagmi's public client.
 */
export function useContractPublicClient() {
  const { authType } = useAuth();
  const wagmiClient = usePublicClient({ chainId: celo.id });

  // Memoize the Magic public client to prevent recreating it on every render
  // which would cause dependent callbacks to be recreated and trigger infinite loops
  const magicClient = useMemo(() => {
    if (authType === "magic" && isMagicConfigured) {
      return createPublicClient({
        chain: celo,
        transport: http("https://forno.celo.org"),
      });
    }
    return null;
  }, [authType]);

  return magicClient || wagmiClient;
}

/**
 * Get the correct wallet client for signing transactions based on auth type.
 * For Magic.link, returns a compatible object that works with viem's signTransaction.
 * For Web3 wallets, returns wagmi's wallet client.
 */
export function useContractWalletClient() {
  const { authType } = useAuth();
  const { data: wagmiWalletClient } = useWalletClient({ chainId: celo.id });

  if (authType === "magic") {
    // For Magic.link, return a proxy object that can handle signing requests
    // This object mimics a viem wallet client interface
    if (!isMagicConfigured) {
      console.warn("Magic.link not configured, wallet client unavailable");
      return wagmiWalletClient;
    }

    try {
      const magic = getMagic();
      const provider = magic.rpcProvider as any;

      // Return a proxy-like object that handles both signTransaction and request methods
      return {
        account: undefined,
        key: "magic",
        name: "Magic",
        mode: "publicClient",
        // Handle eth_signTransaction
        sign: async (data: any) => {
          return provider.request({
            method: "eth_signTransaction",
            params: [data],
          });
        },
        // Handle general RPC requests (eth_sendTransaction, etc.)
        request: (args: any) => provider.request(args),
        // Viem compatibility
        signTransaction: async (tx: any) => {
          return provider.request({
            method: "eth_signTransaction",
            params: [tx],
          });
        },
      } as any;
    } catch (err) {
      console.error("Failed to create Magic wallet client:", err);
      return wagmiWalletClient;
    }
  }

  return wagmiWalletClient;
}

/**
 * For Magic.link, sign a transaction using Magic's provider.
 * This is a helper for when signTransaction from viem doesn't work with Magic directly.
 */
export function useMagicSignTransaction() {
  const { authType } = useAuth();
  const address = useContractAddress();

  return useCallback(
    async (transaction: any) => {
      if (authType !== "magic") {
        throw new Error("useMagicSignTransaction only works with Magic.link");
      }

      if (!isMagicConfigured || !address) {
        throw new Error("Magic.link not configured or address not available");
      }

      try {
        const magic = getMagic();
        const provider = magic.rpcProvider as any;

        // Use eth_signTransaction to sign the transaction
        const signedTx = await provider.request({
          method: "eth_signTransaction",
          params: [transaction],
        });

        return signedTx;
      } catch (err) {
        console.error("Magic.link transaction signing failed:", err);
        throw err;
      }
    },
    [authType, address],
  );
}
