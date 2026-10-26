/**
 * /api/fund-wallet is off by default and bounded when on. Redis and the chain
 * are mocked: no CELO moves, no key is real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

// Throwaway test keys (well-known Hardhat dev keys), never real funds.
const FUNDER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const OTHER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const kv = new Map<string, string>();
let redisUp = true;
const fakeRedis = {
  get: async (k: string) => kv.get(k) ?? null,
  set: async (k: string, v: string, opts?: { NX?: boolean }) => {
    if (opts?.NX && kv.has(k)) return null;
    kv.set(k, v);
    return "OK";
  },
  del: async (k: string) => void kv.delete(k),
  incr: async (k: string) => {
    const n = Number(kv.get(k) ?? 0) + 1;
    kv.set(k, String(n));
    return n;
  },
  expire: async () => true,
};
vi.mock("../../app/api/_lib/redis", () => ({ getRedis: async () => (redisUp ? fakeRedis : null) }));

let chain = { nonce: 0, balance: 0n, owner: "0x000000000000000000000000000000000000beef" };
const sent: Array<{ to: string; value: bigint }> = [];
vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createPublicClient: () => ({
    getTransactionCount: async () => chain.nonce,
    getBalance: async () => chain.balance,
    readContract: async () => chain.owner,
  }),
  createWalletClient: () => ({
    sendTransaction: async (tx: { to: string; value: bigint }) => {
      sent.push(tx);
      return "0x" + "ab".repeat(32);
    },
  }),
}));

const ADDR = "0x00000000000000000000000000000000000000aa";
function post(body: unknown, ip = "1.2.3.4") {
  return new Request("http://localhost/api/fund-wallet", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
}
async function call(body: unknown = { address: ADDR, email: "x@y.z" }, ip?: string) {
  const { POST } = await import("../../app/api/fund-wallet/route");
  const res = await POST(post(body, ip) as any);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.resetModules();
  kv.clear();
  sent.length = 0;
  redisUp = true;
  chain = { nonce: 0, balance: 0n, owner: "0x000000000000000000000000000000000000beef" };
  process.env.FUND_WALLET_ENABLED = "true";
  process.env.GAS_FUNDER_PRIVATE_KEY = FUNDER_KEY;
  delete process.env.FUNDING_WALLET_PRIVATE_KEY;
  delete process.env.FUND_WALLET_DAILY_CAP;
});

describe("POST /api/fund-wallet", () => {
  it("is disabled unless FUND_WALLET_ENABLED=true, and then sends nothing", async () => {
    delete process.env.FUND_WALLET_ENABLED;
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  it("never uses the old FUNDING_WALLET_PRIVATE_KEY", async () => {
    delete process.env.GAS_FUNDER_PRIVATE_KEY;
    process.env.FUNDING_WALLET_PRIVATE_KEY = FUNDER_KEY;
    const { status } = await call();
    expect(status).toBe(503);
    expect(sent).toEqual([]);
  });

  it("refuses to sign with the contract owner's key", async () => {
    chain.owner = privateKeyToAccount(FUNDER_KEY).address;
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.error).toMatch(/misconfigured/);
    expect(sent).toEqual([]);
  });

  it("funds a brand-new wallet once, and never twice (durable, not in-memory)", async () => {
    const first = await call();
    expect(first.body).toMatchObject({ success: true, amount: "0.05" });
    vi.resetModules(); // a fresh serverless instance
    const second = await call(undefined, "5.6.7.8");
    expect(second.body.alreadyFunded).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("skips wallets that already transacted or hold gas", async () => {
    chain.nonce = 3;
    expect((await call()).body.txHash).toBeNull();
    chain.nonce = 0;
    chain.balance = 10n ** 17n;
    expect((await call(undefined, "9.9.9.9")).body.txHash).toBeNull();
    expect(sent).toEqual([]);
  });

  it("stops at the daily cap", async () => {
    process.env.FUND_WALLET_DAILY_CAP = "2";
    const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
    const results = [];
    for (let i = 1; i <= 3; i++) results.push((await call({ address: addr(i) }, `10.0.0.${i}`)).status);
    expect(results).toEqual([200, 200, 429]);
    expect(sent).toHaveLength(2);
  });

  it("limits requests per IP", async () => {
    const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
    const statuses = [];
    for (let i = 1; i <= 4; i++) statuses.push((await call({ address: addr(i) }, "7.7.7.7")).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("fails closed when Redis is unavailable", async () => {
    redisUp = false;
    expect((await call()).status).toBe(503);
    expect(sent).toEqual([]);
  });

  it("rejects malformed addresses", async () => {
    expect((await call({ address: "0x123" })).status).toBe(400);
  });

  it("a different (non-owner) funder key works", async () => {
    process.env.GAS_FUNDER_PRIVATE_KEY = OTHER_KEY;
    expect((await call()).body.success).toBe(true);
  });
});

describe("GET /api/fund-wallet", () => {
  it("reports only whether funding is enabled", async () => {
    delete process.env.FUND_WALLET_ENABLED;
    const { GET } = await import("../../app/api/fund-wallet/route");
    expect(await (await GET()).json()).toEqual({ enabled: false });
  });
});
