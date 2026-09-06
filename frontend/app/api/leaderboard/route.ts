import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";
import { getVerifications } from "../_lib/verification";
import {
  buildOrderedLeaderboard,
  type MergedPlayer,
} from "../../../src/lib/leaderboard";

/**
 * Unified leaderboard.
 *
 * Merges on-chain players (subgraph — source of truth for XP and on-chain
 * usernames) with the off-chain player registry (every wallet that has ever
 * authenticated) so no signup is ever missing.
 *
 * Ordering is the three-tier rule, computed ONCE over the whole player set (not
 * a client-side window, which is what used to drop/duplicate rows across pages):
 *   tier 0 — GoodDollar-verified players, by XP desc
 *   tier 1 — unverified players who have earned XP, by XP desc
 *   tier 2 — everyone else (no XP yet), oldest signup first
 * Every tier has a fully deterministic tie-break (firstSeen, then address), so a
 * given player always lands on exactly one page.
 *
 * Pagination happens here, so the client renders exact 50-row slices and the
 * page count reflects the real player total (no 1000-row cap).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? process.env.SUBGRAPH_URL ?? "";
const REGISTRY_KEY = "players:registry";
const CACHE_KEY = "leaderboard:merged:v1";
const CACHE_TTL_SECONDS = 15;
const PAGE_SIZE = 50;
const SUBGRAPH_PAGE = 1000; // The Graph max page size
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

interface LeaderboardPayload {
  rows: MergedPlayer[];
  stale: boolean;
}

let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (redisClient?.isOpen) return redisClient;
  try {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on("error", (e: Error) =>
      console.error("[Leaderboard Redis] client error:", e)
    );
    await redisClient.connect();
    return redisClient;
  } catch (e) {
    console.error("[Leaderboard Redis] connect failed:", e);
    redisClient = null;
    return null;
  }
}

interface SubgraphPlayer {
  id: string;
  xp: string;
  username: string | null;
  firstSeen: string;
}

/**
 * Fetch every indexed player. Uses id-cursor pagination (`id_gt`) rather than
 * `skip`, so it is not bounded by The Graph's skip <= 5000 limit.
 */
async function fetchAllSubgraphPlayers(): Promise<{
  players: SubgraphPlayer[];
  stale: boolean;
}> {
  if (!SUBGRAPH_URL) return { players: [], stale: true };

  const players: SubgraphPlayer[] = [];
  let lastId = ZERO_ADDR;

  for (let i = 0; i < 100; i++) {
    const query = `{
      players(
        first: ${SUBGRAPH_PAGE}
        orderBy: id
        orderDirection: asc
        where: { id_gt: "${lastId}" }
      ) { id xp username firstSeen }
    }`;

    const res = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Subgraph query failed: ${res.status}`);

    const json = (await res.json()) as {
      data?: { players?: SubgraphPlayer[] };
      errors?: unknown;
    };
    if (json.errors) throw new Error("Subgraph returned errors");

    const batch = json.data?.players ?? [];
    players.push(...batch);
    if (batch.length < SUBGRAPH_PAGE) break;
    lastId = batch[batch.length - 1].id;
  }

  return { players, stale: false };
}

interface RegistryProfile {
  address: string;
  username: string | null;
  createdAt: number;
  updatedAt: number;
}

async function fetchRegistry(): Promise<RegistryProfile[]> {
  const client = await getRedis();
  if (!client) return [];
  try {
    const all = await client.hGetAll(REGISTRY_KEY);
    return Object.values(all).map((v) => JSON.parse(v) as RegistryProfile);
  } catch (e) {
    console.error("[Leaderboard] registry read failed:", e);
    return [];
  }
}

async function buildLeaderboard(): Promise<LeaderboardPayload> {
  const [subRes, registry] = await Promise.all([
    fetchAllSubgraphPlayers().catch((e) => {
      console.error("[Leaderboard] subgraph fetch failed:", e);
      return { players: [] as SubgraphPlayer[], stale: true };
    }),
    fetchRegistry(),
  ]);

  const ids = [
    ...subRes.players.map((p) => p.id),
    ...registry.map((r) => r.address),
  ];

  // Verification for every player, in one Redis-cached batch. Never throws —
  // on failure players just fall to tier 1/2 for this cycle and self-heal on
  // the next rebuild.
  let verif: Record<string, boolean | null> = {};
  try {
    verif = await getVerifications(ids);
  } catch (e) {
    console.error("[Leaderboard] verification batch failed:", e);
  }

  const rows = buildOrderedLeaderboard(subRes.players, registry, verif);
  return { rows, stale: subRes.stale };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const page = Math.max(
    0,
    parseInt(url.searchParams.get("page") ?? "0", 10) || 0
  );
  const fresh = url.searchParams.get("fresh") === "1";

  try {
    const client = await getRedis();
    let payload: LeaderboardPayload | null = null;

    if (!fresh && client) {
      try {
        const cached = await client.get(CACHE_KEY);
        if (cached) payload = JSON.parse(cached) as LeaderboardPayload;
      } catch {
        /* ignore cache read errors — fall through to a rebuild */
      }
    }

    if (!payload) {
      payload = await buildLeaderboard();
      if (client && payload.rows.length > 0) {
        client
          .setEx(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(payload))
          .catch(() => {
            /* non-fatal */
          });
      }
    }

    const { rows, stale } = payload;
    const totalPlayers = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalPlayers / PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const start = safePage * PAGE_SIZE;
    const entries = rows.slice(start, start + PAGE_SIZE);

    return NextResponse.json(
      {
        entries,
        page: safePage,
        pageSize: PAGE_SIZE,
        totalPlayers,
        totalPages,
        stale,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[Leaderboard API] error:", err);
    return NextResponse.json(
      {
        entries: [],
        page: 0,
        pageSize: PAGE_SIZE,
        totalPlayers: 0,
        totalPages: 1,
        stale: true,
        error: "Internal error",
      },
      { status: 500 }
    );
  }
}
