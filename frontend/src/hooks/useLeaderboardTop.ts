import { useQuery } from "@tanstack/react-query";
import { fetchLeaderboardPage, PAGE_SIZE, type PlayerRow } from "../components/Leaderboard";

/**
 * The first leaderboard page (top 50 by XP), shared with <Leaderboard /> through the same
 * query key, so the play screen's podium and standing cost no extra request. Real data only:
 * `rank` is null when the wallet isn't in the loaded page (the API has no per-wallet lookup).
 */
export function useLeaderboardTop(address?: string | null) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["leaderboard", "top"],
    queryFn: () => fetchLeaderboardPage(0, false),
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: 1, // an unavailable leaderboard is shown as such promptly, not after long backoff
  });
  const entries: PlayerRow[] = data?.entries ?? [];
  const idx = address ? entries.findIndex((e) => e.id.toLowerCase() === address.toLowerCase()) : -1;
  return {
    entries,
    topThree: entries.slice(0, 3),
    rank: idx >= 0 ? idx + 1 : null,
    myXp: idx >= 0 ? entries[idx].xp : null,
    totalPlayers: data?.totalPlayers ?? null,
    pageSize: PAGE_SIZE,
    isLoading,
    isError: isError && !data,
  };
}
