import { useQuery } from "@tanstack/react-query";

// Goldsky subgraph GraphQL endpoint. Set NEXT_PUBLIC_SUBGRAPH_URL after deploying
// the subgraph in /subgraph (see its README/deploy step).
const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

interface PlayerRow {
  id: string; // wallet address
  xp: string; // BigInt as string
  username: string | null;
}

const QUERY = `{
  players(first: 10, orderBy: xp, orderDirection: desc, where: { xp_gt: "0" }) {
    id
    xp
    username
  }
}`;

async function fetchLeaderboard(): Promise<PlayerRow[]> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`Subgraph query failed: ${res.status}`);
  const json = (await res.json()) as { data?: { players?: PlayerRow[] }; errors?: unknown };
  if (json.errors) throw new Error("Subgraph returned errors");
  return json.data?.players ?? [];
}

export default function Leaderboard() {
  const configured = SUBGRAPH_URL.length > 0;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: fetchLeaderboard,
    enabled: configured,
    refetchInterval: 30_000, // pick up new scores
    staleTime: 15_000,
  });

  const entries = data ?? [];
  const showEmpty = configured && !isLoading && (isError || entries.length === 0);

  return (
    <div className="leaderboard">
      <h3 className="leaderboard__title">Top Players</h3>

      {!configured && (
        <p className="leaderboard__empty">Leaderboard is being set up.</p>
      )}
      {configured && isLoading && (
        <p className="leaderboard__empty">Loading…</p>
      )}
      {showEmpty && (
        <p className="leaderboard__empty">No scores yet. Be the first to play.</p>
      )}

      {entries.length > 0 && (
        <ol className="leaderboard__list">
          {entries.map((entry, i) => {
            const name = entry.username?.trim() || generatedName(entry.id);
            return (
              <li key={entry.id} className="leaderboard__entry">
                <span className="leaderboard__rank">{i + 1}</span>
                <div className="leaderboard__player">
                  <span className="leaderboard__name">{name}</span>
                  <span className="leaderboard__addr" title={entry.id}>
                    {shortAddr(entry.id)}
                  </span>
                </div>
                <span className="leaderboard__score">
                  {Number(entry.xp).toLocaleString()} XP
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Deterministic friendly name when a player hasn't claimed an on-chain username.
function generatedName(addr: string): string {
  return `Player-${addr.slice(-4).toUpperCase()}`;
}
