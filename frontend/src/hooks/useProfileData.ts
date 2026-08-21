import { useQuery } from "@tanstack/react-query";
import { useReadContract } from "wagmi";
import { GAME2048_ADDRESS } from "../lib/constants";
import { GAME2048_ABI } from "../lib/abi";
import { useGDollarStats } from "./useGDollarStats";

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

  // OPTIONAL QUERY: G$ fields (totalGEarned, totalGSpent) from subgraph
  // If this query fails or fields are absent, we fall back to contract events.
  // Its failure is completely swallowed and never propagates to the page-level error.
  const { data: gdollarData, isLoading: gdollarSubgraphLoading } = useQuery({
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

  // FALLBACK QUERY: fetch G$ stats from contract events if subgraph doesn't have them
  const { totalEarned, totalSpent, loading: gdollarEventLoading } = useGDollarStats(
    address,
    subgraphUrl,
    gdollarData
  );

  // VERIFICATION QUERY: fetch from the authoritative GoodDollar identity contract
  // Do NOT rely on subgraph's isVerified; it may be stale/incorrect
  const { data: verificationResult } = useQuery({
    queryKey: ["player-verification", address],
    enabled: !!address,
    queryFn: async () => {
      if (!address) return null;
      try {
        const res = await fetch("/api/player-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: [address] }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { results?: Record<string, { isVerified: boolean }> };
        return data.results?.[address.toLowerCase()]?.isVerified ?? false;
      } catch {
        return false;
      }
    },
    staleTime: 5 * 60_000, // 5 minutes (matches server cache)
    gcTime: 30 * 60_000, // Keep in cache for 30 min even after stale
    retry: 2, // Retry failed requests twice before giving up
  });

  // Merge core player data with optional G$ fields; prefer subgraph data, fallback to events
  // Use verification API result instead of subgraph's isVerified
  const mergedPlayer: PlayerProfile | null = player
    ? {
        ...player,
        isVerified: verificationResult ?? false,
        totalGEarned: gdollarData?.totalGEarned ?? totalEarned ?? undefined,
        totalGSpent: gdollarData?.totalGSpent ?? totalSpent ?? undefined,
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
  const gdollarLoading = gdollarSubgraphLoading || gdollarEventLoading; // Show loading while either source is fetching

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
