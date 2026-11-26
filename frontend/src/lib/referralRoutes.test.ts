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
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from "viem";
import { CLAIMED_KEY, PAYOUTS_KEY, REFERRALS_KEY, adminLoginMessage, inviteListMessage, payoutRequestMessage } from "./referrals";
import { G_DOLLAR_ADDRESS } from "./constants";

// Well-known Hardhat dev keys: throwaway, never real funds.
const INVITER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const STRANGER = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const INVITER_ADDR = INVITER.address.toLowerCase();
const NEW_1 = "0x00000000000000000000000000000000000000a1";
const NEW_2 = "0x00000000000000000000000000000000000000a2";
const OLD_ON_CHAIN = "0x00000000000000000000000000000000000000c1";

const hashes = new Map<string, Map<string, string>>();
const strings = new Map<string, string>();
const h = (k: string) => (hashes.get(k) ?? hashes.set(k, new Map()).get(k)) as Map<string, string>;
const fakeRedis = {
  hGet: async (k: string, f: string) => h(k).get(f) ?? null,
  hSet: async (k: string, f: string | Record<string, string>, v?: string) => {
    if (typeof f === "string") h(k).set(f, v as string); else for (const [ff, vv] of Object.entries(f)) h(k).set(ff, vv);
  },
  hSetNX: async (k: string, f: string, v: string) => (h(k).has(f) ? false : (h(k).set(f, v), true)),
  hGetAll: async (k: string) => Object.fromEntries(h(k)),
  hmGet: async (k: string, fs: string[]) => fs.map((f) => h(k).get(f) ?? null),
  hDel: async (k: string, fs: string[]) => fs.reduce((n, f) => n + Number(h(k).delete(f)), 0),
  set: async (k: string, v: string, o?: { NX?: boolean }) => (o?.NX && strings.has(k) ? null : (strings.set(k, v), "OK")),
  del: async (k: string) => Number(strings.delete(k)),
  get: async (k: string) => strings.get(k) ?? null,
};
vi.mock("../../app/api/_lib/redis", () => ({ getRedis: async () => fakeRedis }));

/** Payment transactions on the fake chain, by hash. */
const receipts = new Map<string, { status: "success" | "reverted"; logs: unknown[] }>();
const ONE_G = 10n ** 18n;
/** A receipt whose logs are ERC-20 transfers (token, to, whole G$). */
function payment(hash: string, transfers: Array<{ to: string; g: bigint; token?: string }>, status: "success" | "reverted" = "success") {
  receipts.set(hash.toLowerCase(), {
    status,
    logs: transfers.map((t, i) => ({
      address: (t.token ?? G_DOLLAR_ADDRESS).toLowerCase(),
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: "0x6816E23A509A0c8ba9C5877Ca5209574e7e5e112", to: t.to as `0x${string}` } }),
      data: encodeAbiParameters([{ type: "uint256" }], [t.g * ONE_G]),
      blockNumber: 1n, blockHash: "0x" + "11".repeat(32), logIndex: i, transactionHash: hash, transactionIndex: 0, removed: false,
    })),
  });
  return hash;
}
const txh = (n: number) => "0x" + n.toString(16).padStart(64, "0");

/** GoodDollar-verified wallets; null makes every lookup "unknown". */
let verified: Set<string> | null = new Set();
/** Simulates a slow GoodDollar lookup. */
let verifyDelayMs = 0;
vi.mock("../../app/api/_lib/verification", () => ({
  getVerifications: async (addrs: string[]) => {
    if (verifyDelayMs) await new Promise((r) => setTimeout(r, verifyDelayMs));
    return Object.fromEntries(addrs.map((a) => [a.toLowerCase(), verified ? verified.has(a.toLowerCase()) : null]));
  },
}));

const row = (events: string[]): AddrRow => [1, 1, events.length, 0, events.reduce((m, e) => m | (1 << EVENT_BIT[e]), 0), "0"];
let addrs: Record<string, AddrRow> | null = {};
vi.mock("./stats/store", () => ({
  loadState: async () => (addrs ? { status: "ok", state: { addrs }, raw: "" } : { status: "unavailable", detail: "down" }),
}));
// Usernames aren't submitted in these tests, so the on-chain name check never runs; signature checks
// for smart-contract wallets report false.
vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createPublicClient: () => ({
    readContract: async () => "",
    verifyMessage: async () => false,
    getTransactionReceipt: async ({ hash }: { hash: string }) => {
      const r = receipts.get(hash.toLowerCase());
      if (!r) throw new Error(`Transaction receipt with hash "${hash}" could not be found.`);
      return r;
    },
  }),
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
  strings.clear();
  verified = new Set();
  verifyDelayMs = 0;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  receipts.clear();
  process.env.NEXT_PUBLIC_ADMIN_WALLETS = INVITER.address; // a test admin whose key the tests hold
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
    verified = new Set([NEW_1, NEW_2]);
    const one = await (await GET(req(`http://localhost/api/referrals?address=${INVITER.address}`))).json();
    expect(one).toMatchObject({ address: INVITER_ADDR, joined: 2, played: 1, verified: 2, eligible: 1 });
    expect(one.payout).toMatchObject({ rewardPerReferralG: 2635, minReferrals: 10, minAmountG: 26350, available: 1, pending: null });
    const top = await (await GET(req("http://localhost/api/referrals"))).json();
    expect(top.top).toEqual([{ address: INVITER_ADDR, username: null, joined: 2, played: 1, verified: 2 }]);
    expect(top.totals).toEqual({ inviters: 1, joined: 2, played: 1, verified: 2 });
  });

  it("a player nobody joined through has zero, and played is unknown (null) when activity can't be read", async () => {
    const { GET } = await import("../../app/api/referrals/route");
    expect(await (await GET(req(`http://localhost/api/referrals?address=${NEW_1}`))).json()).toMatchObject({ address: NEW_1, joined: 0, played: 0, verified: 0 });
    vi.resetModules(); addrs = null;
    const { GET: GET2 } = await import("../../app/api/referrals/route");
    expect((await (await GET2(req(`http://localhost/api/referrals?address=${NEW_1}`))).json()).played).toBeNull();
    await signIn(INVITER_ADDR); await signIn(NEW_1, INVITER.address); verified = null; vi.resetModules();
    const { GET: GET3 } = await import("../../app/api/referrals/route");
    expect((await (await GET3(req(`http://localhost/api/referrals?address=${INVITER.address}`))).json()).verified).toBeNull();
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
    expect(body.invitees[0]).toMatchObject({ address: NEW_1, played: false, verified: false, payout: null });
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
    expect(csv.split("\n")[0]).toBe("inviter,inviter_username,invitee,invitee_username,joined_at,played,verified,payout");
    expect(csv).toContain(`${INVITER_ADDR},,${NEW_1},`);
  });
});

// ── Referral payments ─────────────────────────────────────────────────────────

/** n invitees of INVITER recorded directly; `playedN` of them started a game, `verifiedN` are verified (both from the start). */
function seedInvitees(n: number, playedN: number, verifiedN: number): string[] {
  const list = Array.from({ length: n }, (_, i) => `0x${(0xd000 + i).toString(16).padStart(40, "0")}`);
  list.forEach((a, i) => {
    h(REFERRALS_KEY).set(a, JSON.stringify({ referrer: INVITER_ADDR, at: 1_000 + i }));
    if (i < playedN) (addrs as Record<string, AddrRow>)[a] = row(["SessionStarted"]);
    if (i < verifiedN) verified?.add(a);
  });
  return list;
}

async function requestPayout(signer = INVITER, payTo: string = INVITER.address, address: string = INVITER.address) {
  const issuedAt = new Date().toISOString();
  const signature = await signer.signMessage({ message: payoutRequestMessage(address, payTo, issuedAt) });
  const { POST } = await import("../../app/api/referrals/payout/route");
  const res = await POST(req("http://localhost/api/referrals/payout", { method: "POST", body: { address, payTo, issuedAt, signature } }));
  return { status: res.status, body: await res.json() };
}

const OWNER_KEY = "owner-key-for-tests";
async function admin(method: "GET" | "POST", body?: unknown, key = OWNER_KEY) {
  const { GET, POST } = await import("../../app/api/referrals/payouts/route");
  const r = req("http://localhost/api/referrals/payouts", { method, body, headers: key ? { authorization: `Bearer ${key}` } : {} });
  const res = method === "GET" ? await GET(r) : await POST(r);
  return { status: res.status, body: await res.json() };
}

describe("requesting a referral payment", () => {
  it("needs 10 referrals that have played AND are verified; fewer gets a clear message", async () => {
    seedInvitees(15, 15, 9); // 9 played and verified
    const { status, body } = await requestPayout();
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: "not_enough", eligible: 9, needed: 10 });
    expect(body.message).toMatch(/at least 10 referrals who have played and are verified/);
    expect(h(PAYOUTS_KEY).size).toBe(0);
  });

  it("played without verified (or verified without played) doesn't count", async () => {
    seedInvitees(20, 20, 0);
    expect((await requestPayout()).body.eligible).toBe(0);
  });

  it("with 12 eligible: saves a request for 31,620 G$, reserves those referrals and tells the owner on Telegram", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token"; process.env.TELEGRAM_CHAT_ID = "-100123";
    const sent: Array<{ url: string; body: { chat_id: string; text: string } }> = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); });
    const list = seedInvitees(20, 15, 12); // 12 played and verified
    const payTo = "0x00000000000000000000000000000000000000f1";
    const { status, body } = await requestPayout(INVITER, payTo);
    vi.unstubAllGlobals();
    expect(status).toBe(200);
    expect(body.request).toMatchObject({ count: 12, amountG: 31_620, payTo, status: "pending" });
    const saved = JSON.parse([...h(PAYOUTS_KEY).values()][0]);
    expect(saved).toMatchObject({ inviter: INVITER_ADDR, payTo, count: 12, snapshot: { joined: 20, played: 15, verified: 12, eligible: 12 } });
    expect(new Set(saved.invitees)).toEqual(new Set(list.slice(0, 12)));
    expect(h(CLAIMED_KEY).size).toBe(12);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.telegram.org/botbot-token/sendMessage");
    expect(sent[0].body.chat_id).toBe("-100123");
    expect(sent[0].body.text).toContain("31,620 G$ (12 × 2,635 G$)");
    expect(sent[0].body.text).toContain("20 joined · 15 played · 12 verified · 12 played and verified");
  });

  it("one pending request at a time, and the profile shows it", async () => {
    seedInvitees(10, 10, 10);
    expect((await requestPayout()).status).toBe(200);
    seedInvitees(10, 10, 10);
    const again = await requestPayout();
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("pending");
    const { GET } = await import("../../app/api/referrals/route");
    const counts = await (await GET(req(`http://localhost/api/referrals?address=${INVITER.address}`))).json();
    expect(counts.payout.pending).toMatchObject({ count: 10, amountG: 26_350 });
  });

  it("a request saved without Telegram set up still succeeds", async () => {
    seedInvitees(10, 10, 10);
    expect((await requestPayout()).status).toBe(200);
  });

  it("refuses someone else's signature, a bad payout wallet and an old signature", async () => {
    seedInvitees(10, 10, 10);
    expect((await requestPayout(STRANGER)).status).toBe(401);
    expect((await requestPayout(INVITER, "not-a-wallet")).status).toBe(400);
    expect((await requestPayout(INVITER, "0x0000000000000000000000000000000000000000")).status).toBe(400);
    const issuedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const signature = await INVITER.signMessage({ message: payoutRequestMessage(INVITER.address, INVITER.address, issuedAt) });
    const { POST } = await import("../../app/api/referrals/payout/route");
    const res = await POST(req("http://localhost/api/referrals/payout", { method: "POST", body: { address: INVITER.address, payTo: INVITER.address, issuedAt, signature } }));
    expect(res.status).toBe(401);
    expect(h(PAYOUTS_KEY).size).toBe(0);
  });

  it("a signature for one payout wallet can't be reused to send the money elsewhere", async () => {
    seedInvitees(10, 10, 10);
    const issuedAt = new Date().toISOString();
    const signature = await INVITER.signMessage({ message: payoutRequestMessage(INVITER.address, INVITER.address, issuedAt) });
    const { POST } = await import("../../app/api/referrals/payout/route");
    const res = await POST(req("http://localhost/api/referrals/payout", { method: "POST", body: { address: INVITER.address, payTo: STRANGER.address, issuedAt, signature } }));
    expect(res.status).toBe(401);
  });
});

describe("the owner's review", () => {
  it("refuses anyone without an admin session or the owner key", async () => {
    delete process.env.REFERRALS_EXPORT_SECRET;
    expect((await admin("GET")).status).toBe(401);
    process.env.REFERRALS_EXPORT_SECRET = OWNER_KEY;
    expect((await admin("GET", undefined, "wrong")).status).toBe(401);
    expect((await admin("POST", { id: "x", status: "paid" }, "")).status).toBe(401);
  });

  it("lists requests; rejecting releases the referrals so they can be requested again", async () => {
    process.env.REFERRALS_EXPORT_SECRET = OWNER_KEY;
    seedInvitees(10, 10, 10);
    await requestPayout();
    const list = await admin("GET");
    expect(list.body.pending).toBe(1);
    const id = list.body.requests[0].id;
    expect(list.body.requests[0].invitees).toHaveLength(10);
    const rejected = await admin("POST", { id, status: "rejected", note: "duplicate wallets" });
    expect(rejected.body.request).toMatchObject({ status: "rejected", note: "duplicate wallets" });
    expect(h(CLAIMED_KEY).size).toBe(0);
    expect((await admin("POST", { id, status: "paid", txHash: payment(txh(1), [{ to: INVITER.address, g: 26_350n }]) })).status).toBe(409); // already decided
    expect((await requestPayout()).status).toBe(200);
  });

  it("marking paid keeps those referrals used, and the profile shows what was paid", async () => {
    process.env.REFERRALS_EXPORT_SECRET = OWNER_KEY;
    seedInvitees(10, 10, 10);
    await requestPayout();
    const id = (await admin("GET")).body.requests[0].id;
    const tx = payment("0x" + "ab".repeat(32), [{ to: INVITER.address, g: 26_350n }]);
    expect((await admin("POST", { id, status: "paid", txHash: "0x123" })).status).toBe(400);
    expect((await admin("POST", { id, status: "paid" })).status).toBe(400); // proof of payment is required
    expect((await admin("POST", { id, status: "paid", txHash: tx })).body.request).toMatchObject({ status: "paid", txHash: tx });
    const next = await requestPayout();
    expect(next.status).toBe(409);
    expect(next.body.eligible).toBe(0);
    const { GET } = await import("../../app/api/referrals/route");
    const counts = await (await GET(req(`http://localhost/api/referrals?address=${INVITER.address}`))).json();
    expect(counts.payout).toMatchObject({ available: 0, pending: null, paid: { count: 10, amountG: 26_350 } });
    expect(counts.payout.lastDecision).toMatchObject({ status: "paid", count: 10, amountG: 26_350 });
    expect(counts.payout.lastDecision.txHash).toBeUndefined(); // private: only in the signed list
  });
});

describe("payment safety", () => {
  it("if saving the request fails, its referrals are released (nothing half-done)", async () => {
    seedInvitees(10, 10, 10);
    const realHSet = fakeRedis.hSet;
    fakeRedis.hSet = async (k: string, f: string | Record<string, string>, v?: string) => {
      if (k === PAYOUTS_KEY) throw new Error("redis write failed");
      return realHSet(k, f, v);
    };
    try {
      await expect(requestPayout()).rejects.toThrow("redis write failed");
    } finally {
      fakeRedis.hSet = realHSet;
    }
    expect(h(PAYOUTS_KEY).size).toBe(0);
    expect(h(CLAIMED_KEY).size).toBe(0);
    expect((await requestPayout()).status).toBe(200); // and the player can simply try again
  });

  it("marking paid re-marks its referrals as used, so they can never be paid twice", async () => {
    process.env.REFERRALS_EXPORT_SECRET = OWNER_KEY;
    seedInvitees(10, 10, 10);
    await requestPayout();
    h(CLAIMED_KEY).clear(); // simulate the reservation having been lost
    const id = (await admin("GET")).body.requests[0].id;
    await admin("POST", { id, status: "paid", txHash: payment(txh(2), [{ to: INVITER.address, g: 26_350n }]) });
    expect(h(CLAIMED_KEY).size).toBe(10);
    const again = await requestPayout();
    expect(again.status).toBe(409);
    expect(again.body.eligible).toBe(0);
  });

  it("two requests from the same player at the same moment: only one is created", async () => {
    seedInvitees(10, 10, 10);
    const [a, b] = await Promise.all([requestPayout(), requestPayout()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(h(PAYOUTS_KEY).size).toBe(1);
  });
});

// ── Admin sign-in and payment checks ──────────────────────────────────────────

async function adminSignIn(signer = INVITER, address: string = INVITER.address, issuedAt = new Date().toISOString()) {
  const signature = await signer.signMessage({ message: adminLoginMessage(address, issuedAt) });
  const { POST } = await import("../../app/api/admin/session/route");
  const res = await POST(req("http://localhost/api/admin/session", { method: "POST", body: { address, issuedAt, signature } }));
  return { status: res.status, body: await res.json() };
}

describe("admin sign-in", () => {
  it("the two owners' wallets are admins; other wallets aren't", async () => {
    delete process.env.NEXT_PUBLIC_ADMIN_WALLETS;
    const { isAdminWallet, ADMIN_WALLETS } = await import("../config/admins");
    expect(ADMIN_WALLETS).toEqual(["0x6816e23a509a0c8ba9c5877ca5209574e7e5e112", "0xcb6f72152db12546b21ef0dd5f614ca532531838"]);
    expect(isAdminWallet("0x6816E23A509A0c8ba9C5877Ca5209574e7e5e112")).toBe(true);
    expect(isAdminWallet("0xcb6f72152DB12546b21ef0dD5F614Ca532531838")).toBe(true);
    expect(isAdminWallet(STRANGER.address)).toBe(false);
    expect(isAdminWallet(undefined)).toBe(false);
  });

  it("on the live site no extra admin can be added through settings", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_ADMIN_WALLETS = STRANGER.address;
    vi.resetModules();
    const { ADMIN_WALLETS, isAdminWallet } = await import("../config/admins");
    vi.unstubAllEnvs();
    expect(ADMIN_WALLETS).toHaveLength(2);
    expect(isAdminWallet(STRANGER.address)).toBe(false);
  });

  it("an admin wallet that signs gets a session that opens the admin API", async () => {
    const { status, body } = await adminSignIn();
    expect(status).toBe(200);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.address).toBe(INVITER_ADDR);
    const list = await admin("GET", undefined, body.token);
    expect(list.status).toBe(200);
    expect(list.body.requests).toEqual([]);
  });

  it("refuses a wallet that isn't an admin, a signature from someone else, and an old signature", async () => {
    expect((await adminSignIn(STRANGER, STRANGER.address)).status).toBe(403);
    expect((await adminSignIn(STRANGER, INVITER.address)).status).toBe(403);
    expect((await adminSignIn(INVITER, INVITER.address, new Date(Date.now() - 60 * 60_000).toISOString())).status).toBe(401);
  });

  it("a made-up session token doesn't work, and only a hash of real tokens is stored", async () => {
    expect((await admin("GET", undefined, "ab".repeat(32))).status).toBe(401);
    const { body } = await adminSignIn();
    expect([...strings.keys()].some((k) => k.includes(body.token))).toBe(false);
  });

  it("a session stops working once that wallet is removed from the admin list", async () => {
    const { body } = await adminSignIn();
    process.env.NEXT_PUBLIC_ADMIN_WALLETS = "";
    vi.resetModules();
    expect((await admin("GET", undefined, body.token)).status).toBe(401);
  });

  it("records which admin marked a request paid", async () => {
    const { body } = await adminSignIn();
    seedInvitees(10, 10, 10);
    await requestPayout(INVITER, STRANGER.address);
    const id = (await admin("GET", undefined, body.token)).body.requests[0].id;
    const res = await admin("POST", { id, status: "paid", txHash: payment(txh(3), [{ to: STRANGER.address, g: 26_350n }]) }, body.token);
    expect(res.body.request).toMatchObject({ status: "paid", decidedBy: INVITER_ADDR, paidWei: (26_350n * ONE_G).toString() });
  });
});

describe("a payment is checked on Celo before it counts", () => {
  async function pendingRequest() {
    process.env.REFERRALS_EXPORT_SECRET = OWNER_KEY;
    seedInvitees(10, 10, 10);
    await requestPayout(INVITER, STRANGER.address); // paid to a different wallet
    return (await admin("GET")).body.requests[0].id as string;
  }
  const markPaid = (id: string, txHash: string) => admin("POST", { id, status: "paid", txHash });

  it("accepts a transfer of the full amount to the payout wallet (also split across transfers, or more)", async () => {
    const id = await pendingRequest();
    const res = await markPaid(id, payment(txh(10), [{ to: STRANGER.address, g: 20_000n }, { to: STRANGER.address, g: 6_400n }]));
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe("paid");
  });

  it("refuses a transaction that isn't on Celo yet, failed, or sent too little", async () => {
    const id = await pendingRequest();
    expect((await markPaid(id, txh(11))).body.reason).toBe("not_found");
    expect((await markPaid(id, payment(txh(12), [{ to: STRANGER.address, g: 26_350n }], "reverted"))).body.reason).toBe("failed");
    const little = await markPaid(id, payment(txh(13), [{ to: STRANGER.address, g: 26_349n }]));
    expect(little.status).toBe(422);
    expect(little.body.error).toMatch(/26,349 G\$ .* less than the 26,350 G\$ requested/);
  });

  it("refuses G$ sent to the wrong wallet, or another token sent to the right one", async () => {
    const id = await pendingRequest();
    expect((await markPaid(id, payment(txh(14), [{ to: INVITER.address, g: 26_350n }]))).body.reason).toBe("no_transfer");
    expect((await markPaid(id, payment(txh(15), [{ to: STRANGER.address, g: 26_350n, token: "0x00000000000000000000000000000000000000cc" }]))).body.reason).toBe("no_transfer");
    expect(JSON.parse([...h(PAYOUTS_KEY).values()][0]).status).toBe("pending"); // still pending
  });

  it("one transaction can't be the proof for two requests", async () => {
    const first = await pendingRequest();
    const tx = payment(txh(16), [{ to: STRANGER.address, g: 26_350n }]);
    expect((await markPaid(first, tx)).status).toBe(200);
    // A second inviter's request, "paid" with the same transaction
    const other = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
    const list = Array.from({ length: 10 }, (_, i) => `0x${(0xe000 + i).toString(16).padStart(40, "0")}`);
    list.forEach((a, i) => { h(REFERRALS_KEY).set(a, JSON.stringify({ referrer: other.address.toLowerCase(), at: i })); (addrs as Record<string, AddrRow>)[a] = row(["SessionStarted"]); verified?.add(a); });
    await requestPayout(other, STRANGER.address, other.address);
    const second = (await admin("GET")).body.requests.find((r: { status: string }) => r.status === "pending").id;
    const reused = await markPaid(second, tx);
    expect(reused.status).toBe(409);
    expect(reused.body.error).toMatch(/already the proof of payment/);
  });
});

// ── Review fixes ──────────────────────────────────────────────────────────────

describe("concurrency and privacy", () => {
  it("one referral can never be reserved by two requests", async () => {
    const { reserveInvitees } = await import("./referralStore");
    expect(await reserveInvitees(fakeRedis as never, ["0x1", "0x2", "0x3"], "req-A")).toBe(true);
    expect(await reserveInvitees(fakeRedis as never, ["0x4", "0x2"], "req-B")).toBe(false);
    expect(h(CLAIMED_KEY).get("0x4")).toBeUndefined(); // B's partial reservation was undone
    expect(h(CLAIMED_KEY).get("0x2")).toBe("req-A");
    expect(await reserveInvitees(fakeRedis as never, ["0x1"], "req-A")).toBe(true); // re-reserving your own is fine
  });

  it("a lock is released only by its holder", async () => {
    const { withLock } = await import("./referralStore");
    const result = await withLock(fakeRedis as never, "t", async () => {
      strings.set("payouts:v1:lock:t", "someone-else"); // the lock expired and someone else took it
      return "done";
    });
    expect(result).toBe("done");
    expect(strings.get("payouts:v1:lock:t")).toBe("someone-else");
    expect(await withLock(fakeRedis as never, "t", async () => "x")).toBe("busy");
  });

  it("a second admin can't decide a request while another is deciding it", async () => {
    process.env.REFERRALS_EXPORT_SECRET = OWNER_KEY;
    seedInvitees(10, 10, 10);
    await requestPayout();
    const id = (await admin("GET")).body.requests[0].id;
    strings.set(`payouts:v1:lock:decide:${id}`, "other-admin");
    const res = await admin("POST", { id, status: "rejected" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Another admin is deciding/);
    expect(JSON.parse([...h(PAYOUTS_KEY).values()][0]).status).toBe("pending");
  });

  it("the public counts never include the admins' note, the transaction or the payout wallet; the signed list does", async () => {
    process.env.REFERRALS_EXPORT_SECRET = OWNER_KEY;
    seedInvitees(10, 10, 10);
    await requestPayout(INVITER, STRANGER.address);
    const id = (await admin("GET")).body.requests[0].id;
    await admin("POST", { id, status: "rejected", note: "suspected duplicate wallets" });
    const { GET, POST } = await import("../../app/api/referrals/route");
    const pub = await (await GET(req(`http://localhost/api/referrals?address=${INVITER.address}`))).json();
    const text = JSON.stringify(pub);
    expect(text).not.toContain("suspected");
    expect(text).not.toContain(STRANGER.address.toLowerCase());
    expect(pub.payout.lastDecision).toMatchObject({ status: "rejected" });
    const issuedAt = new Date().toISOString();
    const signature = await INVITER.signMessage({ message: inviteListMessage(INVITER.address, issuedAt) });
    const priv = await (await POST(req("http://localhost/api/referrals", { method: "POST", body: { address: INVITER.address, issuedAt, signature } }))).json();
    expect(priv.lastDecision).toMatchObject({ status: "rejected", note: "suspected duplicate wallets", payTo: STRANGER.address.toLowerCase() });
  });

  it("a slow GoodDollar lookup makes the public counts say 'unknown' quickly instead of hanging", async () => {
    seedInvitees(3, 3, 3);
    verifyDelayMs = 8_000;
    const { GET } = await import("../../app/api/referrals/route");
    const started = Date.now();
    const top = await (await GET(req("http://localhost/api/referrals"))).json();
    expect(Date.now() - started).toBeLessThan(7_000);
    expect(top.totals.verified).toBeNull();
    expect(top.top[0]).toMatchObject({ joined: 3, played: 3, verified: null });
  }, 15_000);

  it("a wallet's 'cancel' is told apart from a wallet problem", async () => {
    const { isUserRejection } = await import("../hooks/useReferrals");
    expect(isUserRejection({ code: 4001, message: "x" })).toBe(true);
    expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true);
    expect(isUserRejection(new Error("User rejected the request."))).toBe(true);
    expect(isUserRejection(new Error("Internal JSON-RPC error."))).toBe(false);
    expect(isUserRejection(new Error("Session expired"))).toBe(false);
  });
});
