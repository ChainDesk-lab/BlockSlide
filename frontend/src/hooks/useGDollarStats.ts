import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { GAME2048_ADDRESS } from "../lib/constants";
import { TARGET_CHAIN } from "../lib/constants";

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
    return { totalEarned: null, totalSpent: null };
  }

  try {
    const address_lower = address.toLowerCase() as `0x${string}`;

    // Query RewardPaid events (indexed by player parameter)
    const rewardLogs = await publicClient.getLogs({
      address: GAME2048_ADDRESS as `0x${string}`,
      event: {
        type: "event",
        name: "RewardPaid",
        inputs: [
          { type: "address", indexed: true, name: "player" },
          { type: "uint32", indexed: false, name: "milestone" },
          { type: "uint256", indexed: false, name: "amount" },
        ],
      },
      args: { player: address_lower },
      fromBlock: "69294066", // Deployment block from memory
    });

    let totalEarned = 0n;
    for (const log of rewardLogs) {
      if (log.args && typeof log.args.amount === "bigint") {
        totalEarned += log.args.amount;
      }
    }

    // Query purchase events (indexed by player parameter)
    // ShieldPurchased
    const shieldLogs = await publicClient.getLogs({
      address: GAME2048_ADDRESS as `0x${string}`,
      event: {
        type: "event",
        name: "ShieldPurchased",
        inputs: [
          { type: "address", indexed: true, name: "player" },
          { type: "uint256", indexed: false, name: "count" },
          { type: "uint256", indexed: false, name: "pricePaid" },
        ],
      },
      args: { player: address_lower },
      fromBlock: "69294066",
    });

    // XpBoostPurchased
    const boostLogs = await publicClient.getLogs({
      address: GAME2048_ADDRESS as `0x${string}`,
      event: {
        type: "event",
        name: "XpBoostPurchased",
        inputs: [
          { type: "address", indexed: true, name: "player" },
          { type: "uint8", indexed: false, name: "multiplier" },
          { type: "uint64", indexed: false, name: "expiry" },
          { type: "uint256", indexed: false, name: "pricePaid" },
        ],
      },
      args: { player: address_lower },
      fromBlock: "69294066",
    });

    // UndoPurchased
    const undoLogs = await publicClient.getLogs({
      address: GAME2048_ADDRESS as `0x${string}`,
      event: {
        type: "event",
        name: "UndoPurchased",
        inputs: [
          { type: "address", indexed: true, name: "player" },
          { type: "uint256", indexed: false, name: "quantity" },
          { type: "uint256", indexed: false, name: "pricePaid" },
        ],
      },
      args: { player: address_lower },
      fromBlock: "69294066",
    });

    // CosmeticPurchased
    const cosmeticLogs = await publicClient.getLogs({
      address: GAME2048_ADDRESS as `0x${string}`,
      event: {
        type: "event",
        name: "CosmeticPurchased",
        inputs: [
          { type: "address", indexed: true, name: "player" },
          { type: "uint256", indexed: false, name: "itemId" },
          { type: "uint256", indexed: false, name: "pricePaid" },
        ],
      },
      args: { player: address_lower },
      fromBlock: "69294066",
    });

    let totalSpent = 0n;

    for (const log of shieldLogs) {
      if (log.args && typeof log.args.pricePaid === "bigint") {
        totalSpent += log.args.pricePaid;
      }
    }

    for (const log of boostLogs) {
      if (log.args && typeof log.args.pricePaid === "bigint") {
        totalSpent += log.args.pricePaid;
      }
    }

    for (const log of undoLogs) {
      if (log.args && typeof log.args.pricePaid === "bigint") {
        totalSpent += log.args.pricePaid;
      }
    }

    for (const log of cosmeticLogs) {
      if (log.args && typeof log.args.pricePaid === "bigint") {
        totalSpent += log.args.pricePaid;
      }
    }

    return {
      totalEarned: totalEarned.toString(), // Returns "0" if no events, or the sum
      totalSpent: totalSpent.toString(),   // Returns "0" if no events, or the sum
    };
  } catch (err) {
    console.error("[GDollarStats] Failed to fetch from events:", err);
    // Return "0" as default instead of null, so UI shows "0 G$" instead of "Coming soon"
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
