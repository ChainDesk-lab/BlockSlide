import { useCallback, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useContractAddress, useContractPublicClient } from "./useContractData";
import { G_DOLLAR_ADDRESS } from "../lib/constants";

/**
 * Hook to fetch and refetch G$ (GoodDollar) ERC-20 balance.
 * Provides refetch function for manual cache invalidation after transactions.
 */
export function useGDollarBalance() {
  const address = useContractAddress();
  const publicClient = useContractPublicClient();
  const [balance, setBalance] = useState<string>("0");
  const [isLoading, setIsLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!address || !publicClient) return "0";

    setIsLoading(true);
    try {
      const result = await publicClient.readContract({
        address: G_DOLLAR_ADDRESS as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });

      const formatted = formatUnits(result as bigint, 18);
      setBalance(formatted);
      return formatted;
    } catch (err) {
      console.error("Error fetching G$ balance:", err);
      return "0";
    } finally {
      setIsLoading(false);
    }
  }, [address, publicClient]);

  return {
    balance,
    isLoading,
    refetch: fetchBalance,
  };
}
