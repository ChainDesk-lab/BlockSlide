/**
 * The stats store fails fast and never mistakes "connecting" for "connected", so a Redis outage
 * reads as "unavailable" (not "never seeded") and the page never waits forever.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const created: Array<{ opts: any }> = [];
let connectImpl: () => Promise<void> = async () => {};

vi.mock("redis", () => ({
  createClient: (opts: any) => {
    const c: any = {
      isOpen: false, isReady: false,
      on: () => c,
      connect: async () => { c.isOpen = true; await connectImpl(); c.isReady = true; },
      get: async () => null, set: async () => "OK", del: async () => 1,
    };
    created.push({ opts });
    return c;
  },
}));

async function freshStore(env: Record<string, string>) {
  vi.resetModules();
  created.length = 0;
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./store");
}

afterEach(() => { vi.unstubAllEnvs(); connectImpl = async () => {}; });

describe("stats store connection", () => {
  it("fails fast: short connect timeout, limited retries, no offline queue", async () => {
    const store = await freshStore({ REDIS_URL: "redis://127.0.0.1:6390/1", NODE_ENV: "development" });
    await store.getClient();
    const o = created[0].opts;
    expect(o.disableOfflineQueue).toBe(true);
    expect(o.socket.connectTimeout).toBe(3000);
    expect(o.socket.reconnectStrategy(3)).toBe(false);
  });

  it("concurrent callers share one connect attempt, and nobody is handed a half-connected client", async () => {
    let release!: () => void;
    connectImpl = () => new Promise<void>((r) => { release = r; });
    const store = await freshStore({ REDIS_URL: "redis://127.0.0.1:6390/1", NODE_ENV: "development" });
    const a = store.getClient(), b = store.getClient(), c = store.isReachable();
    await Promise.resolve();
    expect(created).toHaveLength(1); // one attempt for all three
    release();
    const [ca, cb, reachable] = await Promise.all([a, b, c]);
    expect(ca).toBe(cb);
    expect(ca?.isReady).toBe(true);
    expect(reachable).toBe(true);
  });

  it("an unreachable Redis is reported as unreachable to every concurrent caller", async () => {
    connectImpl = async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:6390"); };
    const store = await freshStore({ REDIS_URL: "redis://127.0.0.1:6390/1", NODE_ENV: "development" });
    const results = await Promise.all([store.isReachable(), store.isReachable(), store.getClient()]);
    expect(results).toEqual([false, false, null]);
  });

  it("under next dev, a non-local REDIS_URL is never connected to", async () => {
    const store = await freshStore({ REDIS_URL: "rediss://default:NOT_A_REAL_PASSWORD@prod.upstash.io:6379", NODE_ENV: "development" });
    expect(await store.getClient()).toBeNull();
    expect(store.isConfigured()).toBe(false);
    expect(created).toHaveLength(0);
  });
});

describe("stats route and page under failure", () => {
  const route = readFileSync(join(__dirname, "../../../app/api/stats/route.ts"), "utf8");
  const page = readFileSync(join(__dirname, "../../../app/stats/page.tsx"), "utf8");
  it("the route answers 'unavailable' when the store can't be reached, before treating it as unseeded", () => {
    expect(route).toMatch(/if \(!\(await isReachable\(\)\)\) \{[\s\S]*?"stats_unavailable"/);
    expect(route.indexOf("isReachable()")).toBeLessThan(route.indexOf("stats_unseeded"));
  });
  it("the page's request has a time limit, so a stalled server ends in the unavailable state", () => {
    expect(page).toContain("signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)");
    expect(page).toContain("const FETCH_TIMEOUT_MS = 75_000;");
  });
});
