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
import { loadState, acquireLock, releaseLock, isConfigured, isReachable, type LoadResult } from "../../../src/lib/stats/store";
import { refreshAggregate } from "../../../src/lib/stats/refresh";

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

  // Configured but unreachable is an outage, not "never seeded": say so, and don't scan.
  if (!(await isReachable())) {
    return NextResponse.json(
      { error: "stats_unavailable", message: "The stats store can't be reached right now" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Anything but a good read is reported as it is. In particular a failed or garbled read is
  // never treated as "no aggregate yet", which would scan from genesis and save over the real one.
  const loaded = await loadState();
  if (loaded.status !== "ok") return storeProblem(loaded);

  let state = loaded.state;
  const age = Date.now() - Date.parse(state.updatedAt || "1970-01-01");
  let scan: { chunks: number; caughtUp: boolean } | null = null;

  if (age > STALE_AFTER_MS) {
    const gotLock = await acquireLock(60);
    if (gotLock) {
      try {
        const refresh = await refreshAggregate(); // re-reads inside the lock
        if (refresh.status === "not_loaded") {
          console.error("[stats] refresh skipped, re-read was", refresh.load.status); // serve the first read
        } else {
          state = refresh.state;
          if (refresh.status === "failed") console.error("[stats] refresh failed:", refresh.error);
          else scan = { chunks: refresh.result.chunks, caughtUp: refresh.result.caughtUp };
        }
      } finally {
        await releaseLock();
      }
    }
  }

  if (state.checkpointBlock < state.genesisBlock) {
    return NextResponse.json(
      { error: "stats_unseeded", message: "No aggregate yet. Run scripts/analytics/seed-stats.mjs to load history, then this endpoint keeps itself current." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const snapshot = derive(state);
  return NextResponse.json(
    { ...snapshot, scan },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
  );
}

/** The response for a read that produced no usable aggregate. Never cached: it should clear as soon as the cause does. */
function storeProblem(load: Exclude<LoadResult, { status: "ok" }>) {
  const body =
    load.status === "missing"
      ? { error: "stats_unseeded", message: "No aggregate yet. Run scripts/analytics/seed-stats.mjs to load history, then this endpoint keeps itself current." }
      : load.status === "unavailable"
        ? { error: "stats_unavailable", message: "The stats store can't be reached right now" }
        : {
            error: load.status === "malformed" ? "stats_malformed" : "stats_unsupported_version",
            message: "The stored stats can't be read by this version of the app, so they are left untouched until they are reseeded",
          };
  return NextResponse.json(body, { status: 503, headers: { "Cache-Control": "no-store" } });
}
