/**
 * Cron target. Does the same bounded catch-up as GET /api/stats but without
 * deriving or returning the payload, so the schedule keeps the aggregate warm
 * even when nobody visits the page.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron sends
 * exactly that header when CRON_SECRET is set on the project, so no other
 * mechanism is needed. Fails CLOSED — if CRON_SECRET is unset the route
 * refuses every request rather than standing open.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { loadState, saveState, acquireLock, releaseLock, isConfigured } from "../../../../src/lib/stats/store";
import { getHeadBlock, scanForward } from "../../../../src/lib/stats/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Never serve this route's upstream RPC reads from Next's fetch cache. */
export const fetchCache = "force-no-store";
/** A full 12-chunk catch-up is ~36 sequential RPC reads; give it room. */
export const maxDuration = 60;

function bearerMatches(header: string | null, secret: string): boolean {
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return false;
  const given = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(secret);
  // Compare lengths first: timingSafeEqual throws on a length mismatch.
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "cron_secret_unset", message: "CRON_SECRET is not set, so this route refuses all requests." },
      { status: 503 }
    );
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "stats_unconfigured" }, { status: 503 });
  }

  // Another refresh already running: report, don't queue behind it.
  if (!(await acquireLock(120))) {
    return NextResponse.json({ skipped: "locked" });
  }
  try {
    const state = await loadState();
    const head = await getHeadBlock();
    const result = await scanForward(state, head);
    if (result.chunks > 0) await saveState(state);
    return NextResponse.json({
      head,
      checkpointBlock: state.checkpointBlock,
      blocksBehind: head - state.checkpointBlock,
      ...result,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    await releaseLock();
  }
}
