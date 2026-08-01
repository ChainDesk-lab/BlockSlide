import { useEffect, useState } from "react";
import type { Bounty } from "../config/bounties";

interface BountyPlayerEntry {
  id: string;
  username: string | null;
  xpAtStart: bigint;
  xpAtEnd: bigint;
  bountyXp: bigint;
  isVerified: boolean;
}

interface BountyLeaderboardData {
  entries: BountyPlayerEntry[];
  loading: boolean;
  error: string | null;
  isFrozen: boolean;
}

async function fetchVerifiedPlayers(
  subgraphUrl: string,
  blockNumber?: bigint
): Promise<Map<string, { xp: bigint; username: string | null; isVerified: boolean }>> {
  const blockClause = blockNumber ? `, block: { number: ${blockNumber} }` : "";
  const query = `{
    players(first: 1000, where: { isVerified: true }${blockClause}, orderBy: xp, orderDirection: desc) {
      id
      xp
      username
      isVerified
    }
  }`;

  const res = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) throw new Error("Subgraph query failed");
  const json = (await res.json()) as {
    data?: { players?: Array<{ id: string; xp: string; username: string | null; isVerified: boolean }> };
    errors?: unknown;
  };

  if (json.errors) throw new Error("Subgraph returned errors");

  const result = new Map<string, { xp: bigint; username: string | null; isVerified: boolean }>();
  json.data?.players?.forEach((p) => {
    result.set(p.id.toLowerCase(), {
      xp: BigInt(p.xp),
      username: p.username,
      isVerified: true,
    });
  });

  return result;
}

export function useBountyLeaderboard(
  bounty: Bounty,
  subgraphUrl: string,
  status: "upcoming" | "live" | "ended"
): BountyLeaderboardData {
  const [entries, setEntries] = useState<BountyPlayerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);

  useEffect(() => {
    if (!subgraphUrl) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setError(null);

        if (status === "upcoming") {
          // Show all verified players at 0 XP (preview mode)
          const players = await fetchVerifiedPlayers(subgraphUrl);

          if (cancelled) return;

          const deltas: BountyPlayerEntry[] = [];
          players.forEach((playerData, playerId) => {
            deltas.push({
              id: playerId,
              username: playerData.username,
              xpAtStart: 0n,
              xpAtEnd: 0n,
              bountyXp: 0n,
              isVerified: true,
            });
          });

          // Sort by username for consistent ordering in preview
          deltas.sort((a, b) => (a.username || a.id).localeCompare(b.username || b.id));
          const topPlayers = deltas.slice(0, 50);

          setEntries(topPlayers);
          setIsFrozen(false);
        } else if (status === "live" || status === "ended") {
          // Live/ended: compute delta XP from start block to now (or end block)
          // For now, we'll show current XP as bountyXp since block resolution requires async viem calls
          // This will be populated once the bounty goes live
          const players = await fetchVerifiedPlayers(subgraphUrl);

          if (cancelled) return;

          const deltas: BountyPlayerEntry[] = [];
          players.forEach((playerData, playerId) => {
            if (playerData.xp > 0n) {
              deltas.push({
                id: playerId,
                username: playerData.username,
                xpAtStart: 0n,
                xpAtEnd: playerData.xp,
                bountyXp: playerData.xp,
                isVerified: true,
              });
            }
          });

          deltas.sort((a, b) => Number(b.bountyXp - a.bountyXp));
          const topPlayers = deltas.slice(0, 50);

          setEntries(topPlayers);
          setIsFrozen(status === "ended");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load bounty leaderboard");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bounty, subgraphUrl, status]);

  return { entries, loading, error, isFrozen };
}
