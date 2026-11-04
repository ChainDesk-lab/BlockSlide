/**
 * Input validation on /api/game/seed and /api/players. Redis and the RPC are
 * mocked; no network, no real data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";

// ── shared fakes ─────────────────────────────────────────────────────────────
const kv = new Map<string, string>();
const hash = new Map<string, string>();
const fakeRedis = {
  isOpen: true,
  on: () => fakeRedis,
  connect: async () => {},
  get: async (k: string) => kv.get(k) ?? null,
  setEx: async (k: string, _t: number, v: string) => void kv.set(k, v),
  hGet: async (_h: string, f: string) => hash.get(f) ?? null,
  hSet: async (_h: string, f: string, v: string) => void hash.set(f, v),
  hGetAll: async () => Object.fromEntries(hash),
};
vi.mock("redis", () => ({ createClient: () => fakeRedis }));
vi.mock("../../app/api/_lib/redis", () => ({ getRedis: async () => fakeRedis }));

let onChainName: string | Error = "";
/** Every RPC URL a route hands to viem's http() transport, in order. */
const httpUrls: (string | undefined)[] = [];
vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  http: (url?: string) => {
    httpUrls.push(url);
    return ({}) as unknown;
  },
  createPublicClient: () => ({
    readContract: async () => {
      if (onChainName instanceof Error) throw onChainName;
      return onChainName;
    },
  }),
}));

const ADDR = "0x00000000000000000000000000000000000000aa";
const SEED = ("0x" + "11".repeat(32)) as `0x${string}`;
const SEED_HASH = keccak256(SEED);
const OTHER_SEED = ("0x" + "22".repeat(32)) as `0x${string}`;

function post(body: unknown) {
  return new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  kv.clear();
  hash.clear();
  onChainName = "";
  process.env.REDIS_URL = "redis://fake";
});

// ── /api/game/seed ───────────────────────────────────────────────────────────
describe("POST /api/game/seed", () => {
  it("stores a seed that hashes to its seedHash", async () => {
    const { POST } = await import("../../app/api/game/seed/route");
    const res = await POST(post({ address: ADDR, seedHash: SEED_HASH, seed: SEED }) as any);
    expect(res.status).toBe(201);
  });

  it("rejects a seed that doesn't match seedHash, so a backup can't be overwritten with a wrong seed", async () => {
    const { POST, GET } = await import("../../app/api/game/seed/route");
    await POST(post({ address: ADDR, seedHash: SEED_HASH, seed: SEED }) as any);
    const attack = await POST(post({ address: ADDR, seedHash: SEED_HASH, seed: OTHER_SEED }) as any);
    expect(attack.status).toBe(400);

    const res = await GET(new Request(`http://localhost/api/game/seed?address=${ADDR}&seedHash=${SEED_HASH}`) as any);
    expect((await res.json()).seed).toBe(SEED);
  });

  it("rejects malformed seeds and hashes", async () => {
    const { POST } = await import("../../app/api/game/seed/route");
    expect((await POST(post({ address: ADDR, seedHash: SEED_HASH, seed: "0x" + "zz".repeat(32) }) as any)).status).toBe(400);
    expect((await POST(post({ address: ADDR, seedHash: "0x1234", seed: SEED }) as any)).status).toBe(400);
  });

  it("never returns a stored seed that doesn't match the requested hash (records written before this check)", async () => {
    const { GET } = await import("../../app/api/game/seed/route");
    kv.set(
      `game:seed:${ADDR}_${SEED_HASH}`,
      JSON.stringify({ address: ADDR, seedHash: SEED_HASH, seed: OTHER_SEED, createdAt: Date.now(), expiresAt: Date.now() + 60_000 }),
    );
    const res = await GET(new Request(`http://localhost/api/game/seed?address=${ADDR}&seedHash=${SEED_HASH}`) as any);
    expect(res.status).toBe(404);
  });
});

// ── /api/players ─────────────────────────────────────────────────────────────
describe("POST /api/players", () => {
  it("registers a wallet with no name, without any wallet signature (onboarding unchanged)", async () => {
    const { POST } = await import("../../app/api/players/route");
    const res = await POST(post({ address: ADDR }) as any);
    expect((await res.json()).profile).toMatchObject({ address: ADDR, username: null });
  });

  it("stores a submitted name when it matches the contract's username", async () => {
    onChainName = "alice_1";
    const { POST } = await import("../../app/api/players/route");
    const res = await POST(post({ address: ADDR, username: "alice_1" }) as any);
    expect((await res.json()).profile.username).toBe("alice_1");
  });

  it("does not let one wallet label another with an arbitrary name", async () => {
    onChainName = ""; // the target has no on-chain name
    const { POST } = await import("../../app/api/players/route");
    const res = await POST(post({ address: ADDR, username: "GoodDollar_Team" }) as any);
    expect((await res.json()).profile.username).toBeNull();
  });

  it("replaces a stale or spoofed registry name with the on-chain one", async () => {
    hash.set(ADDR, JSON.stringify({ address: ADDR, username: "spoofed", createdAt: 1, updatedAt: 1 }));
    onChainName = "realname";
    const { POST } = await import("../../app/api/players/route");
    const res = await POST(post({ address: ADDR, username: "spoofed" }) as any);
    expect((await res.json()).profile.username).toBe("realname");
  });

  it("accepts no submitted name when the on-chain check can't run, and keeps what it had", async () => {
    hash.set(ADDR, JSON.stringify({ address: ADDR, username: "known", createdAt: 1, updatedAt: 1 }));
    onChainName = new Error("rpc down");
    const { POST } = await import("../../app/api/players/route");
    const res = await POST(post({ address: ADDR, username: "attacker" }) as any);
    const body = await res.json();
    expect(body.profile.username).toBe("known");
  });
});

// The RPC list is read once, when the route module loads, so each case loads it afresh.
describe("POST /api/players: CELO_RPC_URLS", () => {
  const saved = process.env.CELO_RPC_URLS;
  afterEach(() => {
    if (saved === undefined) delete process.env.CELO_RPC_URLS;
    else process.env.CELO_RPC_URLS = saved;
  });

  /** The RPC URLs the route uses for its on-chain username check under `value`. */
  async function rpcUrlsFor(value: string | undefined): Promise<(string | undefined)[]> {
    if (value === undefined) delete process.env.CELO_RPC_URLS;
    else process.env.CELO_RPC_URLS = value;
    vi.resetModules();
    const { POST } = await import("../../app/api/players/route");
    httpUrls.length = 0;
    onChainName = "alice_1";
    const res = await POST(post({ address: ADDR, username: "alice_1" }) as any);
    expect((await res.json()).profile.username).toBe("alice_1"); // the lookup still works
    return [...httpUrls];
  }

  it("an empty value falls back to forno instead of leaving no RPC at all", async () => {
    expect(await rpcUrlsFor("")).toEqual(["https://forno.celo.org"]);
  });

  it("blank or separator-only values fall back to forno too", async () => {
    expect(await rpcUrlsFor("   ")).toEqual(["https://forno.celo.org"]);
    expect(await rpcUrlsFor(" , ,")).toEqual(["https://forno.celo.org"]);
  });

  it("unset falls back to forno (unchanged)", async () => {
    expect(await rpcUrlsFor(undefined)).toEqual(["https://forno.celo.org"]);
  });

  it("configured URLs are used as given, trimmed and in order (unchanged)", async () => {
    expect(await rpcUrlsFor(" https://rpc-a.example , https://rpc-b.example,")).toEqual(["https://rpc-a.example", "https://rpc-b.example"]);
  });
});
