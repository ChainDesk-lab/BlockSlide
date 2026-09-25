/**
 * Public stats feed. Serves the cached aggregate immediately and, when the
 * cache is stale, advances it by a bounded number of chunks first so the page
 * stays current without anyone running a script.
 *
 * Reads are cheap; the scan is capped so this route cannot outlive its
 * serverless timeout. If it cannot catch up in one request it catches up over
 * the next few.
 */
import { NextResponse } from "next/server";
import { derive } from "../../../src/lib/stats/state";
import { loadState, saveState, acquireLock, releaseLock, isConfigured } from "../../../src/lib/stats/store";
import { getHeadBlock, scanForward } from "../../../src/lib/stats/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Never serve this route's upstream RPC reads from Next's fetch cache. */
export const fetchCache = "force-no-store";
/** A stale read may scan up to 12 chunks before answering; give it room. */
export const maxDuration = 60;

/** Refresh at most this often, regardless of traffic. */
const STALE_AFTER_MS = Number(process.env.STATS_STALE_AFTER_MS ?? 5 * 60 * 1000);

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "stats_unconfigured", message: "REDIS_URL is not set, so the stats aggregate has nowhere to live." },
      { status: 503 }
    );
  }

  let state = await loadState();
  const age = Date.now() - Date.parse(state.updatedAt || "1970-01-01");
  let scan: { chunks: number; caughtUp: boolean } | null = null;

  if (age > STALE_AFTER_MS) {
    const gotLock = await acquireLock(60);
    if (gotLock) {
      try {
        state = await loadState(); // re-read inside the lock
        const head = await getHeadBlock();
        const result = await scanForward(state, head);
        if (result.chunks > 0) await saveState(state);
        scan = { chunks: result.chunks, caughtUp: result.caughtUp };
      } catch (err) {
        console.error("[stats] refresh failed:", (err as Error).message);
      } finally {
        await releaseLock();
      }
    }
  }

  if (state.checkpointBlock < state.genesisBlock) {
    return NextResponse.json(
      { error: "stats_unseeded", message: "No aggregate yet. Run scripts/seed-stats.mjs to load history, then this endpoint keeps itself current." },
      { status: 503 }
    );
  }

  const snapshot = derive(state);
  return NextResponse.json(
    { ...snapshot, scan },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
  );
}
