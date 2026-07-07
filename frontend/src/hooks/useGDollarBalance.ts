import { useCallback, useEffect, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useContractAddress, useContractPublicClient } from "./useContractData";
import { G_DOLLAR_ADDRESS } from "../lib/constants";

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

  // Auto-fetch on mount and poll every 30s so balance stays current
  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 30_000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  return {
    balance,
    isLoading,
    refetch: fetchBalance,
  };
}
