/**
 * The Redis side of a stats reseed: snapshot, apply and roll back, with the concurrency rules in
 * docs/runbooks/STATS_RESEED.md. This is the ONLY reseed module that touches Redis, and nothing in
 * the dry-run path imports it (reseedDryRun.test.ts checks that). It runs only when an authorised
 * operator starts scripts/analytics/reseed-stats.ts with their own REDIS_URL.
 *
 * The client is injected, so the logic is tested against a scratch Redis (REDIS_TEST_URL) and never
 * against anything else. Keys default to the app's but can be overridden for those tests.
 *
 * How a swap stays safe next to the app's own refreshes
 * -----------------------------------------------------
 * The app writes the aggregate from /api/stats (when stale) and from the 6-hourly cron, under a
 * lock key (SET NX EX), and each write is a GET-compare-SET that skips if the value changed since it
 * was read. Its functions are killed after 60 s. So the reseed:
 *  1. takes the same lock (with its own token), so no NEW refresh can start;
 *  2. waits out the 60 s limit while keeping the lock, so every refresh that started EARLIER has
 *     finished or been killed (the app's releaseLock() is an unconditional DEL, so a slow refresh
 *     can remove our lock when it ends; we re-assert it every poll and re-take it if it was);
 *  3. re-reads the value and requires it to be byte-identical to the snapshot the replacement was
 *     built from, otherwise it stops (the state moved; re-snapshot and re-run the dry run);
 *  4. swaps with WATCH/MULTI, which Redis aborts if the key changes at all in between;
 *  5. reads it back, and releases the lock only if the token is still ours.
 * What is left is a millisecond window inside the app's GET-then-SET for a refresh that somehow
 * outlived all of the above; the runbook's post-write monitoring (isDescendant) detects that.
 */
import { createClient, WatchError } from "redis";
import { digest } from "./reseedHash";
import { LOCK_KEY, STATE_KEY } from "./store";
import type { StatsState } from "./state";

export type Redis = ReturnType<typeof createClient>;
export interface Keys { state: string; lock: string }
export const APP_KEYS: Keys = { state: STATE_KEY, lock: LOCK_KEY };

export { digest };

/** Where a URL points, without its credentials. Safe to print. */
export function describeTarget(url: string): { host: string; port: string; db: string; tls: boolean; local: boolean } {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  return { host, port: u.port || "6379", db: u.pathname.replace(/^\//, "") || "0", tls: u.protocol === "rediss:", local: ["localhost", "127.0.0.1", "::1"].includes(host) };
}

export async function connect(url: string): Promise<Redis> {
  const c = createClient({ url, socket: { connectTimeout: 5_000, reconnectStrategy: false } });
  c.on("error", () => { /* surfaces through the command that fails */ });
  await c.connect();
  return c;
}

export interface Facts {
  present: boolean;
  bytes: number;
  sha1: string | null;
  sha256: string | null;
  type: string;
  /** -1: no expiry, -2: no key. */
  ttlSeconds: number;
  checkpointBlock: number | null;
  updatedAt: string | null;
  lock: { held: boolean; value: string | null; ttlSeconds: number };
}

export async function readFacts(c: Redis, keys: Keys = APP_KEYS): Promise<{ facts: Facts; raw: string | null }> {
  const raw = await c.get(keys.state);
  const lockValue = await c.get(keys.lock);
  let checkpointBlock: number | null = null, updatedAt: string | null = null;
  if (raw !== null) {
    try { const p = JSON.parse(raw) as Partial<StatsState>; checkpointBlock = p.checkpointBlock ?? null; updatedAt = p.updatedAt ?? null; } catch { /* reported as unreadable by the caller */ }
  }
  return {
    raw,
    facts: {
      present: raw !== null, bytes: raw?.length ?? 0, sha1: raw === null ? null : digest("sha1", raw), sha256: raw === null ? null : digest("sha256", raw),
      type: await c.type(keys.state), ttlSeconds: await c.ttl(keys.state), checkpointBlock, updatedAt,
      lock: { held: lockValue !== null, value: lockValue, ttlSeconds: lockValue === null ? -2 : await c.ttl(keys.lock) },
    },
  };
}

export const takeLock = async (c: Redis, token: string, seconds: number, keys: Keys = APP_KEYS) => (await c.set(keys.lock, token, { NX: true, EX: seconds })) === "OK";
export const ownsLock = async (c: Redis, token: string, keys: Keys = APP_KEYS) => (await c.get(keys.lock)) === token;
export async function extendLock(c: Redis, token: string, seconds: number, keys: Keys = APP_KEYS) {
  if (await ownsLock(c, token, keys)) await c.expire(keys.lock, seconds);
}

/** Deletes the lock only if it still holds our token (the app's own release deletes unconditionally). */
export async function releaseLockIfOwner(c: Redis, token: string, keys: Keys = APP_KEYS): Promise<boolean> {
  return c.executeIsolated(async (iso) => {
    await iso.watch(keys.lock);
    if ((await iso.get(keys.lock)) !== token) { await iso.unwatch(); return false; }
    try { await iso.multi().del(keys.lock).exec(); return true; } catch (e) { if (e instanceof WatchError) return false; throw e; }
  });
}

export type SwapResult = { status: "swapped" } | { status: "conflict"; currentSha256: string | null };

/**
 * Replaces the value only if it is exactly `expectedRaw`, atomically; keeps any expiry.
 * `afterCompare` runs between the check and the transaction. It exists so tests can write to the key
 * in that window and see Redis abort the swap; nothing in production passes it.
 */
export async function swapIfUnchanged(c: Redis, expectedRaw: string, newRaw: string, keys: Keys = APP_KEYS, afterCompare?: () => Promise<void>): Promise<SwapResult> {
  return c.executeIsolated(async (iso) => {
    await iso.watch(keys.state);
    const current = await iso.get(keys.state);
    if (current !== expectedRaw) { await iso.unwatch(); return { status: "conflict" as const, currentSha256: current === null ? null : digest("sha256", current) }; }
    await afterCompare?.();
    try {
      await iso.multi().set(keys.state, newRaw, { KEEPTTL: true }).exec();
      return { status: "swapped" as const };
    } catch (e) {
      if (e instanceof WatchError) return { status: "conflict" as const, currentSha256: digest("sha256", (await iso.get(keys.state)) ?? "") };
      throw e;
    }
  });
}

export type Refusal = "missing" | "state_changed" | "lock_unavailable" | "lock_lost" | "verification_failed";
export type SwapOutcome =
  | { status: "done"; beforeSha256: string; afterSha256: string; /** The stored value had moved on from the expected one and the decision was made from the value actually found. */ rebased: boolean }
  | { status: "refused"; reason: Refusal; detail: string };

/** What to write given the value actually stored, or why not. */
export type Resolution = { newRaw: string } | { refuse: string };

export interface SwapOptions {
  /** The value that must be in place now, byte for byte. Used when `resolve` is not given. */
  expectedRaw?: string;
  newRaw?: string;
  /** With `resolve`: the value the plan was made for (the snapshot). Only used to report whether the value found differed from it. */
  baseline?: string;
  /**
   * Decide from the value actually found. Called once for a quick early refusal and again, under the lock after the
   * settle wait, with the value read just before the swap; the swap is then a compare-and-swap on exactly those bytes.
   * This is what lets an apply proceed when the app has legitimately refreshed since the snapshot.
   */
  resolve?: (currentRaw: string) => Resolution;
  lockToken: string;
  lockSeconds?: number;
  /** Must exceed the longest a refresh can run (60 s on Vercel) so earlier refreshes have ended. */
  settleSeconds?: number;
  pollSeconds?: number;
  /** How long to wait for a refresh that currently holds the lock. */
  lockWaitSeconds?: number;
  keys?: Keys;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

/** The guarded swap behind both apply (snapshot -> replacement) and rollback (replacement -> snapshot). */
export async function guardedSwap(c: Redis, o: SwapOptions): Promise<SwapOutcome> {
  const keys = o.keys ?? APP_KEYS, log = o.log ?? (() => {}), sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lockSeconds = o.lockSeconds ?? 900, settle = o.settleSeconds ?? 75, poll = Math.max(o.pollSeconds ?? 5, 0), waitLock = o.lockWaitSeconds ?? 180;
  const refuse = (reason: Refusal, detail: string): SwapOutcome => ({ status: "refused", reason, detail });
  const decide = (current: string): Resolution => {
    if (o.resolve) return o.resolve(current);
    if (o.expectedRaw === undefined || o.newRaw === undefined) return { refuse: "guardedSwap needs expectedRaw and newRaw, or resolve" };
    return current === o.expectedRaw ? { newRaw: o.newRaw } : { refuse: `the stored value (sha256 ${digest("sha256", current).slice(0, 16)}...) is not the one this was built from (${digest("sha256", o.expectedRaw).slice(0, 16)}...)` };
  };

  const before = await c.get(keys.state);
  if (before === null) return refuse("missing", "the key does not exist");
  const early = decide(before);
  if ("refuse" in early) return refuse("state_changed", early.refuse);

  // 1. Take the app's lock, waiting for a refresh that holds it.
  let waited = 0;
  while (!(await takeLock(c, o.lockToken, lockSeconds, keys))) {
    if (waited >= waitLock) return refuse("lock_unavailable", `the lock is held by ${JSON.stringify((await c.get(keys.lock)) ?? "?")}; a refresh is running or something else holds it`);
    log(`the refresh lock is held; waiting (${waited}s of ${waitLock}s)`);
    await sleep(Math.max(poll, 1) * 1000); waited += Math.max(poll, 1);
  }
  log(`took the refresh lock (token ${o.lockToken}); no new refresh can start`);

  try {
    // 2. Settle: let any refresh that began earlier finish or be killed, keeping the lock ours throughout.
    for (let t = 0; t < settle; t += Math.max(poll, 1)) {
      if (!(await ownsLock(c, o.lockToken, keys))) {
        log("the lock was removed (an earlier refresh released it as it ended); taking it again");
        if (!(await takeLock(c, o.lockToken, lockSeconds, keys))) return refuse("lock_lost", "someone else took the lock while we were waiting; nothing was changed");
      }
      await extendLock(c, o.lockToken, lockSeconds, keys);
      log(`settling: ${t}s of ${settle}s`);
      await sleep(Math.max(poll, 1) * 1000);
    }

    // 3. Decide from the value as it is NOW, still ours, and swap on exactly those bytes.
    if (!(await ownsLock(c, o.lockToken, keys)) && !(await takeLock(c, o.lockToken, lockSeconds, keys))) return refuse("lock_lost", "the lock was lost immediately before the swap; nothing was changed");
    const current = await c.get(keys.state);
    if (current === null) return refuse("missing", "the key disappeared while waiting; nothing was changed");
    const decision = decide(current);
    if ("refuse" in decision) return refuse("state_changed", `${decision.refuse} (nothing was changed; re-snapshot and run the dry run again)`);
    const baseline = o.baseline ?? o.expectedRaw;
    const rebased = baseline !== undefined && current !== baseline;
    if (rebased) log("the stored value has moved on since the snapshot (the app refreshed); deciding from the value actually stored");
    const swap = await swapIfUnchanged(c, current, decision.newRaw, keys);
    if (swap.status === "conflict") return refuse("state_changed", `the value changed during the swap (now sha256 ${swap.currentSha256?.slice(0, 16) ?? "none"}...); nothing was changed. Re-snapshot and run the dry run again`);

    // 4. Read it back.
    const after = await c.get(keys.state);
    if (after !== decision.newRaw) return refuse("verification_failed", "the value read back is not the one written; it may already have been overwritten. Check `status` and compare with the replacement");
    return { status: "done", beforeSha256: digest("sha256", current), afterSha256: digest("sha256", after), rebased };
  } finally {
    if (await releaseLockIfOwner(c, o.lockToken, keys)) log("released the lock"); else log("the lock was no longer ours at the end (left alone)");
  }
}
