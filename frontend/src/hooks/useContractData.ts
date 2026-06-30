import { createPublicClient, http } from "viem";
import { celo } from "wagmi/chains";
import { useAuth } from "../auth/AuthContext";
import { isMagicConfigured, getMagic } from "../magic";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useMemo } from "react";

/**
 * Get the correct address for contract operations based on auth type.
 * For Magic.link, uses the Magic address. For MiniPay, uses wagmi address.
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
 * For Magic.link, uses Magic's RPC provider.
 * For MiniPay, uses wagmi's public client.
 */
export function useContractPublicClient() {
  const { authType } = useAuth();
  const wagmiClient = usePublicClient({ chainId: celo.id });

  return useMemo(() => {
    if (authType === "magic" && isMagicConfigured) {
      // Use Magic's RPC provider directly
      return createPublicClient({
        chain: celo,
        transport: http("https://forno.celo.org"),
      });
    }
    return wagmiClient;
  }, [authType, wagmiClient]);
}

/**
 * Get the correct wallet client for signing transactions based on auth type.
 * For Magic.link, uses Magic's provider which can sign transactions.
 * For MiniPay, uses wagmi's wallet client.
 */
export function useContractWalletClient() {
  const { authType } = useAuth();
  const { data: wagmiWalletClient } = useWalletClient({ chainId: celo.id });

  return useMemo(() => {
    if (authType === "magic" && isMagicConfigured) {
      // Magic.link's provider can be used as a wallet client for signing
      // Create a wrapper that provides the Magic provider for transaction signing
      const magic = getMagic();
      const provider = magic.rpcProvider as any;

      return {
        request: (args: any) => provider.request(args),
        account: undefined, // Magic.link handles account internally
      } as any;
    }
    return wagmiWalletClient;
  }, [authType, wagmiWalletClient]);
}
