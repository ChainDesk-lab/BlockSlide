/**
 * The contract's on-chain top-10 score table, with usernames.
 *
 * Two view calls per refresh (getLeaderboard, getUsernames), cached in memory
 * for CACHE_MS and at the CDN via s-maxage, so page traffic never turns into
 * RPC traffic. On an RPC failure the last good table is served, marked stale;
 * with no good table yet, the route answers 503 and the page shows that card's
 * error state without affecting the rest of the dashboard.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { celo } from "viem/chains";
import { GAME_ADDRESS } from "../../../../src/lib/stats/config";
import { shapeTopScores, type TopScore } from "../../../../src/lib/stats/topScores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const CACHE_MS = 60_000;
const RPC = (process.env.CELO_RPC_URLS ?? "https://forno.celo.org").split(",")[0].trim();

const ABI = parseAbi([
  "function getLeaderboard() view returns ((address player, uint256 score, uint32 highestTile)[10])",
  "function getUsernames(address[] players) view returns (string[] names)",
]);

const client = createPublicClient({
  chain: celo,
  transport: http(RPC, { timeout: 15_000, fetchOptions: { cache: "no-store" } }),
});

let cached: { at: number; entries: TopScore[] } | null = null;

async function read(): Promise<TopScore[]> {
  const raw = await client.readContract({ address: GAME_ADDRESS, abi: ABI, functionName: "getLeaderboard" });
  const filled = raw.filter((e) => e.player !== "0x0000000000000000000000000000000000000000" && e.score > 0n);
  const names = filled.length
    ? await client.readContract({
        address: GAME_ADDRESS, abi: ABI, functionName: "getUsernames",
        args: [filled.map((e) => e.player as Address)],
      })
    : [];
  return shapeTopScores(filled, names);
}

export async function GET() {
  const fresh = cached && Date.now() - cached.at < CACHE_MS;
  if (!fresh) {
    try {
      cached = { at: Date.now(), entries: await read() };
    } catch (err) {
      console.error("[analytics/top-scores] read failed:", (err as Error).message);
      if (!cached) {
        return NextResponse.json(
          { error: "top_scores_unavailable", message: "Could not read the on-chain score table." },
          { status: 503, headers: { "Cache-Control": "no-store" } }
        );
      }
      return NextResponse.json(
        { entries: cached.entries, readAt: new Date(cached.at).toISOString(), stale: true, contract: GAME_ADDRESS },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  }
  return NextResponse.json(
    { entries: cached!.entries, readAt: new Date(cached!.at).toISOString(), stale: false, contract: GAME_ADDRESS },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
  );
}
