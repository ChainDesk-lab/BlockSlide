/**
 * Public bounty standings, computed on the server so the page never receives more than it shows.
 *
 * For each configured bounty, the status comes from its end time (server clock). Live: the top 50
 * by XP earned since the start block, refreshed every LIVE_CACHE_MS. Completed: only the five
 * winners, by username and XP, with no wallet addresses — the full standings are never serialised.
 * A completed bounty's result is fixed (subgraph XP at its start and end blocks), so it is cached
 * for the life of the process once nothing in it can change.
 *
 * Bounties with rules (see config/bounties) also get eligibility: GoodDollar verification and
 * qualifying Shop purchases, both read on-chain (lib/bountyEligibility, lib/bountyEligibilityChain).
 * The ranking is walked in batches until five eligible players are found or every ranked player
 * has been checked; their winners are marked provisional because some requirements (an X follow)
 * only the team can confirm. A check that can't be read leaves the result incomplete, never final.
 *
 * Bounties with an exact window count XP and purchases in the blocks from the first block at or
 * after the start to the last block before the end. Bounties without one keep the original rule
 * (the blocks nearest the start and end times). Bounties without rules behave exactly as before.
 *
 * Nothing is deleted or rewritten: the subgraph keeps every player's history, and the same blocks
 * always give the same result. If the subgraph or RPC can't be read, that bounty's standings are
 * "unavailable" rather than empty or partial.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http, type PublicClient } from "viem";
import { celo } from "viem/chains";
import { bounties, getBountyStatus, type Bounty } from "../../../src/config/bounties";
import { firstBlockAtOrAfter, resolveBlockByTime } from "../../../src/lib/blockResolver";
import {
  LIVE_LIMIT, WINNER_COUNT, publicStandings, rankStandings, toPublicBounty,
  type EligibilityInput, type PlayerSnapshot, type PublicBounty, type StandingRow,
} from "../../../src/lib/bountyStandings";
import { evaluateEligibility, type BlockWindow, type EntryEligibility } from "../../../src/lib/bountyEligibility";
import { bountyPurchases, goodDollarVerification, latestBlock } from "../../../src/lib/bountyEligibilityChain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? process.env.SUBGRAPH_URL ?? "";
const RPC = (process.env.CELO_RPC_URLS ?? "https://forno.celo.org").split(",")[0].trim();
const LIVE_CACHE_MS = 30_000;
const PAGE = 1000;
/** Ranked players checked per verification batch (the first batch always covers the displayed list). */
const VERIFY_BATCH = Math.max(LIVE_LIMIT, Number(process.env.BOUNTY_VERIFY_BATCH ?? 100));
/** A hung subgraph marks the standings "unavailable" instead of holding the request open (as /api/leaderboard). */
const SUBGRAPH_TIMEOUT_MS = 10_000;

let client: PublicClient | null = null;
const rpc = () => (client ??= createPublicClient({ chain: celo, transport: http(RPC, { timeout: 15_000 }) }) as PublicClient);

/**
 * Players at a block (or the latest indexed block), paged by id so none are dropped. Original
 * bounties read the players the subgraph flags `isVerified` (as before). Rule bounties read every
 * player with XP, because their eligibility is checked on-chain: the subgraph sets that flag for
 * any wallet that earns XP, so it isn't GoodDollar verification.
 */
async function playersAt(block: bigint | null, filter: "verified" | "withXp"): Promise<Map<string, PlayerSnapshot>> {
  const out = new Map<string, PlayerSnapshot>();
  const blockClause = block !== null ? `, block: { number: ${block} }` : "";
  const where = filter === "verified" ? "isVerified: true" : `xp_gt: "0"`;
  let lastId = "0x";
  for (;;) {
    const query = `{ players(first: ${PAGE}, orderBy: id, where: { ${where}, id_gt: "${lastId}" }${blockClause}) { id xp username firstSeen } }`;
    const res = await fetch(SUBGRAPH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }), cache: "no-store", signal: AbortSignal.timeout(SUBGRAPH_TIMEOUT_MS) });
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

const playerFilter = (b: Bounty): "verified" | "withXp" => (b.rules ? "withXp" : "verified");

/** Memoised block lookups; a failure is not cached, so the next request retries. */
const blockLookups = new Map<string, Promise<bigint>>();
function memoBlock(key: string, resolve: () => Promise<bigint>): Promise<bigint> {
  let p = blockLookups.get(key);
  if (!p) {
    p = resolve();
    p.catch(() => blockLookups.delete(key));
    blockLookups.set(key, p);
  }
  return p;
}
const nearestBlock = (time: string) => memoBlock(`nearest:${time}`, () => resolveBlockByTime(rpc(), new Date(time)));
const firstBlockAt = (time: string) => memoBlock(`first:${time}`, () => firstBlockAtOrAfter(rpc(), new Date(time)));

/**
 * The block whose state is the bounty's "before" (start) or "after" (end) snapshot. Exact window:
 * the last block before each boundary, so XP in the first block at or after the start counts and
 * XP in the first block at or after the end doesn't. Otherwise the nearest block, as before.
 */
const startSnapshotBlock = (b: Bounty) => (b.exactWindow ? firstBlockAt(b.startTime).then((n) => n - 1n) : nearestBlock(b.startTime));
const endSnapshotBlock = (b: Bounty) => (b.exactWindow ? firstBlockAt(b.endTime).then((n) => n - 1n) : nearestBlock(b.endTime));

/** The blocks whose purchases count: the blocks after the start snapshot, through the end snapshot (or the head while live). */
async function purchaseWindow(b: Bounty, status: "live" | "ended"): Promise<BlockWindow> {
  const fromBlock = (await startSnapshotBlock(b)) + 1n;
  const toBlock = status === "ended" ? await endSnapshotBlock(b) : await latestBlock(rpc());
  return { fromBlock, toBlock };
}

const startSnapshots = new Map<string, Promise<Map<string, PlayerSnapshot>>>();

function startSnapshot(b: Bounty) {
  let p = startSnapshots.get(b.id);
  if (!p) {
    p = startSnapshotBlock(b).then((n) => playersAt(n, playerFilter(b)));
    p.catch(() => startSnapshots.delete(b.id)); // retry next request, don't cache a failure
    startSnapshots.set(b.id, p);
  }
  return p;
}

/**
 * Eligibility for a bounty with rules. Purchases come from one scan of the whole window, which
 * covers every player. Verification is read for the ranked players in batches, in leaderboard
 * order: the first batch covers the displayed list; later batches continue until five players
 * pass every check or every ranked player has been evaluated. Players whose purchase count can't
 * reach the minimum aren't verified past the displayed list (they can't win). A batch whose
 * verification can't be read stops the walk: everyone from there on stays unknown, which keeps
 * the selection incomplete instead of skipping them.
 */
async function eligibilityFor(b: Bounty, rows: StandingRow[], status: "live" | "ended"): Promise<EligibilityInput | undefined> {
  const rules = b.rules;
  if (!rules) return undefined;
  const min = rules.minPurchases ?? 0;

  let counts: Map<string, number> | null = null;
  let purchasesComplete = min === 0;
  if (min > 0) {
    try {
      const scan = await bountyPurchases(rpc(), b.id, await purchaseWindow(b, status));
      counts = scan.counts;
      purchasesComplete = scan.complete;
    } catch (err) {
      console.error(`[api/bounties] ${b.id} purchase scan failed:`, (err as Error).message);
    }
  }
  const purchasesOf = (id: string) => (min > 0 ? (counts ? (counts.get(id) ?? 0) : null) : null);
  const cannotQualify = (id: string) => min > 0 && counts !== null && purchasesComplete && (counts.get(id) ?? 0) < min;

  const eligibility = new Map<string, EntryEligibility>();
  let passing = 0;
  let verificationAvailable = true;
  for (let i = 0; i < rows.length; i += VERIFY_BATCH) {
    if (i > 0 && passing >= WINNER_COUNT) break;
    const batch = rows.slice(i, i + VERIFY_BATCH);
    const toVerify = rules.goodDollarVerified ? batch.filter((r, j) => i + j < LIVE_LIMIT || !cannotQualify(r.id)).map((r) => r.id) : [];
    const verified = toVerify.length > 0 ? await goodDollarVerification(rpc(), toVerify) : new Map<string, boolean | null>();
    // Only a player who could still qualify needs verification; an unread one stops the walk.
    const unread = toVerify.some((id) => !cannotQualify(id) && verified.get(id) == null);
    for (const r of batch) {
      const e = evaluateEligibility(rules, verified.get(r.id), purchasesOf(r.id), purchasesComplete);
      eligibility.set(r.id, e);
      if (e.meetsChecks === true) passing++;
    }
    if (unread) {
      verificationAvailable = false;
      console.error(`[api/bounties] ${b.id} GoodDollar verification unavailable from rank ${i + 1}`);
      break;
    }
  }
  return {
    rules,
    prizeTable: b.prizeTable,
    eligibility,
    checks: {
      purchasesComplete: min === 0 || (counts !== null && purchasesComplete),
      verificationAvailable,
      manualChecks: rules.manualChecks ?? [],
      evaluatedPlayers: eligibility.size,
    },
  };
}

interface Computed { rows: StandingRow[]; elig?: EligibilityInput }
const finalResults = new Map<string, Computed>();
const liveResults = new Map<string, { at: number; value: Computed }>();

/** A final result is kept for good only once nothing in it can still change. */
function isSettled(c: Computed): boolean {
  if (!c.elig) return true;
  const s = publicStandings("ended", c.rows, c.elig);
  return s.phase === "final" && s.complete === true;
}

async function resultFor(b: Bounty, status: "live" | "ended"): Promise<Computed> {
  if (status === "ended") {
    const done = finalResults.get(b.id);
    if (done) return done;
    const [start, end] = await Promise.all([startSnapshot(b), endSnapshotBlock(b).then((n) => playersAt(n, playerFilter(b)))]);
    const rows = rankStandings(start, end);
    const value: Computed = { rows, elig: await eligibilityFor(b, rows, "ended") };
    if (isSettled(value)) finalResults.set(b.id, value);
    return value;
  }
  const hit = liveResults.get(b.id);
  if (hit && Date.now() - hit.at < LIVE_CACHE_MS) return hit.value;
  const [start, now] = await Promise.all([startSnapshot(b), playersAt(null, playerFilter(b))]);
  const rows = rankStandings(start, now);
  const value: Computed = { rows, elig: await eligibilityFor(b, rows, "live") };
  liveResults.set(b.id, { at: Date.now(), value });
  return value;
}

export async function GET() {
  const now = new Date();
  const out: PublicBounty[] = await Promise.all(
    bounties.map(async (b, i) => {
      const status = getBountyStatus(b, now);
      if (status === "upcoming") return toPublicBounty(b, i, status, publicStandings(status, null));
      if (!SUBGRAPH_URL) return toPublicBounty(b, i, status, { phase: "unavailable" });
      try {
        const { rows, elig } = await resultFor(b, status);
        return toPublicBounty(b, i, status, publicStandings(status, rows, elig));
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
