/**
 * Redis persistence for the stats aggregate. Same lazy-singleton client shape
 * as app/api/game/seed/route.ts so there is one connection per lambda.
 */
import { createClient } from "redis";
import { allowedRedisUrl } from "../redisUrl";
import { type StatsState, STATE_VERSION } from "./state";
import { GENESIS_BLOCK } from "./config";

export const STATE_KEY = "stats:v1:state";
export const LOCK_KEY = "stats:v1:lock";

type Client = ReturnType<typeof createClient>;
let client: Client | null = null;
/** Concurrent callers during a connect share one attempt (two page loads at once must not race). */
let connecting: Promise<Client | null> | null = null;

/** Shared with other aggregates (e.g. rewards) so a lambda holds one connection. */
export async function getClient(): Promise<Client | null> {
  const url = allowedRedisUrl();
  if (!url) return null;
  // isReady, not isOpen: isOpen is already true while a connect is still in progress or retrying.
  if (client?.isReady) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      // Fail fast when Redis is down: a short connect timeout, a couple of retries, and commands
      // rejected immediately while disconnected (instead of queued until it returns), so the stats
      // route answers "unavailable" in seconds rather than hanging the request.
      const c = createClient({
        url,
        disableOfflineQueue: true,
        socket: { connectTimeout: 3000, reconnectStrategy: (retries) => (retries > 2 ? false : Math.min(retries * 200, 800)) },
      });
      c.on("error", (err: Error) => console.error("[stats] redis error:", err.message));
      await c.connect();
      client = c;
      return c;
    } catch (err) {
      console.error("[stats] redis connect failed:", (err as Error).message);
      client = null;
      return null;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

/**
 * What a read of the stored aggregate found. Only "ok" carries a state, and only a state that
 * came from "ok" can be saved (saveState needs its raw value), so a failed, garbled or
 * wrong-version read can never be mistaken for "no aggregate yet" and scanned over from genesis.
 */
export type LoadResult =
  | { status: "ok"; state: StatsState; raw: string }
  /** The key does not exist: never seeded, or deleted/evicted. Recovery: run the seed script. */
  | { status: "missing" }
  /** Redis could not be asked (not connected, or the read errored). Transient: retry later. */
  | { status: "unavailable"; detail: string }
  /** The key holds something that is not a usable aggregate. Left in place for inspection. */
  | { status: "malformed"; detail: string }
  /** A well-formed aggregate written by a different STATE_VERSION. Left in place. */
  | { status: "unsupported_version"; detail: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

/** Classifies a stored value. Pure, so the decision is testable without Redis. */
export function parseStoredState(raw: string): Extract<LoadResult, { status: "ok" | "malformed" | "unsupported_version" }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { status: "malformed", detail: `not JSON (${(err as Error).message})` };
  }
  if (!isObj(parsed)) return { status: "malformed", detail: "not an object" };
  if (parsed.version !== STATE_VERSION) {
    return { status: "unsupported_version", detail: `stored version ${JSON.stringify(parsed.version)}, this code reads ${STATE_VERSION}` };
  }
  if (parsed.genesisBlock !== GENESIS_BLOCK) return { status: "malformed", detail: `genesisBlock ${JSON.stringify(parsed.genesisBlock)}, expected ${GENESIS_BLOCK}` };
  if (!isInt(parsed.checkpointBlock) || parsed.checkpointBlock < GENESIS_BLOCK - 1) return { status: "malformed", detail: "bad checkpointBlock" };
  if (typeof parsed.updatedAt !== "string" || !isInt(parsed.totalLogs) || typeof parsed.rewardPaidWei !== "string") {
    return { status: "malformed", detail: "bad updatedAt, totalLogs or rewardPaidWei" };
  }
  if (!isObj(parsed.eventCounts) || !isObj(parsed.addrs) || !isObj(parsed.dailyEvents)) {
    return { status: "malformed", detail: "bad eventCounts, addrs or dailyEvents" };
  }
  return { status: "ok", state: parsed as unknown as StatsState, raw };
}

export async function loadState(): Promise<LoadResult> {
  const c = await getClient();
  if (!c) return { status: "unavailable", detail: "not connected" };
  let raw: string | null;
  try {
    raw = await c.get(STATE_KEY);
  } catch (err) {
    console.error("[stats] loadState failed:", (err as Error).message);
    return { status: "unavailable", detail: (err as Error).message };
  }
  if (raw === null) return { status: "missing" };
  const result = parseStoredState(raw);
  if (result.status !== "ok") console.error(`[stats] stored aggregate is ${result.status}: ${result.detail}`);
  return result;
}

export type SaveResult = "saved" | "conflict" | "unavailable";

/**
 * Writes `state` only if the stored value is still exactly `expectedRaw`, the value it was loaded
 * from. Anything else (another writer got there first, the key was deleted or reseeded, or the
 * check itself failed) leaves the stored aggregate untouched. The check and the write are two
 * commands, so this narrows the race the lock already guards rather than closing it outright.
 */
export async function saveState(state: StatsState, expectedRaw: string): Promise<SaveResult> {
  const c = await getClient();
  if (!c) return "unavailable";
  try {
    const current = await c.get(STATE_KEY);
    if (current !== expectedRaw) {
      console.warn("[stats] saveState skipped: the stored aggregate changed since it was loaded");
      return "conflict";
    }
    await c.set(STATE_KEY, JSON.stringify(state));
    return "saved";
  } catch (err) {
    console.error("[stats] saveState failed:", (err as Error).message);
    return "unavailable";
  }
}

/**
 * Best-effort mutex so two concurrent page loads don't both scan and then
 * clobber each other's write. A refresh that loses the race just serves cache.
 */
export async function acquireLock(seconds = 60): Promise<boolean> {
  const c = await getClient();
  if (!c) return true; // no redis: nothing to protect
  try {
    const ok = await c.set(LOCK_KEY, String(Date.now()), { NX: true, EX: seconds });
    return ok === "OK";
  } catch {
    return false;
  }
}

export async function releaseLock(): Promise<void> {
  const c = await getClient();
  if (!c) return;
  try { await c.del(LOCK_KEY); } catch { /* lock expires on its own */ }
}

export const isConfigured = () => Boolean(allowedRedisUrl());

/** Whether the store can be reached right now (configured AND connected). */
export async function isReachable(): Promise<boolean> {
  return (await getClient()) !== null;
}
