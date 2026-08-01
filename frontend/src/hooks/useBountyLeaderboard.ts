import { useEffect, useState, useRef } from "react";
import { usePublicClient } from "wagmi";
import type { Bounty } from "../config/bounties";
import { resolveBlockByTime } from "../lib/blockResolver";

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

// In-memory cache for baseline XP at start block (per bounty)
const baselineCache = new Map<string, Map<string, { xp: bigint; username: string | null; isVerified: boolean }>>();

export function useBountyLeaderboard(
  bounty: Bounty,
  subgraphUrl: string,
  status: "upcoming" | "live" | "ended"
): BountyLeaderboardData {
  const publicClient = usePublicClient();
  const [entries, setEntries] = useState<BountyPlayerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);
  const startBlockRef = useRef<bigint | null>(null);

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
          // Live/ended: compute delta XP from start block baseline to current
          if (!publicClient) {
            throw new Error("Public client not available");
          }

          // Resolve start block from bounty startTime (cached across renders)
          if (!startBlockRef.current) {
            const startTime = new Date(bounty.startTime);
            startBlockRef.current = await resolveBlockByTime(publicClient, startTime);
            console.log(`[Bounty] Resolved start block: ${startBlockRef.current} (${startTime.toISOString()})`);
          }

          const startBlock = startBlockRef.current;
          const cacheKey = `${bounty.id}-${startBlock}`;

          // Check if baseline is already cached
          let baseline = baselineCache.get(cacheKey);
          if (!baseline) {
            // Fetch baseline XP at start block
            baseline = await fetchVerifiedPlayers(subgraphUrl, startBlock);
            baselineCache.set(cacheKey, baseline);
          }

          // Fetch current XP
          const current = await fetchVerifiedPlayers(subgraphUrl);

          if (cancelled) return;

          // Compute delta XP for all current verified players
          const deltas: BountyPlayerEntry[] = [];
          current.forEach((currentData, playerId) => {
            const baselineXp = baseline!.get(playerId)?.xp ?? 0n;
            const bountyXp = currentData.xp > baselineXp ? currentData.xp - baselineXp : 0n;

            if (bountyXp > 0n) {
              deltas.push({
                id: playerId,
                username: currentData.username,
                xpAtStart: baselineXp,
                xpAtEnd: currentData.xp,
                bountyXp,
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
  }, [bounty, subgraphUrl, status, publicClient]);

  return { entries, loading, error, isFrozen };
}
