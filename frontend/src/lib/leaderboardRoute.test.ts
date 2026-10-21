/**
 * /api/leaderboard behavior under indexing lag, subgraph outages, pagination
 * and missing XP. Redis, verification and the chain-head RPC are mocked; the
 * subgraph is a stubbed fetch. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisStore = new Map<string, string>();
const registry: Record<string, string> = {};
const fakeRedis = {
  get: async (k: string) => redisStore.get(k) ?? null,
  setEx: async (k: string, _ttl: number, v: string) => {
    redisStore.set(k, v);
  },
  hGetAll: async () => ({ ...registry }),
};
let head: number | Error = 0;

vi.mock("../../app/api/_lib/redis", () => ({ getRedis: async () => fakeRedis }));
vi.mock("../../app/api/_lib/verification", () => ({ getVerifications: async () => ({}) }));
vi.mock("./stats/scan", () => ({
  getHeadBlock: async () => {
    if (head instanceof Error) throw head;
    return head;
  },
}));

const SUBGRAPH = "https://subgraph.test/gn";
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");

function subgraphReply(players: Array<{ id: string; xp: string | null }>, block = 1_000) {
  return {
    data: {
      _meta: { block: { number: block }, hasIndexingErrors: false },
      players: players.map((p) => ({ ...p, username: null, firstSeen: "100" })),
    },
  };
}

/** Stub fetch with a queue of subgraph responses (or errors). Returns the request bodies seen. */
function stubSubgraph(responses: Array<object | Error>) {
  const bodies: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    bodies.push(init.body);
    const next = responses.shift();
    if (!next || next instanceof Error) throw next ?? new Error("no response queued");
    return { ok: true, status: 200, json: async () => next } as Response;
  });
  return bodies;
}

async function callRoute(qs = "fresh=1") {
  const { GET } = await import("../../app/api/leaderboard/route");
  const res = await GET(new Request(`http://localhost/api/leaderboard?${qs}`) as any);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.resetModules();
  redisStore.clear();
  for (const k of Object.keys(registry)) delete registry[k];
  process.env.NEXT_PUBLIC_SUBGRAPH_URL = SUBGRAPH;
  delete process.env.LEADERBOARD_MAX_LAG_BLOCKS;
  head = 1_000;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("indexing lag", () => {
  it("is not stale when the subgraph is at chain head", async () => {
    stubSubgraph([subgraphReply([{ id: addr(1), xp: "50" }], 1_000)]);
    head = 1_010;
    const { status, body } = await callRoute();
    expect(status).toBe(200);
    expect(body.stale).toBe(false);
    expect(body.freshness).toMatchObject({ indexedBlock: 1_000, headBlock: 1_010, lagBlocks: 10, maxLagBlocks: 600 });
  });

  it("flags stale when the lag exceeds the limit, but still returns the real XP", async () => {
    stubSubgraph([subgraphReply([{ id: addr(1), xp: "50" }], 1_000)]);
    head = 5_000;
    const { body } = await callRoute();
    expect(body.stale).toBe(true);
    expect(body.freshness.reason).toBe("indexing_lag");
    expect(body.entries[0]).toMatchObject({ id: addr(1), xp: "50" });
  });

  it("honors LEADERBOARD_MAX_LAG_BLOCKS", async () => {
    process.env.LEADERBOARD_MAX_LAG_BLOCKS = "5000";
    stubSubgraph([subgraphReply([{ id: addr(1), xp: "50" }], 1_000)]);
    head = 5_000;
    const { body } = await callRoute();
    expect(body.stale).toBe(false);
    expect(body.freshness.maxLagBlocks).toBe(5000);
  });

  it("reports lag as unknown when the chain head RPC fails", async () => {
    stubSubgraph([subgraphReply([{ id: addr(1), xp: "50" }], 1_000)]);
    head = new Error("rpc down");
    const { body } = await callRoute();
    expect(body.stale).toBe(false);
    expect(body.freshness).toMatchObject({ headBlock: null, lagBlocks: null });
  });
});

describe("subgraph outage", () => {
  it("never shows registry players at 0 XP when the subgraph is down and nothing is saved", async () => {
    registry[addr(7)] = JSON.stringify({ address: addr(7), username: "reg", createdAt: 1, updatedAt: 1 });
    stubSubgraph([new Error("subgraph down")]);
    const { status, body } = await callRoute();
    expect(status).toBe(503);
    expect(body.entries).toEqual([]);
    expect(body.error).toBe("leaderboard_unavailable");
    expect(body.freshness.reason).toBe("subgraph_unavailable");
  });

  it("serves the last complete leaderboard, labelled with its age, when the subgraph goes down", async () => {
    stubSubgraph([subgraphReply([{ id: addr(1), xp: "900" }, { id: addr(2), xp: "300" }], 1_000)]);
    head = 1_000;
    const first = await callRoute();
    expect(first.body.servedFrom).toBe("live");

    vi.resetModules();
    stubSubgraph([new Error("subgraph down")]);
    const { status, body } = await callRoute();
    expect(status).toBe(200);
    expect(body.servedFrom).toBe("last_known_good");
    expect(body.stale).toBe(true);
    expect(body.freshness.reason).toBe("subgraph_unavailable");
    expect(body.builtAt).toBe(first.body.builtAt);
    expect(body.entries.map((e: { xp: string }) => e.xp)).toEqual(["900", "300"]);
  });

  it("treats a set cut short by the time budget as unavailable, not as zeros", async () => {
    registry[addr(1)] = JSON.stringify({ address: addr(1), username: null, createdAt: 1, updatedAt: 1 });
    const realNow = Date.now();
    let calls = 0;
    // First Date.now() sets the deadline; every later call is past it.
    vi.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? realNow : realNow + 60_000));
    stubSubgraph([]);
    const { status, body } = await callRoute();
    expect(status).toBe(503);
    expect(body.entries).toEqual([]);
  });
});

describe("pagination", () => {
  it("pages the subgraph by id cursor and returns every player exactly once", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: addr(i + 1), xp: String(i + 1) }));
    const page2 = Array.from({ length: 5 }, (_, i) => ({ id: addr(1001 + i), xp: "1" }));
    const bodies = stubSubgraph([subgraphReply(page1), subgraphReply(page2)]);
    registry[addr(5000)] = JSON.stringify({ address: addr(5000), username: null, createdAt: 1, updatedAt: 1 });

    const { body } = await callRoute();
    expect(body.totalPlayers).toBe(1006);
    expect(body.totalPages).toBe(Math.ceil(1006 / 50));
    expect(JSON.parse(bodies[1]).query).toContain(`id_gt: "${addr(1000)}"`);

    // Walk every page through the cache and check no address repeats.
    const seen = new Set<string>();
    for (let p = 0; p < body.totalPages; p++) {
      const { body: pageBody } = await callRoute(`page=${p}`);
      for (const e of pageBody.entries) {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
      }
    }
    expect(seen.size).toBe(1006);
  });
});

describe("missing XP", () => {
  it("counts subgraph rows with no xp value instead of hiding them", async () => {
    stubSubgraph([subgraphReply([{ id: addr(1), xp: null }, { id: addr(2), xp: "10" }])]);
    const { body } = await callRoute();
    expect(body.diagnostics.missingXp).toBe(1);
    expect(body.totalPlayers).toBe(2);
  });

  it("shows registry-only players at 0 XP only when the subgraph was read in full", async () => {
    registry[addr(9)] = JSON.stringify({ address: addr(9), username: "new", createdAt: 1, updatedAt: 1 });
    stubSubgraph([subgraphReply([{ id: addr(1), xp: "10" }])]);
    const { body } = await callRoute();
    expect(body.servedFrom).toBe("live");
    expect(body.entries.find((e: { id: string }) => e.id === addr(9))).toMatchObject({ xp: "0" });
  });
});

describe("the saved (last-known-good) leaderboard is never replaced by worse data", () => {
  const LKG = "leaderboard:last-good:v1";
  async function seedGood() {
    stubSubgraph([subgraphReply([{ id: addr(1), xp: "900" }, { id: addr(2), xp: "300" }], 2_000)]);
    head = 2_000;
    await callRoute();
    vi.resetModules();
    return redisStore.get(LKG);
  }

  it("keeps it after a failed fetch", async () => {
    const saved = await seedGood();
    stubSubgraph([new Error("down")]);
    await callRoute();
    expect(redisStore.get(LKG)).toBe(saved);
  });

  it("keeps it after a fetch cut short by the time budget", async () => {
    const saved = await seedGood();
    const realNow = Date.now();
    let calls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? realNow : realNow + 60_000));
    stubSubgraph([]);
    await callRoute();
    expect(redisStore.get(LKG)).toBe(saved);
  });

  it("keeps it, and serves it, when the subgraph answers with no players", async () => {
    const saved = await seedGood();
    registry[addr(7)] = JSON.stringify({ address: addr(7), username: null, createdAt: 1, updatedAt: 1 });
    stubSubgraph([subgraphReply([], 2_100)]);
    const { body } = await callRoute();
    expect(redisStore.get(LKG)).toBe(saved);
    expect(body.servedFrom).toBe("last_known_good");
    expect(body.freshness.reason).toBe("subgraph_empty");
    expect(body.entries.map((e: { xp: string }) => e.xp)).toEqual(["900", "300"]);
  });

  it("keeps it when a complete build is indexed less far (an older subgraph)", async () => {
    const saved = await seedGood();
    stubSubgraph([subgraphReply([{ id: addr(3), xp: "5" }], 1_500)]);
    await callRoute();
    expect(redisStore.get(LKG)).toBe(saved);
  });

  it("does replace it with a complete build indexed at least as far", async () => {
    const saved = await seedGood();
    stubSubgraph([subgraphReply([{ id: addr(1), xp: "950" }], 2_050)]);
    await callRoute();
    expect(redisStore.get(LKG)).not.toBe(saved);
    expect(JSON.parse(redisStore.get(LKG)!).freshness.indexedBlock).toBe(2_050);
  });

  it("never writes the short-lived cache from a failed or empty build either", async () => {
    stubSubgraph([new Error("down")]);
    await callRoute();
    vi.resetModules();
    stubSubgraph([subgraphReply([], 10)]);
    await callRoute();
    expect(redisStore.has("leaderboard:merged:v2")).toBe(false);
  });
});
