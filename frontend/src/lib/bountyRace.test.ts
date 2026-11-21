/**
 * Season 5 Leaderboard Race: configuration, exact WAT boundaries (start inclusive, end exclusive)
 * for status, blocks, XP and purchases, the fresh leaderboard beside the main one, qualifying
 * purchases counted per transaction, eligibility walked past the top 50, and RPC failures that must
 * never produce a final result. Chain reads are faked; nothing here touches the network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicClient } from "viem";
import { bounties, getBountyStatus } from "../config/bounties";
import { scheduleProblems } from "./bountySchedule";
import { rankStandings, toPublicBounty, publicStandings, type PlayerSnapshot } from "./bountyStandings";
import {
  PURCHASE_TOPICS, addPurchaseLogs, eligibleWinners, evaluateEligibility, fmtPrizeUsd, ordinal, prizePoolUsd, purchaseCounts,
  type EntryEligibility, type PurchaseEntry, type PurchaseLog,
} from "./bountyEligibility";
import { bountyPurchases, goodDollarVerification, resetEligibilityCaches } from "./bountyEligibilityChain";
import { clearBlockCache, firstBlockAtOrAfter } from "./blockResolver";
import { buildOrderedLeaderboard } from "./leaderboard";
import { BountyStandings, EligibilityList, PrizeTable, fmtBountyWindow } from "../components/BountyPanels";
import { GAME2048_ADDRESS } from "./constants";

const race = bounties.find((b) => b.id === "bounty-4")!;
const RULES = race.rules!;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const word = (v: bigint) => v.toString(16).padStart(64, "0");
const topicOf = (a: string) => `0x${a.slice(2).padStart(64, "0")}`;
const OTHER_TOPIC = "0x" + "ab".repeat(32); // e.g. XpEarned or RewardPaid: not a purchase
const START_TS = Date.parse("2026-11-21T12:00:00Z") / 1000; // 13:00:00 WAT
const G = 10n ** 18n;

/** A purchase log as eth_getLogs returns it. `kind`: 0 shield, 1 boost, 2 undo, 3 cosmetic. */
function purchase(block: number, logIndex: number, buyer: string, o: { kind?: number; price?: bigint; tx?: string; removed?: boolean } = {}): PurchaseLog {
  const kind = o.kind ?? 0, price = o.price ?? 500n * G;
  const body = kind === 1 ? [2n, 999n, price] : kind === 3 ? [price] : [1n, price];
  const topics = kind === 3 ? [PURCHASE_TOPICS[3], topicOf(buyer), `0x${word(1n)}`] : [PURCHASE_TOPICS[kind], topicOf(buyer)];
  return {
    address: GAME2048_ADDRESS, topics, data: `0x${body.map(word).join("")}`, blockNumber: BigInt(block), logIndex,
    transactionHash: o.tx ?? `0x${word(BigInt(block * 1000 + logIndex))}`, ...(o.removed ? { removed: true } : {}),
  };
}

describe("Race configuration", () => {
  it("runs from 13:00:00 WAT on 21 Nov 2026 to 13:00:00 WAT on 26 Nov 2026, with an exact window, after every earlier bounty", () => {
    expect(race.title).toBe("Season 5 Leaderboard Race");
    expect(race.startTime).toBe("2026-11-21T12:00:00Z");
    expect(race.endTime).toBe("2026-11-26T12:00:00Z");
    expect(race.exactWindow).toBe(true);
    expect(Date.parse(race.endTime) - Date.parse(race.startTime)).toBe(5 * 24 * 3600 * 1000);
    expect(bounties.indexOf(race)).toBe(bounties.length - 1);
    expect(scheduleProblems(bounties)).toEqual([]);
    expect(fmtBountyWindow(toPublicBounty(race, 3, "live", { phase: "upcoming" }))).toBe("21 Nov 2026, 13:00 – 26 Nov 2026, 13:00 WAT");
  });

  it("has the five dollar-equivalent prizes, $30 in total, shown as amounts in G$ rather than token quantities", () => {
    expect(race.prizeTable).toEqual([{ place: 1, usd: 10 }, { place: 2, usd: 7 }, { place: 3, usd: 5 }, { place: 4, usd: 5 }, { place: 5, usd: 3 }]);
    expect(prizePoolUsd(race.prizeTable!)).toBe(30);
    const html = renderToStaticMarkup(createElement(PrizeTable, { table: race.prizeTable! }));
    for (const s of ["1st", "2nd", "3rd", "4th", "5th", "$10 equivalent in G$", "$7 equivalent in G$", "$3 equivalent in G$", "Prize pool: $30 equivalent in G$"]) expect(html).toContain(s);
    expect(html).not.toMatch(/\d[\d,.]*\s*G\$/); // never "1,234 G$"
    expect([1, 2, 3, 4, 5, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "5th", "11th", "12th", "13th", "21st", "22nd"]);
  });

  it("lists the four requirements and says which ones the team checks", () => {
    expect(race.eligibility!.map((e) => [e.text, e.check])).toEqual([
      ["Follow @ImmanuelOlivia1 on X", "team"],
      ["Be GoodDollar verified", "on-chain"],
      ["Complete at least 10 qualifying BlockSlide Shop purchases during the race", "on-chain"],
      ["Finish in the top five eligible players on the race leaderboard", "leaderboard"],
    ]);
    expect(RULES).toEqual({ goodDollarVerified: true, minPurchases: 10, manualChecks: ["Follows @ImmanuelOlivia1 on X"] });
    const html = renderToStaticMarkup(createElement(EligibilityList, { items: race.eligibility! }));
    expect(html).toContain("Checked by the team");
    expect(html).toContain("Checked on-chain");
  });
});

// ── Boundaries: start inclusive, end exclusive ──────────────────────────────────

describe("Race status at the exact WAT boundaries", () => {
  const wat = (s: string) => new Date(`${s}+01:00`); // WAT is UTC+1, no daylight saving
  it("is upcoming until 13:00:00 WAT on 21 Nov, live from that instant, and ended from 13:00:00 WAT on 26 Nov", () => {
    expect(getBountyStatus(race, wat("2026-11-21T12:59:59.999"))).toBe("upcoming");
    expect(getBountyStatus(race, wat("2026-11-21T13:00:00.000"))).toBe("live"); // start inclusive
    expect(getBountyStatus(race, wat("2026-11-26T12:59:59.999"))).toBe("live");
    expect(getBountyStatus(race, wat("2026-11-26T13:00:00.000"))).toBe("ended"); // end exclusive
  });

  it("leaves the earlier bounties' rule alone: their end instant is still live", () => {
    const b3 = bounties[2];
    expect(b3.exactWindow).toBeUndefined();
    expect(getBountyStatus(b3, new Date(b3.endTime))).toBe("live");
  });
});

describe("Exact boundary blocks", () => {
  afterEach(() => clearBlockCache());
  /** Block n has timestamps[n]; the last entry is the head. */
  const chain = (timestamps: number[]) => ({
    getBlock: vi.fn(async (args?: { blockNumber?: bigint }) => {
      const n = args?.blockNumber ?? BigInt(timestamps.length - 1);
      return { number: n, timestamp: BigInt(timestamps[Number(n)]) };
    }),
  }) as unknown as PublicClient;
  const oneSecondBlocks = Array.from({ length: 400 }, (_, i) => START_TS - 200 + i); // block 200 is exactly 13:00:00 WAT

  it("finds the first block at or after the time, including a block stamped exactly at it", async () => {
    expect(await firstBlockAtOrAfter(chain(oneSecondBlocks), new Date("2026-11-21T12:00:00Z"))).toBe(200n);
  });

  it("takes the next block when none is stamped exactly at the time, and rounds milliseconds up", async () => {
    const gap = oneSecondBlocks.filter((t) => t !== START_TS); // block 200 is now 13:00:01
    expect(await firstBlockAtOrAfter(chain(gap), new Date("2026-11-21T12:00:00Z"))).toBe(200n);
    clearBlockCache();
    expect(await firstBlockAtOrAfter(chain(oneSecondBlocks), new Date("2026-11-21T12:00:00.500Z"))).toBe(201n);
  });

  it("refuses a time the chain hasn't reached", async () => {
    await expect(firstBlockAtOrAfter(chain(oneSecondBlocks), new Date("2026-11-26T12:00:00Z"))).rejects.toThrow(/hasn't reached/);
  });
});

// ── The fresh board beside the main one ────────────────────────────────────────

describe("Fresh race leaderboard beside the unchanged main leaderboard", () => {
  const start = new Map<string, PlayerSnapshot>([
    [addr(1), { id: addr(1), xp: 50_000n, username: "Veteran", firstSeen: 1 }],
    [addr(3), { id: addr(3), xp: 90_000n, username: "Resting", firstSeen: 3 }],
  ]);
  const now = new Map<string, PlayerSnapshot>([
    [addr(1), { id: addr(1), xp: 50_900n, username: "Veteran", firstSeen: 1 }],
    [addr(2), { id: addr(2), xp: 1_200n, username: "Newcomer", firstSeen: 2 }],
    [addr(3), { id: addr(3), xp: 90_000n, username: "Resting", firstSeen: 3 }],
  ]);

  it("starts everyone at 0 and counts only XP earned since the start", () => {
    expect(rankStandings(start, start)).toEqual([]);
    expect(rankStandings(start, now).map((r) => [r.username, r.bountyXp])).toEqual([["Newcomer", 1_200n], ["Veteran", 900n]]);
  });

  it("the main leaderboard still ranks by full cumulative XP, and race XP shows up there too", () => {
    const main = buildOrderedLeaderboard(
      [...now.values()].map((p) => ({ id: p.id, xp: p.xp.toString(), username: p.username, firstSeen: p.firstSeen })),
      [],
      Object.fromEntries([...now.keys()].map((k) => [k, true])),
    );
    expect(main.map((p) => [p.username, p.xp])).toEqual([["Resting", "90000"], ["Veteran", "50900"], ["Newcomer", "1200"]]);
    rankStandings(start, now);
    expect(now.get(addr(1))!.xp).toBe(50_900n); // the race board never writes to the snapshots
  });
});

// ── Qualifying purchases: per transaction ─────────────────────────────────────

describe("Qualifying purchases are counted per successful paid transaction", () => {
  const window = { fromBlock: 1_000n, toBlock: 1_999n }; // first race block .. last block before the end
  const alice = addr(0xa1), bob = addr(0xb0);
  const count = (logs: PurchaseLog[], w = window) => {
    const seen = new Map<string, PurchaseEntry>();
    addPurchaseLogs(seen, logs, GAME2048_ADDRESS, w);
    return purchaseCounts(seen, w);
  };

  it("one transaction counts once, however many items it bought", () => {
    const tx = "0x" + "11".repeat(32);
    const logs = [purchase(1_100, 0, alice, { kind: 0, tx }), purchase(1_100, 1, alice, { kind: 1, tx }), purchase(1_100, 2, alice, { kind: 2, tx }), purchase(1_100, 3, alice, { kind: 3, tx })];
    expect(count(logs).get(alice)).toBe(1);
  });

  it("separate successful transactions each count once, for every Shop item type", () => {
    expect(count([0, 1, 2, 3].map((k, i) => purchase(1_200 + i, 0, bob, { kind: k }))).get(bob)).toBe(4);
  });

  it("free claims (price 0), non-purchase events and other contracts count zero", () => {
    const logs = [
      purchase(1_300, 0, alice, { price: 0n }),
      purchase(1_301, 0, alice, { kind: 3, price: 0n }),
      { ...purchase(1_302, 0, alice), topics: [OTHER_TOPIC, topicOf(alice)] },
      { ...purchase(1_303, 0, alice), address: addr(0xdead) },
    ];
    expect(count(logs).get(alice)).toBeUndefined();
  });

  it("failed purchases count zero: a reverted transaction leaves no logs, and a log a reorg removed is ignored", () => {
    // The scan only ever sees logs of successful transactions; here bob's second purchase failed.
    expect(count([purchase(1_400, 0, bob), purchase(1_401, 0, bob, { removed: true })]).get(bob)).toBe(1);
  });

  it("a log read twice is stored once", () => {
    const seen = new Map<string, PurchaseEntry>();
    const logs = [purchase(1_500, 0, alice), purchase(1_501, 4, alice)];
    expect(addPurchaseLogs(seen, logs, GAME2048_ADDRESS, window)).toBe(2);
    expect(addPurchaseLogs(seen, logs, GAME2048_ADDRESS, window)).toBe(0);
    expect(purchaseCounts(seen).get(alice)).toBe(2);
  });

  it("start inclusive, end exclusive: the first race block counts, the first block at the end doesn't", () => {
    const logs = [purchase(999, 0, alice), purchase(1_000, 0, alice), purchase(1_999, 0, alice), purchase(2_000, 0, alice)];
    expect(count(logs, { fromBlock: 0n, toBlock: 9_999n }).get(alice)).toBe(4);
    expect(count(logs).get(alice)).toBe(2); // blocks 1,000 and 1,999
  });
});

describe("Purchase scan against the chain (faked)", () => {
  afterEach(() => resetEligibilityCaches());
  const buyer = addr(0xc0);

  function fakeClient(logs: PurchaseLog[], opts: { dropFirstRead?: boolean; failFrom?: bigint } = {}) {
    let reads = 0;
    const request = vi.fn(async ({ params }: { params: [{ fromBlock: string; toBlock: string }] }) => {
      const from = BigInt(params[0].fromBlock), to = BigInt(params[0].toBlock);
      if (opts.failFrom !== undefined && from >= opts.failFrom) throw new Error("rpc down");
      reads++;
      if (opts.dropFirstRead && reads === 1) return []; // a public RPC silently returning nothing
      return logs.filter((l) => BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to);
    });
    return { client: { request } as unknown as PublicClient, request };
  }
  const three = [purchase(1_000, 0, buyer), purchase(6_500, 1, buyer), purchase(12_000, 2, buyer)];

  it("reads 5,000-block chunks twice and merges them, so a dropped read loses nothing and nothing doubles", async () => {
    const { client, request } = fakeClient(three, { dropFirstRead: true });
    const scan = await bountyPurchases(client, "race", { fromBlock: 1_000n, toBlock: 12_000n });
    expect(scan.complete).toBe(true);
    expect(scan.counts.get(buyer)).toBe(3);
    expect(request).toHaveBeenCalledTimes(3 * 2);
  });

  it("continues from where it stopped, and never skips a range that failed", async () => {
    let scan = await bountyPurchases(fakeClient(three, { failFrom: 11_000n }).client, "race", { fromBlock: 1_000n, toBlock: 12_000n });
    expect([scan.complete, scan.scannedTo, scan.counts.get(buyer)]).toEqual([false, 10_999n, 2]);
    const ok = fakeClient(three);
    scan = await bountyPurchases(ok.client, "race", { fromBlock: 1_000n, toBlock: 12_000n });
    expect([scan.complete, scan.counts.get(buyer)]).toEqual([true, 3]);
    expect(ok.request).toHaveBeenCalledTimes(2); // only the missing chunk, twice
  });

  it("blocks read past the end while live are never counted in the final window", async () => {
    const logs = [purchase(1_000, 0, buyer), purchase(1_999, 0, buyer), purchase(2_050, 0, buyer)];
    const { client } = fakeClient(logs);
    expect((await bountyPurchases(client, "race", { fromBlock: 1_000n, toBlock: 2_100n })).counts.get(buyer)).toBe(3);
    expect((await bountyPurchases(client, "race", { fromBlock: 1_000n, toBlock: 1_999n })).counts.get(buyer)).toBe(2);
  });

  it("reads GoodDollar verification on-chain and reports a failed read as unknown, not verified", async () => {
    const multicall = vi.fn(async () => [{ status: "success", result: true }, { status: "success", result: false }, { status: "failure", error: new Error("x") }]);
    const out = await goodDollarVerification({ multicall } as unknown as PublicClient, [addr(1), addr(2), addr(3)]);
    expect([...out.values()]).toEqual([true, false, null]);
    const down = vi.fn(async () => { throw new Error("rpc down"); });
    resetEligibilityCaches();
    expect([...(await goodDollarVerification({ multicall: down } as unknown as PublicClient, [addr(4)])).values()]).toEqual([null]);
  });
});

describe("Eligibility rules", () => {
  it("needs GoodDollar verification and 10 purchases; an unfinished count below 10 is unknown, not a failure", () => {
    expect(evaluateEligibility(RULES, true, 10).meetsChecks).toBe(true);
    expect(evaluateEligibility(RULES, true, 9).meetsChecks).toBe(false);
    expect(evaluateEligibility(RULES, true, 9, false).meetsChecks).toBeNull();
    expect(evaluateEligibility(RULES, true, 10, false).meetsChecks).toBe(true);
    expect(evaluateEligibility(RULES, false, 50).meetsChecks).toBe(false);
    expect(evaluateEligibility(RULES, null, 50).meetsChecks).toBeNull();
    expect(evaluateEligibility(RULES, true, null).meetsChecks).toBeNull();
  });

  it("winners are the first five that pass, in leaderboard order, and an unknown above them makes the pick incomplete", () => {
    const e = (meets: boolean | null): EntryEligibility => ({ goodDollarVerified: meets, purchases: 10, purchasesComplete: true, meetsChecks: meets });
    const rows = [true, false, true, null, true, true, true, true].map((m, i) => ({ i, m }));
    const pick = eligibleWinners(rows, (r) => e(r.m), 5);
    expect(pick.winners.map((w) => w.index)).toEqual([0, 2, 4, 5, 6]);
    expect(pick.complete).toBe(false);
  });
});

// ── The public route, with the race configured ─────────────────────────────

const F_START = 1_000n; // first block at or after 13:00:00 WAT on 21 Nov
const F_END = 2_000n;   // first block at or after 13:00:00 WAT on 26 Nov
type XpEvent = [block: number, player: number, total: number];

/** A subgraph built from XP events: `players(block: N)` is everyone's latest total at or before N. */
function fakeSubgraph(events: XpEvent[], names: Record<number, string | null> = {}) {
  const blocks: string[] = [];
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    const q = JSON.parse(init.body).query as string;
    const b = /block: \{ number: (\d+) \}/.exec(q)?.[1];
    blocks.push(b ?? "latest");
    const at = b ? Number(b) : Number.MAX_SAFE_INTEGER;
    const after = /id_gt: "([^"]*)"/.exec(q)?.[1] ?? "0x";
    const totals = new Map<number, number>();
    for (const [block, p, total] of events) if (block <= at) totals.set(p, total);
    const players = [...totals]
      .filter(([, xp]) => xp > 0)
      .map(([p, xp]) => ({ id: addr(p), xp: String(xp), username: p in names ? names[p] : `P${p}`, firstSeen: String(1000 + p) }))
      .filter((p) => p.id > after)
      .sort((x, y) => (x.id < y.id ? -1 : 1));
    return new Response(JSON.stringify({ data: { players } }), { status: 200 });
  });
  return Object.assign(fn, { blocks });
}

interface ChainFake {
  purchases: Map<string, number>;
  verify: (id: string) => boolean | null;
  scanComplete?: boolean;
  scanThrows?: boolean;
  windows: Array<{ fromBlock: bigint; toBlock: bigint }>;
  verifyCalls: string[][];
}
const chainFake = (purchases: Map<string, number>, verify: (id: string) => boolean | null, extra: Partial<ChainFake> = {}): ChainFake =>
  ({ purchases, verify, windows: [], verifyCalls: [], ...extra });

async function loadRaceRoute(now: string, chain: ChainFake) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  process.env.SUBGRAPH_URL = "https://subgraph.test";
  vi.doMock("../config/bounties", async (orig) => {
    const real = (await orig()) as typeof import("../config/bounties");
    return { ...real, bounties: [real.bounties.find((b) => b.id === "bounty-4")!] };
  });
  vi.doMock("./blockResolver", () => ({
    resolveBlockByTime: async () => { throw new Error("the race uses exact blocks"); },
    firstBlockAtOrAfter: async (_c: unknown, d: Date) => {
      if (d.toISOString() === "2026-11-21T12:00:00.000Z") return F_START;
      if (d.toISOString() === "2026-11-26T12:00:00.000Z") return F_END;
      throw new Error(`unexpected boundary ${d.toISOString()}`);
    },
  }));
  vi.doMock("./bountyEligibilityChain", () => ({
    latestBlock: async () => 1_500n,
    bountyPurchases: async (_c: unknown, _id: string, w: { fromBlock: bigint; toBlock: bigint }) => {
      chain.windows.push(w);
      if (chain.scanThrows) throw new Error("rpc down");
      return { counts: chain.purchases, complete: chain.scanComplete ?? true, scannedTo: w.toBlock };
    },
    goodDollarVerification: async (_c: unknown, ids: string[]) => {
      chain.verifyCalls.push([...ids]);
      return new Map(ids.map((id) => [id, chain.verify(id)]));
    },
  }));
  return import("../../app/api/bounties/route");
}

// Eight players: P1 and P2 had XP before the race (block 900); everyone earns inside it.
const raceEvents: XpEvent[] = [
  [900, 1, 50_000], [900, 2, 10],
  [1_400, 1, 59_000], [1_300, 2, 8_010], [1_200, 3, 7_000], [1_250, 4, 6_000],
  [1_260, 5, 5_000], [1_270, 6, 4_000], [1_280, 7, 3_000], [1_290, 8, 2_000],
];
const verifiedIds = new Set([1, 3, 4, 5, 6, 7, 8].map(addr));
const racePurchases = new Map<string, number>([[addr(1), 12], [addr(2), 20], [addr(3), 9], [addr(4), 10], [addr(5), 15], [addr(6), 11], [addr(7), 10], [addr(8), 30]]);

describe("GET /api/bounties for the race", () => {
  afterEach(() => {
    vi.useRealTimers(); vi.unstubAllGlobals();
    vi.doUnmock("../config/bounties"); vi.doUnmock("./blockResolver"); vi.doUnmock("./bountyEligibilityChain");
    delete process.env.SUBGRAPH_URL; delete process.env.BOUNTY_VERIFY_BATCH;
  });

  it("at 12:59:59.999 WAT the race is upcoming and nothing is read", async () => {
    const sg = fakeSubgraph(raceEvents);
    vi.stubGlobal("fetch", sg);
    const { GET } = await loadRaceRoute("2026-11-21T11:59:59.999Z", chainFake(racePurchases, (id) => verifiedIds.has(id)));
    const body = await (await GET()).json();
    expect(body.bounties[0]).toMatchObject({ status: "upcoming", standings: { phase: "upcoming" } });
    expect(sg).not.toHaveBeenCalled();
  });

  it("live: race XP only (P1 shows 9,000, not 59,000), each player's checks, and prize positions from the whole ranking", async () => {
    const sg = fakeSubgraph(raceEvents, { 8: null });
    vi.stubGlobal("fetch", sg);
    const chain = chainFake(racePurchases, (id) => verifiedIds.has(id));
    const { GET } = await loadRaceRoute("2026-11-21T12:00:00.000Z", chain); // the start instant is live
    const body = await (await GET()).json();
    const s = body.bounties[0].standings;
    expect(body.bounties[0].status).toBe("live");
    expect(sg.blocks).toEqual(expect.arrayContaining([String(F_START - 1n), "latest"])); // the "before" snapshot is the block before the start
    expect(chain.windows[0]).toEqual({ fromBlock: F_START, toBlock: 1_500n });
    expect(s.entries.map((e: { username: string | null; xp: string }) => [e.username, e.xp]).slice(0, 3)).toEqual([["P1", "9000"], ["P2", "8000"], ["P3", "7000"]]);
    expect(s.entries[0].eligibility).toEqual({ goodDollarVerified: true, purchases: 12, purchasesComplete: true, meetsChecks: true });
    expect(s.entries[1].eligibility).toMatchObject({ goodDollarVerified: false, meetsChecks: false });
    expect(s.entries[2].eligibility).toMatchObject({ purchases: 9, meetsChecks: false });
    expect(s.prizePositions.map((p: { rank: number; place: number }) => [p.rank, p.place])).toEqual([[1, 1], [4, 2], [5, 3], [6, 4], [7, 5]]);
    expect(s.checks).toMatchObject({ purchasesComplete: true, verificationAvailable: true, selectionComplete: true, evaluatedPlayers: 8 });
    const html = renderToStaticMarkup(createElement(BountyStandings, { standings: s, bounty: { rules: RULES, prizeTable: race.prizeTable } }));
    expect(html.match(/🏆/g)?.length).toBe(1 + 5); // the explanation line + five rows
    expect(html).toContain("Not GoodDollar verified");
    expect(html).toContain("9/10 purchases");
    expect(html).toContain("1st · $10 in G$");
  });

  it("ended (from 13:00:00 WAT on 26 Nov): five eligible winners with prizes, judged at the block before the end, no addresses sent", async () => {
    const sg = fakeSubgraph(raceEvents, { 8: null });
    vi.stubGlobal("fetch", sg);
    const chain = chainFake(racePurchases, (id) => verifiedIds.has(id));
    const { GET } = await loadRaceRoute("2026-11-26T12:00:00.000Z", chain);
    const raw = await (await GET()).text();
    expect(raw).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(sg.blocks).toEqual(expect.arrayContaining([String(F_START - 1n), String(F_END - 1n)]));
    expect(chain.windows[0]).toEqual({ fromBlock: F_START, toBlock: F_END - 1n });
    const s = JSON.parse(raw).bounties[0].standings;
    expect([s.phase, s.provisional, s.complete]).toEqual(["final", true, true]);
    expect(s.winners.map((w: { displayName: string | null; leaderboardRank: number; prizeUsd: number }) => [w.displayName, w.leaderboardRank, w.prizeUsd]))
      .toEqual([["P1", 1, 10], ["P4", 4, 7], ["P5", 5, 5], ["P6", 6, 5], ["P7", 7, 3]]);
    const html = renderToStaticMarkup(createElement(BountyStandings, { standings: s }));
    expect(html).toContain("Provisional Winners");
    expect(html).toContain("$10 equivalent in G$");
    expect(html).toContain("Checked by the team before any prize is paid: Follows @ImmanuelOlivia1 on X.");
  });

  it("XP at the boundaries: the first race block counts, the block before it doesn't, and the first block at the end doesn't", async () => {
    const events: XpEvent[] = [
      [999, 1, 100], [1_000, 1, 400],   // P1: 100 just before the start, then 300 in the first race block
      [1_999, 2, 50], [2_000, 2, 120],  // P2: 50 in the last race block, then 70 in the first block at the end
      [2_000, 3, 999],                  // P3: only at the end block
    ];
    vi.stubGlobal("fetch", fakeSubgraph(events));
    const all = new Map([[addr(1), 10], [addr(2), 10], [addr(3), 10]]);
    const { GET } = await loadRaceRoute("2026-11-27T00:00:00Z", chainFake(all, () => true));
    const s = (await (await GET()).json()).bounties[0].standings;
    expect(s.participants).toBe(2);
    expect(s.winners.map((w: { displayName: string; xp: string }) => [w.displayName, w.xp])).toEqual([["P1", "300"], ["P2", "50"]]);
  });

  it("searches past the first 50: when all of them fail, a lower-ranked player who qualifies still wins", async () => {
    // 120 players ranked by race XP. Ranks 1-56 fail (unverified, or 9 purchases); 57-61 qualify.
    const events: XpEvent[] = Array.from({ length: 120 }, (_, i) => [1_100, i + 1, 100_000 - i * 10]);
    const qualifies = (n: number) => n >= 57 && n <= 61;
    const purchases = new Map(Array.from({ length: 120 }, (_, i) => [addr(i + 1), i % 2 === 0 && !qualifies(i + 1) ? 9 : 12]));
    const chain = chainFake(purchases, (id) => qualifies(parseInt(id, 16)));
    vi.stubGlobal("fetch", fakeSubgraph(events));
    const { GET } = await loadRaceRoute("2026-11-27T00:00:00Z", chain);
    const s = (await (await GET()).json()).bounties[0].standings;
    expect(s.complete).toBe(true);
    expect(s.winners.map((w: { leaderboardRank: number; prizeUsd: number }) => [w.leaderboardRank, w.prizeUsd])).toEqual([[57, 10], [58, 7], [59, 5], [60, 5], [61, 3]]);
    expect(chain.verifyCalls.flat()).toContain(addr(57)); // verification went beyond the top 50
  });

  it("checks every ranked player when fewer than five qualify, and only then calls the result complete", async () => {
    const events: XpEvent[] = Array.from({ length: 160 }, (_, i) => [1_100, i + 1, 100_000 - i * 10]);
    const chain = chainFake(new Map(Array.from({ length: 160 }, (_, i) => [addr(i + 1), 12])), (id) => [70, 155].includes(parseInt(id, 16)));
    vi.stubGlobal("fetch", fakeSubgraph(events));
    const { GET } = await loadRaceRoute("2026-11-27T00:00:00Z", chain);
    const s = (await (await GET()).json()).bounties[0].standings;
    expect(s.winners.map((w: { leaderboardRank: number }) => w.leaderboardRank)).toEqual([70, 155]);
    expect(s.complete).toBe(true);
    expect(s.checks.evaluatedPlayers).toBe(160);
    expect(chain.verifyCalls.length).toBe(2); // two batches of up to 100
  });

  it("live: a prize position ranked below the displayed 50 is still shown", async () => {
    const events: XpEvent[] = Array.from({ length: 70 }, (_, i) => [1_100, i + 1, 100_000 - i * 10]);
    vi.stubGlobal("fetch", fakeSubgraph(events));
    const { GET } = await loadRaceRoute("2026-11-23T12:00:00Z", chainFake(new Map(Array.from({ length: 70 }, (_, i) => [addr(i + 1), 12])), (id) => parseInt(id, 16) === 64));
    const s = (await (await GET()).json()).bounties[0].standings;
    expect(s.entries).toHaveLength(50);
    expect(s.prizePositions.map((p: { rank: number }) => p.rank)).toEqual([64]);
    const html = renderToStaticMarkup(createElement(BountyStandings, { standings: s, bounty: { rules: RULES, prizeTable: race.prizeTable } }));
    expect(html).toContain("Also in a prize position, ranked below #50");
    expect(html).toContain("P64");
  });

  it("a verification failure stops the walk and the result is not final, then a later request completes it", async () => {
    process.env.BOUNTY_VERIFY_BATCH = "50";
    const events: XpEvent[] = Array.from({ length: 120 }, (_, i) => [1_100, i + 1, 100_000 - i * 10]);
    let rpcUp = false;
    const chain = chainFake(new Map(Array.from({ length: 120 }, (_, i) => [addr(i + 1), 12])), (id) => {
      const n = parseInt(id, 16);
      if (n <= 50) return false;  // the first batch reads fine: nobody there is verified
      if (!rpcUp) return null;    // the second batch can't be read
      return n === 77;
    });
    vi.stubGlobal("fetch", fakeSubgraph(events));
    const { GET } = await loadRaceRoute("2026-11-27T00:00:00Z", chain);
    let s = (await (await GET()).json()).bounties[0].standings;
    expect([s.phase, s.complete, s.winners.length]).toEqual(["final", false, 0]);
    expect(s.checks.verificationAvailable).toBe(false);
    expect(renderToStaticMarkup(createElement(BountyStandings, { standings: s }))).toContain("Results Being Checked");
    rpcUp = true; // the incomplete result was not cached, so the next request tries again
    s = (await (await GET()).json()).bounties[0].standings;
    expect([s.complete, s.winners.map((w: { leaderboardRank: number }) => w.leaderboardRank)]).toEqual([true, [77]]);
  });

  it("a failed purchase scan leaves every purchase check unknown: no winners, not final", async () => {
    vi.stubGlobal("fetch", fakeSubgraph(raceEvents));
    const { GET } = await loadRaceRoute("2026-11-27T00:00:00Z", chainFake(racePurchases, () => true, { scanThrows: true }));
    const s = (await (await GET()).json()).bounties[0].standings;
    expect([s.complete, s.winners.length, s.checks.purchasesComplete]).toEqual([false, 0, false]);
  });

  it("an unfinished purchase scan never declares the result complete while a higher-ranked count is short", async () => {
    vi.stubGlobal("fetch", fakeSubgraph(raceEvents));
    const { GET } = await loadRaceRoute("2026-11-27T00:00:00Z", chainFake(racePurchases, (id) => verifiedIds.has(id), { scanComplete: false }));
    const s = (await (await GET()).json()).bounties[0].standings;
    expect(s.complete).toBe(false); // P3 has 9 so far and might still reach 10
    expect(s.checks.purchasesComplete).toBe(false);
  });
});

describe("Bounties without rules are unchanged", () => {
  it("public standings for an earlier bounty carry no eligibility or prize fields", () => {
    const pub = toPublicBounty(bounties[0], 0, "ended", publicStandings("ended", []));
    expect(pub).not.toHaveProperty("rules");
    expect(pub).not.toHaveProperty("prizeTable");
    expect(pub.standings).toEqual({ phase: "final", participants: 0, winners: [] });
    expect(fmtPrizeUsd(10)).toBe("$10 equivalent in G$");
  });
});
