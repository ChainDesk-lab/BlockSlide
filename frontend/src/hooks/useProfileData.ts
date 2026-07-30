import { useQuery } from "@tanstack/react-query";
import { useReadContract } from "wagmi";
import { GAME2048_ADDRESS } from "../lib/constants";
import { GAME2048_ABI } from "../lib/abi";

interface PlayerProfile {
  id: string;
  username: string | null;
  xp: string;
  bestScore: string;
  gamesPlayed: number;
  isVerified: boolean;
  totalGEarned?: string; // Phase 2 optional
  totalGSpent?: string; // Phase 2 optional
}

interface ProfileData {
  player: PlayerProfile | null;
  streak: bigint | null;
  loading: boolean;
  error: string | null;
}

export function useProfileData(
  address: string | null,
  subgraphUrl: string
): ProfileData {
  // Fetch player from subgraph
  const { data: player, isLoading: playerLoading, error: playerError } = useQuery({
    queryKey: ["profile-player", address],
    enabled: !!address && !!subgraphUrl,
    queryFn: async () => {
      if (!address || !subgraphUrl) return null;

      // Query with Phase 2 fields; gracefully degrade if they don't exist yet
      const query = `{
        players(where: { id: "${address.toLowerCase()}" }, first: 1) {
          id
          username
          xp
          bestScore
          gamesPlayed
          isVerified
          totalGEarned
          totalGSpent
        }
      }`;

      const res = await fetch(subgraphUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) throw new Error("Subgraph fetch failed");

      const json = (await res.json()) as {
        data?: { players?: PlayerProfile[] };
        errors?: unknown;
      };

      // Don't throw on errors if we got partial data (graceful degradation)
      // The fields may be absent if the subgraph hasn't been updated yet
      if (json.errors && !json.data?.players?.length) {
        throw new Error("Subgraph returned errors");
      }

      return json.data?.players?.[0] ?? null;
    },
  });

  // Read streak from contract
  const { data: streak, isLoading: streakLoading, error: streakError } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "streakCount",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  });

  const loading = playerLoading || streakLoading;
  const error = playerError ? "Failed to load profile" : streakError ? "Failed to load streak" : null;

  return {
    player: player ?? null,
    streak: (streak as bigint) ?? null,
    loading,
    error: error as string | null,
  };
}
