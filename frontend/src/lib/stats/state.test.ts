import { describe, it, expect } from "vitest";
import { encodeAbiParameters, toEventSelector } from "viem";
import { applyLogs, derive, emptyState, RECENT_EVENTS_MAX, seasonXpOf, type RawLog, type StatsState } from "./state";
import { ANCHOR_BLOCK, ANCHOR_TIME } from "./config";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const topic = (addr: string) => "0x" + "0".repeat(24) + addr.slice(2);
const SESSION = toEventSelector("event SessionStarted(address)");
const SCORE = toEventSelector("event ScoreSubmitted(address,uint256,uint32)");
const REWARD = toEventSelector("event RewardPaid(address,uint32,uint256)");
const SHIELD_V6 = toEventSelector("event ShieldPurchased(address,uint256,uint256)");

/** A block on the given UTC day at the given hour, via the config's anchor. */
function blockAt(day: string, hour = 12): number {
  const unix = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`) / 1000;
  return ANCHOR_BLOCK + (unix - ANCHOR_TIME);
}
const session = (addr: string, block: number, tx = "0x01"): RawLog => ({ blockNumber: block, topics: [SESSION, topic(addr)], transactionHash: tx });
const score = (addr: string, block: number, s: bigint, tile: number): RawLog => ({
  blockNumber: block, topics: [SCORE, topic(addr)], transactionHash: "0x02",
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint32" }], [s, tile]),
});
const reward = (addr: string, block: number, milestone: number, wei: bigint): RawLog => ({
  blockNumber: block, topics: [REWARD, topic(addr)], transactionHash: "0x03",
  data: encodeAbiParameters([{ type: "uint32" }, { type: "uint256" }], [milestone, wei]),
});

function seeded(from: number): StatsState {
  const s = emptyState();
  s.checkpointBlock = from - 1;
  return s;
}

describe("applyLogs: per-day detail", () => {
  it("counts sessions, games and distinct active wallets per UTC day", () => {
    const d1 = blockAt("2026-10-20", 9);
    const s = seeded(d1);
    applyLogs(s, [
      session(A, d1), score(A, d1 + 10, 1000n, 256),
      session(A, d1 + 20), score(A, d1 + 30, 2000n, 512), // A again, same day
      session(B, d1 + 40),
      session(A, blockAt("2026-10-21", 9)), // next day
    ], blockAt("2026-10-21", 23));

    expect(s.detailSinceBlock).toBe(d1);
    expect(s.dailyDetail?.["2026-10-20"]).toEqual({ sessions: 3, games: 2, active: 2 });
    expect(s.dailyDetail?.["2026-10-21"]).toEqual({ sessions: 1, games: 0, active: 1 });
  });

  it("keeps detailSinceBlock at the first block ever scanned", () => {
    const b = blockAt("2026-10-20");
    const s = seeded(b);
    applyLogs(s, [session(A, b)], b + 100);
    applyLogs(s, [session(B, b + 200)], b + 300);
    expect(s.detailSinceBlock).toBe(b);
  });
});

describe("applyLogs: recent events", () => {
  it("records score, tile and reward fields from the log data", () => {
    const b = blockAt("2026-10-20");
    const s = seeded(b);
    applyLogs(s, [score(A, b, 11480n, 1024), reward(A, b + 1, 1024, 40n * 10n ** 18n)], b + 2);
    expect(s.recentEvents).toEqual([
      { block: b, tx: "0x02", type: "ScoreSubmitted", player: A, score: 11480, tile: 1024 },
      { block: b + 1, tx: "0x03", type: "RewardPaid", player: A, tile: 1024, amountWei: (40n * 10n ** 18n).toString() },
    ]);
  });

  it("includes shop purchases and caps the list at the newest RECENT_EVENTS_MAX", () => {
    const b = blockAt("2026-10-20");
    const s = seeded(b);
    const logs = Array.from({ length: RECENT_EVENTS_MAX + 5 }, (_, i) => session(A, b + i, `0x${i}`));
    logs.push({ blockNumber: b + 100, topics: [SHIELD_V6, topic(B)], transactionHash: "0xff" });
    applyLogs(s, logs, b + 100);
    expect(s.recentEvents).toHaveLength(RECENT_EVENTS_MAX);
    expect(s.recentEvents!.at(-1)).toMatchObject({ type: "ShieldPurchased", player: B, tx: "0xff" });
    expect(s.recentEvents![0].block).toBe(b + 6); // the 6 oldest were dropped
  });
});

describe("derive", () => {
  it("reads an aggregate saved before the detail fields existed", () => {
    const s = emptyState();
    s.checkpointBlock = blockAt("2026-10-20");
    s.addrs[A] = [s.checkpointBlock, s.checkpointBlock, 1, 1, 1, "1"];
    const snap = derive(s);
    expect(snap.detail).toEqual({ sinceBlock: null, sinceDay: null, days: [], window: { "7d": null, "30d": null } });
    expect(snap.recentEvents).toEqual([]);
    expect(snap.playerWallets).toBe(1);
  });

  it("gives windowed totals only once coverage spans the whole window", () => {
    const start = blockAt("2026-10-01", 0);
    const s = seeded(start);
    applyLogs(s, [session(A, start + 3600), score(A, start + 7200, 500n, 128)], blockAt("2026-10-05", 23));
    let snap = derive(s);
    expect(snap.detail.sinceDay).toBe("2026-10-01");
    expect(snap.detail.window["7d"]).toBeNull(); // coverage began 5 days ago

    applyLogs(s, [session(B, blockAt("2026-10-12"))], blockAt("2026-10-12", 23));
    snap = derive(s);
    expect(snap.detail.window["7d"]).toEqual({ sessions: 1, games: 0 }); // 6–12 Oct
    expect(snap.detail.window["30d"]).toBeNull();
  });

  it("lists recent events newest first and shop counts from events", () => {
    const b = blockAt("2026-10-20");
    const s = seeded(b);
    applyLogs(s, [session(A, b), { blockNumber: b + 1, topics: [SHIELD_V6, topic(A)] }], b + 1);
    const snap = derive(s);
    expect(snap.recentEvents.map((e) => e.type)).toEqual(["ShieldPurchased", "SessionStarted"]);
    expect(snap.recentEvents[0].tx).toBeNull(); // no hash on the log: none invented
    expect(snap.shop).toEqual({ shields: 1, boosts: 0, undoCredits: 0, cosmetics: 0 });
  });
});

// ── Season XP tally (rewards estimate) ──────────────────────────────────────

describe("season XP tally", () => {
  const XP_EARNED = toEventSelector("event XpEarned(address,uint256,uint256)");
  const xpLog = (block: number, amount: bigint): RawLog => ({
    blockNumber: block, topics: [XP_EARNED, topic(A)],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, 0n]),
  });

  it("sums XpEarned inside the window only and reports full coverage", () => {
    const s = emptyState();
    s.checkpointBlock = 99;
    applyLogs(s, [xpLog(100, 10n), xpLog(150, 5n), xpLog(201, 7n)], 300, { startBlock: 100, endBlock: 200 });
    expect(seasonXpOf(s, { startBlock: 100, endBlock: 200 }, A)).toEqual({ xp: 15n, complete: true });
    expect(seasonXpOf(s, { startBlock: 100, endBlock: 200 }, B)).toEqual({ xp: 0n, complete: true });
  });

  it("is partial when the tally started after the season did", () => {
    const s = emptyState();
    s.checkpointBlock = 149;
    applyLogs(s, [xpLog(150, 5n)], 300, { startBlock: 100, endBlock: 200 });
    expect(seasonXpOf(s, { startBlock: 100, endBlock: 200 }, A)).toEqual({ xp: 5n, complete: false });
  });

  it("resets when the window changes, and is unavailable for another window", () => {
    const s = emptyState();
    s.checkpointBlock = 99;
    applyLogs(s, [xpLog(120, 5n)], 130, { startBlock: 100, endBlock: 200 });
    applyLogs(s, [xpLog(140, 3n)], 150, { startBlock: 140, endBlock: null });
    expect(seasonXpOf(s, { startBlock: 100, endBlock: 200 }, A)).toBeNull();
    // The new window starts at 140 and the tally restarted from block 131, so it is complete.
    expect(seasonXpOf(s, { startBlock: 140, endBlock: null }, A)).toEqual({ xp: 3n, complete: true });
  });

  it("is absent when no window is configured, so older aggregates are unchanged", () => {
    const s = emptyState();
    applyLogs(s, [xpLog(s.checkpointBlock + 1, 5n)], s.checkpointBlock + 2);
    expect(s.seasonTally).toBeUndefined();
  });
});
