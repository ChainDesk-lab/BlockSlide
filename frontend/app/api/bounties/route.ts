/**
 * Public bounty standings, computed on the server so the page never receives more than it shows.
 *
 * For each configured bounty, the status comes from its end time (server clock). Live: the top 50
 * by XP earned since the start block, refreshed every LIVE_CACHE_MS. Completed: only the five
 * winners, by username and XP, with no wallet addresses — the full standings are never serialised.
 * A completed bounty's result is fixed (subgraph XP at its start and end blocks), so it is cached
 * for the life of the process.
 *
 * Nothing is deleted or rewritten: the subgraph keeps every player's history, and the same blocks
 * always give the same result. If the subgraph or RPC can't be read, that bounty's standings are
 * "unavailable" rather than empty or partial.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http, type PublicClient } from "viem";
import { celo } from "viem/chains";
import { bounties, getBountyStatus, type Bounty } from "../../../src/config/bounties";
import { resolveBlockByTime } from "../../../src/lib/blockResolver";
import {
  publicStandings, rankStandings, toPublicBounty,
  type PlayerSnapshot, type PublicBounty, type StandingRow,
} from "../../../src/lib/bountyStandings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? process.env.SUBGRAPH_URL ?? "";
const RPC = (process.env.CELO_RPC_URLS ?? "https://forno.celo.org").split(",")[0].trim();
const LIVE_CACHE_MS = 30_000;
const PAGE = 1000;

let client: PublicClient | null = null;
const rpc = () => (client ??= createPublicClient({ chain: celo, transport: http(RPC, { timeout: 15_000 }) }) as PublicClient);

/** Verified players at a block (or the latest indexed block), paged by id so none are dropped. */
async function verifiedPlayersAt(block: bigint | null): Promise<Map<string, PlayerSnapshot>> {
  const out = new Map<string, PlayerSnapshot>();
  const blockClause = block !== null ? `, block: { number: ${block} }` : "";
  let lastId = "0x";
  for (;;) {
    const query = `{ players(first: ${PAGE}, orderBy: id, where: { isVerified: true, id_gt: "${lastId}" }${blockClause}) { id xp username firstSeen } }`;
    const res = await fetch(SUBGRAPH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }), cache: "no-store" });
    if (!res.ok) throw new Error(`subgraph ${res.status}`);
    const json = (await res.json()) as { data?: { players?: Array<{ id: string; xp: string; username: string | null; firstSeen: string }> }; errors?: unknown };
    if (json.errors || !json.data?.players) throw new Error("subgraph returned errors");
    for (const p of json.data.players) {
      const id = p.id.toLowerCase();
      out.set(id, { id, xp: BigInt(p.xp), username: p.username, firstSeen: Number(p.firstSeen) || 0 });
    }
    if (json.data.players.length < PAGE) return out;
    lastId = json.data.players[json.data.players.length - 1].id;
  }
}

const startSnapshots = new Map<string, Promise<Map<string, PlayerSnapshot>>>();
const finalRows = new Map<string, StandingRow[]>();
const liveRows = new Map<string, { at: number; rows: StandingRow[] }>();

function startSnapshot(b: Bounty) {
  let p = startSnapshots.get(b.id);
  if (!p) {
    p = resolveBlockByTime(rpc(), new Date(b.startTime)).then(verifiedPlayersAt);
    p.catch(() => startSnapshots.delete(b.id)); // retry next request, don't cache a failure
    startSnapshots.set(b.id, p);
  }
  return p;
}

async function rowsFor(b: Bounty, status: "live" | "ended"): Promise<StandingRow[]> {
  if (status === "ended") {
    const done = finalRows.get(b.id);
    if (done) return done;
    const [start, end] = await Promise.all([startSnapshot(b), resolveBlockByTime(rpc(), new Date(b.endTime)).then(verifiedPlayersAt)]);
    const rows = rankStandings(start, end);
    finalRows.set(b.id, rows);
    return rows;
  }
  const hit = liveRows.get(b.id);
  if (hit && Date.now() - hit.at < LIVE_CACHE_MS) return hit.rows;
  const [start, now] = await Promise.all([startSnapshot(b), verifiedPlayersAt(null)]);
  const rows = rankStandings(start, now);
  liveRows.set(b.id, { at: Date.now(), rows });
  return rows;
}

export async function GET() {
  const now = new Date();
  const out: PublicBounty[] = await Promise.all(
    bounties.map(async (b, i) => {
      const status = getBountyStatus(b, now);
      if (status === "upcoming") return toPublicBounty(b, i, status, publicStandings(status, null));
      if (!SUBGRAPH_URL) return toPublicBounty(b, i, status, { phase: "unavailable" });
      try {
        return toPublicBounty(b, i, status, publicStandings(status, await rowsFor(b, status)));
      } catch (err) {
        console.error(`[api/bounties] ${b.id} standings unavailable:`, (err as Error).message);
        return toPublicBounty(b, i, status, { phase: "unavailable" });
      }
    })
  );
  const anyLive = out.some((b) => b.status === "live");
  return NextResponse.json(
    { bounties: out, generatedAt: now.toISOString() },
    { headers: { "Cache-Control": anyLive ? "public, s-maxage=30, stale-while-revalidate=60" : "public, s-maxage=300, stale-while-revalidate=3600" } }
  );
}
