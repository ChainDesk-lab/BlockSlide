/**
 * The stored stats aggregate is never overwritten because a read failed, came back garbled, or
 * came from another STATE_VERSION, and a scan that fails part-way never serves or saves a
 * half-applied chunk. Redis and the chain are faked in memory; the real routes run end to end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toEventSelector } from "viem";
import { GENESIS_BLOCK, MAX_RANGE } from "./config";
import { applyLogs, emptyState, STATE_VERSION, type StatsState } from "./state";

const STATE_KEY = "stats:v1:state";
const LOCK_KEY = "stats:v1:lock";

// ── fake Redis ───────────────────────────────────────────────────────────────
const kv = new Map<string, string>();
/** Called before every GET of the state key; throw to simulate a failed read. */
let onStateGet: (n: number) => void = () => {};
let stateGets = 0;
const stateWrites: string[] = [];

vi.mock("redis", () => ({
  createClient: () => {
    const c: any = {
      isOpen: false, isReady: false,
      on: () => c,
      connect: async () => { c.isOpen = true; c.isReady = true; },
      get: async (k: string) => {
        if (k === STATE_KEY) onStateGet(++stateGets);
        return kv.get(k) ?? null;
      },
      set: async (k: string, v: string, opts?: { NX?: boolean }) => {
        if (opts?.NX && kv.has(k)) return null;
        if (k === STATE_KEY) stateWrites.push(v);
        kv.set(k, v);
        return "OK";
      },
      del: async (k: string) => Number(kv.delete(k)),
    };
    return c;
  },
}));

// ── fake chain ───────────────────────────────────────────────────────────────
interface FakeLog { blockNumber: number; logIndex: number; topics: string[]; data?: string }
const chain = {
  head: 0,
  headFails: false,
  logs: [] as FakeLog[],
  /** Return true to make a getLogs call for this range throw. */
  failRange: (_from: number, _to: number) => false,
  /** Runs after a successful getLogs, e.g. to simulate another writer. */
  afterRead: () => {},
  reads: [] as Array<[number, number]>,
};

vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createPublicClient: () => ({
    getBlockNumber: async () => {
      if (chain.headFails) throw new Error("rpc down");
      return BigInt(chain.head);
    },
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      const from = Number(fromBlock), to = Number(toBlock);
      chain.reads.push([from, to]);
      if (chain.failRange(from, to)) throw new Error("rpc down");
      const out = chain.logs
        .filter((l) => l.blockNumber >= from && l.blockNumber <= to)
        .map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber), transactionHash: null }));
      chain.afterRead();
      return out;
    },
  }),
}));

const SESSION = toEventSelector("event SessionStarted(address)");
const REWARD = toEventSelector("event RewardPaid(address,uint32,uint256)");
const topicOf = (n: number) => "0x" + "0".repeat(24) + n.toString(16).padStart(40, "0");
const session = (blockNumber: number, wallet: number, logIndex = 0): FakeLog => ({ blockNumber, logIndex, topics: [SESSION, topicOf(wallet)] });

/** A valid seeded aggregate: two wallets, checkpoint at `checkpoint`, stale enough to refresh. */
function seeded(checkpoint = GENESIS_BLOCK + 100_000): StatsState {
  const s = emptyState();
  applyLogs(s, [
    { blockNumber: GENESIS_BLOCK + 10, topics: [SESSION, topicOf(1)] },
    { blockNumber: GENESIS_BLOCK + 20, topics: [SESSION, topicOf(2)] },
  ], checkpoint);
  s.updatedAt = new Date(0).toISOString();
  return s;
}

async function load() {
  vi.resetModules();
  const page = await import("../../../app/api/stats/route");
  const cron = await import("../../../app/api/stats/refresh/route");
  const store = await import("./store");
  return { page, cron, store };
}

const cronRequest = () => new Request("http://localhost/api/stats/refresh", { headers: { authorization: "Bearer test-cron-secret" } });

beforeEach(() => {
  kv.clear();
  stateWrites.length = 0;
  stateGets = 0;
  onStateGet = () => {};
  Object.assign(chain, { head: 0, headFails: false, logs: [], failRange: () => false, afterRead: () => {}, reads: [] });
  vi.stubEnv("REDIS_URL", "redis://fake");
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.stubEnv("STATS_SCAN_REPEATS", "1");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // readChunk backs off between retries; run those waits immediately.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { queueMicrotask(fn); return 0; }) as any);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── reading the stored value ─────────────────────────────────────────────────
describe("parseStoredState", () => {
  it("accepts a valid aggregate and keeps the exact raw value for the conditional save", async () => {
    const { store } = await load();
    const raw = JSON.stringify(seeded());
    const r = store.parseStoredState(raw);
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.raw).toBe(raw);
  });

  it.each([
    ["not JSON", "{not json", "malformed"],
    ["an empty string", "", "malformed"],
    ["JSON null", "null", "malformed"],
    ["an array", "[]", "malformed"],
    ["a truncated write", JSON.stringify(seeded()).slice(0, 200), "malformed"],
    ["missing maps", JSON.stringify({ ...seeded(), addrs: undefined }), "malformed"],
    ["a different genesis block", JSON.stringify({ ...seeded(), genesisBlock: 1 }), "malformed"],
    ["a non-integer checkpoint", JSON.stringify({ ...seeded(), checkpointBlock: "70000000" }), "malformed"],
    ["a newer version", JSON.stringify({ ...seeded(), version: STATE_VERSION + 1 }), "unsupported_version"],
    ["no version", JSON.stringify({ ...seeded(), version: undefined }), "unsupported_version"],
  ])("rejects %s", async (_label, raw, status) => {
    const { store } = await load();
    expect(store.parseStoredState(raw).status).toBe(status);
  });
});

describe("loadState", () => {
  it("tells a missing key, a failed read, a garbled value and a good value apart", async () => {
    const { store } = await load();
    expect((await store.loadState()).status).toBe("missing");

    kv.set(STATE_KEY, "{garbled");
    expect((await store.loadState()).status).toBe("malformed");

    kv.set(STATE_KEY, JSON.stringify(seeded()));
    onStateGet = () => { throw new Error("READONLY / timeout"); };
    expect((await store.loadState()).status).toBe("unavailable");

    onStateGet = () => {};
    expect((await store.loadState()).status).toBe("ok");
  });
});

// ── GET /api/stats ───────────────────────────────────────────────────────────
describe("GET /api/stats never overwrites the aggregate on a bad read", () => {
  it("a failed read answers 503 unavailable and leaves the stored value untouched (no scan, no write)", async () => {
    const raw = JSON.stringify(seeded());
    kv.set(STATE_KEY, raw);
    onStateGet = () => { throw new Error("socket closed"); };
    chain.head = GENESIS_BLOCK + 200_000;
    const { page } = await load();
    const res = await page.GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("stats_unavailable");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(kv.get(STATE_KEY)).toBe(raw);
    expect(stateWrites).toHaveLength(0);
    expect(chain.reads).toHaveLength(0);
  });

  it("the original bug: a good first read and a failed re-read inside the lock do not rebuild from genesis", async () => {
    const raw = JSON.stringify(seeded());
    kv.set(STATE_KEY, raw);
    onStateGet = (n) => { if (n === 2) throw new Error("timeout"); }; // the re-read inside the lock
    chain.head = GENESIS_BLOCK + 200_000;
    const { page } = await load();
    const res = await page.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkpointBlock).toBe(GENESIS_BLOCK + 100_000); // the first read, served as is
    expect(body.playerWallets).toBe(2);
    expect(body.scan).toBeNull();
    expect(kv.get(STATE_KEY)).toBe(raw);
    expect(stateWrites).toHaveLength(0);
    expect(chain.reads).toHaveLength(0); // nothing scanned, least of all from genesis
    expect(kv.has(LOCK_KEY)).toBe(false); // lock released
  });

  it.each([
    ["malformed", "{\"version\":1,\"addrs\":", "stats_malformed"],
    ["an unsupported version", JSON.stringify({ ...seeded(), version: 2 }), "stats_unsupported_version"],
  ])("a %s value answers 503, is left in place, and is never scanned over", async (_label, raw, error) => {
    kv.set(STATE_KEY, raw);
    chain.head = GENESIS_BLOCK + 200_000;
    const { page } = await load();
    const res = await page.GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(error);
    expect(kv.get(STATE_KEY)).toBe(raw);
    expect(stateWrites).toHaveLength(0);
    expect(chain.reads).toHaveLength(0);
  });

  it("a missing key answers 503 unseeded and is not created from a partial RPC scan", async () => {
    chain.head = GENESIS_BLOCK + 200_000;
    const { page } = await load();
    const res = await page.GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("stats_unseeded");
    expect(kv.has(STATE_KEY)).toBe(false);
    expect(chain.reads).toHaveLength(0);
  });

  it("lock contention: the request that loses serves the stored aggregate without scanning or writing", async () => {
    const raw = JSON.stringify(seeded());
    kv.set(STATE_KEY, raw);
    kv.set(LOCK_KEY, "held by another refresh");
    chain.head = GENESIS_BLOCK + 200_000;
    const { page } = await load();
    const res = await page.GET();
    expect(res.status).toBe(200);
    expect((await res.json()).scan).toBeNull();
    expect(kv.get(STATE_KEY)).toBe(raw);
    expect(chain.reads).toHaveLength(0);
    expect(kv.get(LOCK_KEY)).toBe("held by another refresh"); // not released by the loser
  });

  it("a healthy stale read scans forward, saves, and releases the lock", async () => {
    const start = GENESIS_BLOCK + 100_000;
    kv.set(STATE_KEY, JSON.stringify(seeded(start)));
    chain.head = start + 7_000;
    chain.logs = [session(start + 6_000, 3)];
    const { page } = await load();
    const body = await (await page.GET()).json();
    expect(body.scan).toEqual({ chunks: 2, caughtUp: true });
    expect(body.playerWallets).toBe(3);
    expect(JSON.parse(kv.get(STATE_KEY)!).checkpointBlock).toBe(start + 7_000);
    expect(kv.has(LOCK_KEY)).toBe(false);
  });

  it("an unreadable chain head serves the last known-good aggregate and writes nothing", async () => {
    const raw = JSON.stringify(seeded());
    kv.set(STATE_KEY, raw);
    chain.headFails = true;
    const { page } = await load();
    const res = await page.GET();
    expect(res.status).toBe(200);
    expect((await res.json()).playerWallets).toBe(2);
    expect(kv.get(STATE_KEY)).toBe(raw);
  });

  it("a scan that throws part-way through a chunk neither serves nor saves the half-applied chunk", async () => {
    const start = GENESIS_BLOCK + 100_000;
    const raw = JSON.stringify(seeded(start));
    kv.set(STATE_KEY, raw);
    chain.head = start + 12_000;
    chain.logs = [
      session(start + 100, 3),                       // chunk 1: fine
      session(start + 5_100, 4, 0),                   // chunk 2: applied first...
      { blockNumber: start + 5_200, logIndex: 1, topics: [REWARD, topicOf(4)], data: "0x" + "zz".repeat(64) }, // ...then this throws
    ];
    const { page } = await load();
    const res = await page.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playerWallets).toBe(2); // neither wallet 3 (completed chunk) nor wallet 4 (half chunk)
    expect(body.checkpointBlock).toBe(start);
    expect(body.scan).toBeNull();
    expect(kv.get(STATE_KEY)).toBe(raw);
  });

  it("does not save over a value another writer stored while this scan ran", async () => {
    const start = GENESIS_BLOCK + 100_000;
    kv.set(STATE_KEY, JSON.stringify(seeded(start)));
    chain.head = start + 1_000;
    const other = JSON.stringify({ ...seeded(start + 500), updatedAt: new Date().toISOString() });
    chain.afterRead = () => kv.set(STATE_KEY, other); // e.g. a reseed, or a refresh whose lock expired
    const { page } = await load();
    expect((await page.GET()).status).toBe(200);
    expect(kv.get(STATE_KEY)).toBe(other);
  });

  it("does not save when the pre-save check read fails", async () => {
    const start = GENESIS_BLOCK + 100_000;
    const raw = JSON.stringify(seeded(start));
    kv.set(STATE_KEY, raw);
    chain.head = start + 1_000;
    onStateGet = (n) => { if (n === 3) throw new Error("timeout"); }; // 1 outer, 2 in lock, 3 pre-save
    const { page } = await load();
    expect((await page.GET()).status).toBe(200);
    expect(kv.get(STATE_KEY)).toBe(raw);
    expect(stateWrites).toHaveLength(0);
  });
});

// ── the cron route ───────────────────────────────────────────────────────────
describe("GET /api/stats/refresh (cron)", () => {
  it("skips when another refresh holds the lock", async () => {
    kv.set(STATE_KEY, JSON.stringify(seeded()));
    kv.set(LOCK_KEY, "busy");
    const { cron } = await load();
    expect(await (await cron.GET(cronRequest())).json()).toEqual({ skipped: "locked" });
    expect(chain.reads).toHaveLength(0);
  });

  it.each([
    ["a failed read", () => { onStateGet = () => { throw new Error("timeout"); }; return JSON.stringify(seeded()); }, "stats_unavailable"],
    ["a garbled value", () => "{garbled", "stats_malformed"],
    ["another version", () => JSON.stringify({ ...seeded(), version: 9 }), "stats_unsupported_version"],
  ])("reports %s with 503 and writes nothing", async (_label, arrange, error) => {
    const raw = arrange();
    kv.set(STATE_KEY, raw);
    chain.head = GENESIS_BLOCK + 200_000;
    const { cron } = await load();
    const res = await cron.GET(cronRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(error);
    expect(kv.get(STATE_KEY)).toBe(raw);
    expect(chain.reads).toHaveLength(0);
    expect(kv.has(LOCK_KEY)).toBe(false);
  });

  it("reports a missing key as unseeded and does not create one", async () => {
    const { cron } = await load();
    const res = await cron.GET(cronRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("stats_unseeded");
    expect(kv.has(STATE_KEY)).toBe(false);
  });
});

// ── the checkpoint only covers ranges that were really read ─────────────────
describe("partial scans and the checkpoint", () => {
  it("a chunk whose every read fails stops the scan there; earlier chunks are kept, nothing past it is skipped", async () => {
    const start = GENESIS_BLOCK + 100_000;
    kv.set(STATE_KEY, JSON.stringify(seeded(start)));
    chain.head = start + 3 * MAX_RANGE;
    chain.logs = [session(start + 10, 3), session(start + MAX_RANGE + 10, 4)];
    chain.failRange = (from) => from === start + MAX_RANGE + 1; // the second chunk
    const { cron } = await load();
    const body = await (await cron.GET(cronRequest())).json();
    expect(body).toMatchObject({ chunks: 1, caughtUp: false, checkpointBlock: start + MAX_RANGE, save: "saved" });
    const saved = JSON.parse(kv.get(STATE_KEY)!);
    expect(saved.checkpointBlock).toBe(start + MAX_RANGE);
    expect(Object.keys(saved.addrs)).toHaveLength(3); // wallet 4 sits in the unread chunk: not counted, not skipped

    // The next run resumes exactly at the failed chunk and picks wallet 4 up.
    chain.failRange = () => false;
    chain.reads = [];
    await cron.GET(cronRequest());
    expect(chain.reads[0][0]).toBe(start + MAX_RANGE + 1);
    expect(Object.keys(JSON.parse(kv.get(STATE_KEY)!).addrs)).toHaveLength(4);
  });

  it("a failure in the first chunk advances nothing and writes nothing", async () => {
    const start = GENESIS_BLOCK + 100_000;
    const raw = JSON.stringify(seeded(start));
    kv.set(STATE_KEY, raw);
    chain.head = start + 100;
    chain.failRange = () => true;
    const { cron } = await load();
    expect(await (await cron.GET(cronRequest())).json()).toMatchObject({ chunks: 0, caughtUp: false, checkpointBlock: start, save: "nothing_new" });
    expect(kv.get(STATE_KEY)).toBe(raw);
  });

  it("one run stops at the chunk cap, never past the chain head, and reports that it is not caught up", async () => {
    const start = GENESIS_BLOCK + 100_000;
    kv.set(STATE_KEY, JSON.stringify(seeded(start)));
    chain.head = start + 20 * MAX_RANGE;
    const { cron } = await load();
    const body = await (await cron.GET(cronRequest())).json();
    expect(body).toMatchObject({ chunks: 12, caughtUp: false, checkpointBlock: start + 12 * MAX_RANGE });
    expect(Math.max(...chain.reads.map(([, to]) => to))).toBeLessThanOrEqual(chain.head);
  });

  it("a retried read that succeeds advances the checkpoint, and repeated logs are counted once", async () => {
    vi.stubEnv("STATS_SCAN_REPEATS", "3");
    const start = GENESIS_BLOCK + 100_000;
    kv.set(STATE_KEY, JSON.stringify(seeded(start)));
    chain.head = start + 100;
    chain.logs = [session(start + 50, 3)];
    let calls = 0;
    chain.failRange = () => ++calls === 1; // first attempt errors, the retry succeeds
    const { cron } = await load();
    const body = await (await cron.GET(cronRequest())).json();
    expect(body).toMatchObject({ chunks: 1, caughtUp: true, logs: 1 });
    expect(JSON.parse(kv.get(STATE_KEY)!).totalLogs).toBe(seeded(start).totalLogs + 1);
  });
});

// ── the seed script stays in step with the app ──────────────────────────────
describe("seed-stats.mjs", () => {
  const seed = readFileSync(join(__dirname, "../../../../scripts/analytics/seed-stats.mjs"), "utf8");
  const store = readFileSync(join(__dirname, "store.ts"), "utf8");

  it("writes the key and version the app reads", () => {
    expect(seed).toContain(`const STATE_KEY = "${STATE_KEY}";`);
    expect(seed).toContain(`const LOCK_KEY = "${LOCK_KEY}";`);
    expect(seed).toContain(`const STATE_VERSION = ${STATE_VERSION};`);
    expect(seed).toContain("version: STATE_VERSION,");
    expect(store).toContain(`export const STATE_KEY = "${STATE_KEY}";`);
    expect(store).toContain(`export const LOCK_KEY = "${LOCK_KEY}";`);
  });

  it("takes the lock, refuses to overwrite without --replace, and backs up before overwriting", () => {
    const lock = seed.indexOf("client.set(LOCK_KEY, lockToken, { NX: true");
    const check = seed.indexOf("if (!REPLACE)");
    const backup = seed.indexOf("writeFileSync(backup, existing");
    const write = seed.indexOf("await client.set(STATE_KEY, payload)");
    expect(lock).toBeGreaterThan(seed.indexOf("await client.connect();"));
    expect(lock).toBeLessThan(check);
    expect(check).toBeLessThan(backup);
    expect(backup).toBeLessThan(write);
    expect(seed).toContain("if (existing === null || REPLACE)");
  });
});
