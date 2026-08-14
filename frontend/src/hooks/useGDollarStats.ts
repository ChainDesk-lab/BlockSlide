import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { GAME2048_ADDRESS } from "../lib/constants";
import { TARGET_CHAIN } from "../lib/constants";
import { decodeEventLog } from "viem";
import { GAME2048_MERGED_ABI } from "../lib/abiMerged";

interface GDollarStats {
  totalEarned: string | null;
  totalSpent: string | null;
}

/**
 * Fetch G$ earned and spent from contract events
 * Queries RewardPaid, ShieldPurchased, XpBoostPurchased, UndoPurchased, CosmeticPurchased events
 */
async function fetchGDollarStatsFromEvents(
  address: string,
  publicClient: any
): Promise<GDollarStats> {
  if (!publicClient || !address) {
    return { totalEarned: "0", totalSpent: "0" };
  }

  try {
    const address_lower = address.toLowerCase();
    const deploymentBlock = 69294066n;

    // Query all logs from the contract since deployment
    const logs = await publicClient.getLogs({
      address: GAME2048_ADDRESS as `0x${string}`,
      fromBlock: deploymentBlock,
    });

    let totalEarned = 0n;
    let totalSpent = 0n;

    // Parse and sum events
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: GAME2048_MERGED_ABI,
          data: log.data,
          topics: log.topics,
        });

        const args = decoded.args as Record<string, any>;

        // Check if this event is for the target player (indexed parameter)
        const eventPlayer = args?.player;
        if (!eventPlayer || eventPlayer.toLowerCase() !== address_lower) {
          continue;
        }

        switch (decoded.eventName) {
          case "RewardPaid": {
            // RewardPaid(address indexed player, uint32 milestone, uint256 amount)
            const amount = args?.amount;
            if (amount && typeof amount === "bigint") {
              totalEarned += amount;
              console.log(`[GDollarStats] RewardPaid: +${amount.toString()}`);
            }
            break;
          }

          case "ShieldPurchased":
          case "XpBoostPurchased":
          case "UndoPurchased":
          case "CosmeticPurchased": {
            // All purchase events have pricePaid parameter
            const pricePaid = args?.pricePaid;
            if (pricePaid && typeof pricePaid === "bigint") {
              totalSpent += pricePaid;
              console.log(
                `[GDollarStats] ${decoded.eventName}: -${pricePaid.toString()}`
              );
            }
            break;
          }
        }
      } catch {
        // Skip logs that can't be decoded
        continue;
      }
    }

    console.log(`[GDollarStats] Final totals for ${address_lower}:`, {
      earned: totalEarned.toString(),
      spent: totalSpent.toString(),
    });

    return {
      totalEarned: totalEarned.toString(),
      totalSpent: totalSpent.toString(),
    };
  } catch (err) {
    console.error("[GDollarStats] Failed to fetch from events:", err);
    return { totalEarned: "0", totalSpent: "0" };
  }
}

/**
 * Fetch G$ earned and spent for a player from contract events
 * Used as a fallback when subgraph doesn't have the data
 */
export function useGDollarStats(
  address: string | null,
  _subgraphUrl: string, // kept for consistency, not used in current implementation
  subgraphData: { totalGEarned?: string; totalGSpent?: string } | null | undefined
): {
  totalEarned: string | null;
  totalSpent: string | null;
  loading: boolean;
} {
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN.id });

  // If subgraph already has the data, use it
  if (subgraphData?.totalGEarned && subgraphData?.totalGSpent) {
    return {
      totalEarned: subgraphData.totalGEarned,
      totalSpent: subgraphData.totalGSpent,
      loading: false,
    };
  }

  // Otherwise, fetch from contract events as fallback
  const { data, isLoading } = useQuery({
    queryKey: ["gdollar-stats-events", address],
    enabled: !!address && !!publicClient,
    staleTime: 60000, // 1 minute
    queryFn: async () => {
      if (!address || !publicClient) return { totalEarned: "0", totalSpent: "0" };
      return fetchGDollarStatsFromEvents(address, publicClient);
    },
  });

  return {
    totalEarned: data?.totalEarned ?? "0",
    totalSpent: data?.totalSpent ?? "0",
    loading: isLoading,
  };
}
