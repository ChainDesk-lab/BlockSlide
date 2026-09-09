import { NextRequest, NextResponse } from "next/server";
import { getVerifications } from "../_lib/verification";
import { getRedis } from "../_lib/redis";
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
const SUBGRAPH_BUDGET_MS = 25_000; // ceiling for paging the whole player set
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

interface LeaderboardDiagnostics {
  subgraphPlayers: number; // rows the subgraph returned
  registryPlayers: number; // rows in the off-chain registry
  mergedTotal: number; // unique wallets after the union
  subgraphBlock: number | null; // last block the subgraph indexed
  hasIndexingErrors: boolean | null; // subgraph _meta.hasIndexingErrors
  subgraphConfigured: boolean;
}

interface LeaderboardPayload {
  rows: MergedPlayer[];
  stale: boolean;
  diagnostics: LeaderboardDiagnostics;
}

interface SubgraphPlayer {
  id: string;
  xp: string;
  username: string | null;
  firstSeen: string;
}

/**
 * Fetch every indexed player. Uses id-cursor pagination (`id_gt`) rather than
 * `skip`, so it is not bounded by The Graph's skip <= 5000 limit. Also returns
 * the subgraph's `_meta` so callers can see how far it has indexed.
 */
async function fetchAllSubgraphPlayers(): Promise<{
  players: SubgraphPlayer[];
  stale: boolean;
  block: number | null;
  hasIndexingErrors: boolean | null;
}> {
  if (!SUBGRAPH_URL) {
    return { players: [], stale: true, block: null, hasIndexingErrors: null };
  }

  const players: SubgraphPlayer[] = [];
  let lastId = ZERO_ADDR;
  let block: number | null = null;
  let hasIndexingErrors: boolean | null = null;
  const deadline = Date.now() + SUBGRAPH_BUDGET_MS;

  for (let i = 0; i < 100; i++) {
    if (Date.now() >= deadline) {
      console.warn("[Leaderboard] subgraph paging hit time budget; using partial set");
      return { players, stale: true, block, hasIndexingErrors };
    }

    // Include _meta on the first page only.
    const metaClause =
      i === 0 ? "_meta { block { number } hasIndexingErrors }" : "";
    const query = `{
      ${metaClause}
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
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Subgraph query failed: ${res.status}`);

    const json = (await res.json()) as {
      data?: {
        players?: SubgraphPlayer[];
        _meta?: { block?: { number?: number }; hasIndexingErrors?: boolean };
      };
      errors?: unknown;
    };
    if (json.errors) throw new Error("Subgraph returned errors");

    if (i === 0 && json.data?._meta) {
      block = json.data._meta.block?.number ?? null;
      hasIndexingErrors = json.data._meta.hasIndexingErrors ?? null;
    }

    const batch = json.data?.players ?? [];
    players.push(...batch);
    if (batch.length < SUBGRAPH_PAGE) break;
    lastId = batch[batch.length - 1].id;
  }

  return { players, stale: false, block, hasIndexingErrors };
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
      return {
        players: [] as SubgraphPlayer[],
        stale: true,
        block: null as number | null,
        hasIndexingErrors: null as boolean | null,
      };
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

  const diagnostics: LeaderboardDiagnostics = {
    subgraphPlayers: subRes.players.length,
    registryPlayers: registry.length,
    mergedTotal: rows.length,
    subgraphBlock: subRes.block,
    hasIndexingErrors: subRes.hasIndexingErrors,
    subgraphConfigured: SUBGRAPH_URL.length > 0,
  };

  return { rows, stale: subRes.stale, diagnostics };
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

    const { rows, stale, diagnostics } = payload;
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
        // Measurement, not for display — tells us at a glance whether "stuck at
        // 398" is the subgraph itself (subgraphPlayers ~398, indexing behind
        // head) or just an empty registry (registryPlayers 0).
        diagnostics: diagnostics ?? null,
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
