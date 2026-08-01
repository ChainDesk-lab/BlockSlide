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
  totalGEarned?: string;
  totalGSpent?: string;
  referralCount?: string;
}

interface ProfileData {
  player: PlayerProfile | null;
  streak: bigint | null;
  loading: boolean;
  coreLoading: boolean; // true while core query (CORE QUERY) is in flight
  streakLoading: boolean; // true while contract streak read is in flight
  gdollarLoading: boolean; // true while optional G$ query is in flight
  error: string | null; // only set if CORE query fails or identifier not found
}

export function useProfileData(
  address: string | null,
  subgraphUrl: string
): ProfileData {
  // CORE QUERY: only fields that exist on deployed subgraph
  // If this fails, the whole page shows error. This decides the page's fate.
  const { data: player, isLoading: coreLoading, error: coreError } = useQuery({
    queryKey: ["profile-player-core", address],
    enabled: !!address && !!subgraphUrl,
    queryFn: async () => {
      if (!address || !subgraphUrl) return null;

      const query = `{
        players(where: { id: "${address.toLowerCase()}" }, first: 1) {
          id
          username
          xp
          bestScore
          gamesPlayed
          isVerified
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

      if (json.errors) {
        throw new Error("Failed to load profile");
      }

      return json.data?.players?.[0] ?? null;
    },
  });

  // OPTIONAL QUERY: G$ fields (totalGEarned, totalGSpent)
  // If this query fails or fields are absent, we show "coming soon" and nothing else breaks.
  // Its failure is completely swallowed and never propagates to the page-level error.
  const { data: gdollarData, isLoading: gdollarLoading } = useQuery({
    queryKey: ["profile-player-gdollar", address],
    enabled: !!address && !!subgraphUrl && !!player, // only probe once core query succeeds
    queryFn: async () => {
      if (!address || !subgraphUrl) return null;

      const query = `{
        players(where: { id: "${address.toLowerCase()}" }, first: 1) {
          id
          totalGEarned
          totalGSpent
          referralCount
        }
      }`;

      const res = await fetch(subgraphUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) return null; // Network error: fields unavailable

      const json = (await res.json()) as {
        data?: { players?: { totalGEarned?: string; totalGSpent?: string; referralCount?: string }[] };
        errors?: unknown;
      };

      // Ignore errors; the fields simply don't exist yet
      return json.data?.players?.[0] ?? null;
    },
  });

  // Merge core player data with optional G$ fields; only include G$ fields if the optional query succeeded
  const mergedPlayer: PlayerProfile | null = player
    ? {
        ...player,
        totalGEarned: gdollarData?.totalGEarned,
        totalGSpent: gdollarData?.totalGSpent,
        referralCount: gdollarData?.referralCount,
      }
    : null;

  // Read streak from contract
  // Streak failure only affects the streak card, never triggers page-level error.
  const { data: streak, isLoading: streakLoading } = useReadContract({
    address: GAME2048_ADDRESS,
    abi: GAME2048_ABI,
    functionName: "streakCount",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  });

  // Page-level error: only if CORE query fails (or identifier not found, handled by ProfileView)
  const error = coreError ? (coreError as Error).message : null;
  const loading = coreLoading; // Only core loading affects page skeletons

  return {
    player: mergedPlayer,
    streak: (streak as bigint) ?? null,
    loading,
    coreLoading,
    streakLoading,
    gdollarLoading,
    error,
  };
}
