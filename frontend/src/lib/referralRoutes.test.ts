/**
 * Invite links end to end through the routes: recording at sign-in (/api/players), public counts
 * and the signed invitee list (/api/referrals), and the owner export. Redis, the stats aggregate
 * and the chain are faked; nothing touches the network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { EVENT_BIT } from "./stats/config";
import type { AddrRow } from "./stats/state";
import { REFERRALS_KEY, inviteListMessage } from "./referrals";

// Well-known Hardhat dev keys: throwaway, never real funds.
const INVITER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const STRANGER = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const INVITER_ADDR = INVITER.address.toLowerCase();
const NEW_1 = "0x00000000000000000000000000000000000000a1";
const NEW_2 = "0x00000000000000000000000000000000000000a2";
const OLD_ON_CHAIN = "0x00000000000000000000000000000000000000c1";

const hashes = new Map<string, Map<string, string>>();
const h = (k: string) => (hashes.get(k) ?? hashes.set(k, new Map()).get(k)) as Map<string, string>;
const fakeRedis = {
  hGet: async (k: string, f: string) => h(k).get(f) ?? null,
  hSet: async (k: string, f: string, v: string) => void h(k).set(f, v),
  hSetNX: async (k: string, f: string, v: string) => (h(k).has(f) ? false : (h(k).set(f, v), true)),
  hGetAll: async (k: string) => Object.fromEntries(h(k)),
  hmGet: async (k: string, fs: string[]) => fs.map((f) => h(k).get(f) ?? null),
};
vi.mock("../../app/api/_lib/redis", () => ({ getRedis: async () => fakeRedis }));

const row = (events: string[]): AddrRow => [1, 1, events.length, 0, events.reduce((m, e) => m | (1 << EVENT_BIT[e]), 0), "0"];
let addrs: Record<string, AddrRow> | null = {};
vi.mock("./stats/store", () => ({
  loadState: async () => (addrs ? { status: "ok", state: { addrs }, raw: "" } : { status: "unavailable", detail: "down" }),
}));
// Usernames aren't submitted in these tests, so the on-chain name check never runs; signature checks
// for smart-contract wallets report false.
vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createPublicClient: () => ({ readContract: async () => "", verifyMessage: async () => false }),
}));

const req = (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
  new NextRequest(url, { method: init?.method ?? "GET", body: init?.body ? JSON.stringify(init.body) : undefined, headers: { "content-type": "application/json", ...init?.headers } });

async function signIn(address: string, ref?: string) {
  const { POST } = await import("../../app/api/players/route");
  const res = await POST(req("http://localhost/api/players", { method: "POST", body: { address, ...(ref !== undefined ? { ref } : {}) } }));
  return (await res.json()) as { ok: boolean; referral?: string };
}

beforeEach(() => {
  vi.resetModules();
  hashes.clear();
  addrs = { [INVITER_ADDR]: row(["SessionStarted", "ScoreSubmitted"]), [OLD_ON_CHAIN]: row(["UsernameSet"]) };
  delete process.env.REFERRALS_EXPORT_SECRET;
});

describe("recording at sign-in", () => {
  it("records a brand-new wallet that arrived through a player's link", async () => {
    expect((await signIn(NEW_1, INVITER.address)).referral).toBe("recorded");
    expect(JSON.parse(h(REFERRALS_KEY).get(NEW_1) as string)).toMatchObject({ referrer: INVITER_ADDR });
  });

  it("only the first sign-in can record, and the first invite is permanent", async () => {
    await signIn(NEW_1, INVITER.address);
    const before = h(REFERRALS_KEY).get(NEW_1);
    expect((await signIn(NEW_1, STRANGER.address)).referral).toBe("not_new");
    expect(h(REFERRALS_KEY).get(NEW_1)).toBe(before);
  });

  it("never claims an existing player", async () => {
    await signIn(NEW_2); // signed in before, without a link
    expect((await signIn(NEW_2, INVITER.address)).referral).toBe("not_new");
    expect((await signIn(OLD_ON_CHAIN, INVITER.address)).referral).toBe("not_new"); // active on chain, never signed in
    expect(h(REFERRALS_KEY).size).toBe(0);
  });

  it("rejects self-invites, unknown inviters and malformed refs", async () => {
    expect((await signIn(INVITER_ADDR, INVITER.address)).referral).toBe("self");
    expect((await signIn(NEW_1, STRANGER.address)).referral).toBe("unknown_referrer");
    expect((await signIn(NEW_2, "not-an-address")).referral).toBe("invalid");
    expect(h(REFERRALS_KEY).size).toBe(0);
  });

  it("an inviter who has only signed in (no games yet) still counts as known", async () => {
    addrs = {};
    await signIn(STRANGER.address);
    expect((await signIn(NEW_1, STRANGER.address)).referral).toBe("recorded");
  });

  it("keeps working from the sign-in list alone when wallet activity can't be read", async () => {
    addrs = null;
    await signIn(INVITER_ADDR);
    expect((await signIn(NEW_1, INVITER.address)).referral).toBe("recorded");
  });

  it("a sign-in without a link is unchanged", async () => {
    const res = await signIn(NEW_1);
    expect(res.ok).toBe(true);
    expect(res.referral).toBeUndefined();
  });
});

describe("public counts", () => {
  it("joined counts every recorded invite; played only those who started a game", async () => {
    await signIn(NEW_1, INVITER.address);
    await signIn(NEW_2, INVITER.address);
    addrs = { ...addrs, [NEW_1]: row(["SessionStarted"]) };
    vi.resetModules(); // drop the cached wallet activity
    const { GET } = await import("../../app/api/referrals/route");
    const one = await (await GET(req(`http://localhost/api/referrals?address=${INVITER.address}`))).json();
    expect(one).toEqual({ address: INVITER_ADDR, joined: 2, played: 1 });
    const top = await (await GET(req("http://localhost/api/referrals"))).json();
    expect(top.top).toEqual([{ address: INVITER_ADDR, username: null, joined: 2, played: 1 }]);
    expect(top.totals).toEqual({ inviters: 1, joined: 2, played: 1 });
  });

  it("a player nobody joined through has zero, and played is unknown (null) when activity can't be read", async () => {
    const { GET } = await import("../../app/api/referrals/route");
    expect(await (await GET(req(`http://localhost/api/referrals?address=${NEW_1}`))).json()).toEqual({ address: NEW_1, joined: 0, played: 0 });
    vi.resetModules(); addrs = null;
    const { GET: GET2 } = await import("../../app/api/referrals/route");
    expect((await (await GET2(req(`http://localhost/api/referrals?address=${NEW_1}`))).json()).played).toBeNull();
  });
});

describe("the invitee list is shown only to the inviter", () => {
  async function list(signer: typeof INVITER, address: string, issuedAt = new Date().toISOString()) {
    const signature = await signer.signMessage({ message: inviteListMessage(address, issuedAt) });
    const { POST } = await import("../../app/api/referrals/route");
    const res = await POST(req("http://localhost/api/referrals", { method: "POST", body: { address, issuedAt, signature } }));
    return { status: res.status, body: await res.json() };
  }

  it("returns the inviter's own invitees with a valid signature", async () => {
    await signIn(NEW_1, INVITER.address);
    const { status, body } = await list(INVITER, INVITER.address);
    expect(status).toBe(200);
    expect(body.invitees).toHaveLength(1);
    expect(body.invitees[0]).toMatchObject({ address: NEW_1, played: false });
  });

  it("refuses someone else's signature for the inviter's wallet", async () => {
    await signIn(NEW_1, INVITER.address);
    expect((await list(STRANGER, INVITER.address)).status).toBe(401);
  });

  it("refuses an old signature", async () => {
    expect((await list(INVITER, INVITER.address, new Date(Date.now() - 60 * 60_000).toISOString())).status).toBe(401);
  });
});

describe("owner export", () => {
  const exp = async (headers: Record<string, string> = {}, q = "") => {
    const { GET } = await import("../../app/api/referrals/export/route");
    return GET(req(`http://localhost/api/referrals/export${q}`, { headers }));
  };

  it("is off until the secret is set, and refuses a wrong key", async () => {
    expect((await exp({ authorization: "Bearer anything" })).status).toBe(503);
    process.env.REFERRALS_EXPORT_SECRET = "correct-horse-battery-staple";
    expect((await exp()).status).toBe(401);
    expect((await exp({ authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("lists every invite as JSON or CSV with the right key", async () => {
    await signIn(NEW_1, INVITER.address);
    process.env.REFERRALS_EXPORT_SECRET = "correct-horse-battery-staple";
    const auth = { authorization: "Bearer correct-horse-battery-staple" };
    const json = await (await exp(auth)).json();
    expect(json.count).toBe(1);
    expect(json.invites[0]).toMatchObject({ inviter: INVITER_ADDR, invitee: NEW_1, played: false });
    const csv = await (await exp(auth, "?format=csv")).text();
    expect(csv.split("\n")[0]).toBe("inviter,inviter_username,invitee,invitee_username,joined_at,played");
    expect(csv).toContain(`${INVITER_ADDR},,${NEW_1},`);
  });
});
