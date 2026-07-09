import { useQuery } from "@tanstack/react-query";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

export interface LeaderboardPlayer {
  id: string;
  xp: string; // BigInt as string (e.g. "10105")
  username: string | null;
}

/** Standalone fetch — also exported for manual "Load more" calls outside of react-query. */
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
  return {
    players: data ?? [],
    isLoading,
    isError,
    configured,
  };
}
