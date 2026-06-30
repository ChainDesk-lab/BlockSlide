import { createPublicClient, http } from "viem";
import { celo } from "wagmi/chains";
import { useAuth } from "../auth/AuthContext";
import { isMagicConfigured } from "../magic";
import { useAccount, usePublicClient } from "wagmi";
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
