import { useQuery } from "@tanstack/react-query";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

export interface LeaderboardPlayer {
  id: string;
  xp: string;        // raw XP — always accrues
  displayXp: string; // 0 if unverified, equals xp if verified
  isVerified: boolean;
  username: string | null;
}

export interface LeaderboardPage {
  players: LeaderboardPlayer[];
  totalPlayers: number;
}

async function gql<T>(query: string): Promise<T> {
  if (!SUBGRAPH_URL) throw new Error("Subgraph URL not configured");
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Subgraph query failed: ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error("Subgraph returned errors");
  if (!json.data) throw new Error("Subgraph returned no data");
  return json.data;
}

/**
 * Fetch one page of the leaderboard plus the global player count.
 * Ordered by displayXp desc — verified players rank first, unverified show 0 XP.
 * Page is 1-indexed.
 */
export async function fetchLeaderboardPage(
  page: number,
  pageSize: number,
): Promise<LeaderboardPage> {
  if (!SUBGRAPH_URL) return { players: [], totalPlayers: 0 };
  const skip = (page - 1) * pageSize;
  const data = await gql<{
    players: LeaderboardPlayer[];
    globalStats: { totalPlayers: number } | null;
  }>(`{
    players(
      first: ${pageSize},
      skip: ${skip},
      orderBy: displayXp,
      orderDirection: desc
    ) {
      id
      xp
      displayXp
      isVerified
      username
    }
    globalStats(id: "global") {
      totalPlayers
    }
  }`);
  return {
    players: data.players,
    totalPlayers: data.globalStats?.totalPlayers ?? 0,
  };
}

export interface UserRank {
  xp: string;
  displayXp: string;
  isVerified: boolean;
  rank: number;
}

/**
 * Compute the logged-in user's rank.
 * rank = (number of players with higher displayXp) + 1.
 * Uses first: 1000 — sufficient for leaderboards up to 1001 players.
 */
export async function fetchUserRank(address: string): Promise<UserRank | null> {
  if (!SUBGRAPH_URL) return null;

  // Round 1: get the player's own data.
  const d1 = await gql<{
    player: { xp: string; displayXp: string; isVerified: boolean } | null;
  }>(`{
    player(id: "${address.toLowerCase()}") {
      xp
      displayXp
      isVerified
    }
  }`);
  if (!d1.player) return null;

  // Round 2: count players ranked above this player.
  const displayXp = d1.player.displayXp;
  const d2 = await gql<{ ahead: { id: string }[] }>(`{
    ahead: players(first: 1000, where: { displayXp_gt: "${displayXp}" }) { id }
  }`);

  return {
    xp: d1.player.xp,
    displayXp,
    isVerified: d1.player.isVerified,
    rank: d2.ahead.length + 1,
  };
}

/**
 * Mini-leaderboard hook — used by the in-game snippet (Leaderboard.tsx).
 * Shows top `limit` players ordered by displayXp desc.
 */
export function useLeaderboard(limit = 10, _skip = 0) {
  const configured = SUBGRAPH_URL.length > 0;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["leaderboard-mini", limit],
    queryFn: () => fetchLeaderboardPage(1, limit),
    enabled: configured,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  return {
    players: data?.players ?? [],
    isLoading,
    isError,
    configured,
  };
}
