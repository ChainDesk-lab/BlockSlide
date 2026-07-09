import { useQuery } from "@tanstack/react-query";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

export interface LeaderboardPlayer {
  id: string;
  xp: string; // BigInt serialised as string by Goldsky
  username: string | null;
}

/**
 * Exported so the /leaderboard page can call it directly for "Load more"
 * without going through react-query — those extra pages are static (not polled).
 */
export async function fetchLeaderboardPage(
  first: number,
  skip: number,
): Promise<LeaderboardPlayer[]> {
  if (!SUBGRAPH_URL) return [];
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{
        players(first: ${first}, skip: ${skip}, orderBy: xp, orderDirection: desc) {
          id
          xp
          username
        }
      }`,
    }),
  });
  if (!res.ok) throw new Error(`Subgraph query failed: ${res.status}`);
  const json = (await res.json()) as {
    data?: { players?: LeaderboardPlayer[] };
    errors?: unknown;
  };
  if (json.errors) throw new Error("Subgraph returned errors");
  return json.data?.players ?? [];
}

export function useLeaderboard(first = 10, skip = 0) {
  const configured = SUBGRAPH_URL.length > 0;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["leaderboard", first, skip],
    queryFn: () => fetchLeaderboardPage(first, skip),
    enabled: configured,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  return { players: data ?? [], isLoading, isError, configured };
}
