/**
 * Stats reseed: merging a historical hole back into the stored aggregate.
 * Everything here is synthetic: no Redis, no network, no clock.
 */
import { describe, it, expect } from "vitest";
import { applyLogs, derive, emptyState, type StatsState } from "./state";
import { ANCHOR_BLOCK, ANCHOR_TIME } from "./config";
import { FIXED_AT, LATER_CP, SEL, advance, blockAt, laterLogs, mk, rewardData, world, wallet, D, CP } from "./reseedTestWorld";
import {
  PUBLIC_IGNORE, ReseedError, acceptedByApp, buildState, canonical, compareTotals, diffJson, diffStates, explainDiff,
  localizeGap, mergeGapLogs, parseSnapshot, rewardsPreserved, totalsOf, verifyLaterScansOnly, windowClusters, withoutWindows, type GapLog,
} from "./reseed";

describe("fixture sanity", () => {
  it("has the cases the merge has to handle", () => {
    const { gap, complete, stored } = world();
    expect(new Set(world().all.map((l) => `${l.blockNumber}:${l.logIndex}`)).size).toBe(world().all.length); // no repeated (block, logIndex)
    expect(gap.length).toBeGreaterThan(10);
    expect(gap.some((l) => l.topics.length === 1)).toBe(true); // a non-player log
    expect(Object.keys(complete.addrs).length - Object.keys(stored.addrs).length).toBeGreaterThanOrEqual(3); // wallets only the gap introduces
    expect(complete.eventCounts.RewardPaid).toBe(2);
    expect(complete.rewardPaidWei).toBe((30n * 10n ** 18n).toString());
  });
});

describe("buildState", () => {
  it("evolves like a live aggregate: no detail before the start block, detailSinceBlock = D", () => {
    const { all, opts, complete } = world();
    expect(complete.detailSinceBlock).toBe(D);
    expect(Object.keys(complete.dailyDetail!).sort()[0]).toBe("2026-11-04");
    const live = emptyState();
    applyLogs(live, all.filter((l) => l.blockNumber < D), D - 1);
    delete live.dailyDetail; delete live.recentEvents; delete live.detailSinceBlock;
    applyLogs(live, all.filter((l) => l.blockNumber >= D), CP);
    live.updatedAt = FIXED_AT;
    expect(canonical(complete)).toBe(canonical(live));
    // A single pass from genesis would instead reach back with detail for every day.
    expect(Object.keys(buildState(all, { checkpointBlock: CP, updatedAt: FIXED_AT }).dailyDetail!).length).toBeGreaterThan(30);
    expect(opts.detailSinceBlock).toBe(D);
  });

  it("ignores logs above the checkpoint", () => {
    const { all } = world();
    const s = buildState(all, { checkpointBlock: blockAt("2026-09-30"), updatedAt: FIXED_AT });
    expect(s.checkpointBlock).toBe(blockAt("2026-09-30"));
    expect(s.totalLogs).toBe(all.filter((l) => l.blockNumber <= blockAt("2026-09-30")).length);
  });
});

describe("mergeGapLogs", () => {
  it("gives exactly the state a complete scan gives, including detail and the recent feed", () => {
    const { gap, stored, complete } = world();
    const { state, report } = mergeGapLogs(stored, gap);
    expect(canonical(state)).toBe(canonical(complete));
    expect(report.logs).toBe(gap.length);
    expect(report.newWallets).toBeGreaterThanOrEqual(3);
    expect(report.rewardPaidWei).toBe("0");
  });

  it("does not modify the snapshot it was given", () => {
    const { gap, stored } = world();
    const before = canonical(stored);
    mergeGapLogs(stored, gap);
    expect(canonical(stored)).toBe(before);
  });

  it("is independent of the order the missing logs arrive in", () => {
    const { gap, stored } = world();
    const a = mergeGapLogs(stored, gap).state;
    const b = mergeGapLogs(stored, [...gap].reverse()).state;
    expect(canonical(a)).toBe(canonical(b));
  });

  it("changes only what the gap explains", () => {
    const { gap, stored } = world();
    const { state, report } = mergeGapLogs(stored, gap);
    expect(explainDiff(stored, state, report)).toEqual([]);
    const d = diffStates(stored, state);
    expect(d.scalars.map((s) => s.field)).toEqual(["totalLogs"]);
    expect(d.unchanged).toEqual({ dailyDetail: true, recentEvents: true, seasonTally: true });
    expect(d.addrs.removed).toEqual([]);
    expect(rewardsPreserved(stored, state)).toEqual([]);
  });

  it("is NOT the same as running the gap through applyLogs on the live state (why this is a merge)", () => {
    const { gap, stored, complete } = world();
    const { report } = mergeGapLogs(stored, gap);
    const naive = structuredClone(stored);
    applyLogs(naive, gap, stored.checkpointBlock);
    expect(canonical(naive)).not.toBe(canonical(complete));
    expect(explainDiff(stored, naive, report).length).toBeGreaterThan(0);
  });

  it("keeps the public view identical to a complete scan's", () => {
    const { gap, stored, complete } = world();
    const merged = mergeGapLogs(stored, gap).state;
    expect(diffJson(derive(merged), derive(complete), PUBLIC_IGNORE)).toEqual([]);
    expect(diffJson(derive(stored), derive(complete), PUBLIC_IGNORE).length).toBeGreaterThan(0);
  });

  it("carries a RewardPaid in the gap into the totals, which rewardsPreserved then flags", () => {
    const { rest, opts } = world();
    const extra = mk(SEL.reward, 3, blockAt("2026-09-23", 20), 9, rewardData(256, 5n * 10n ** 18n));
    const stored = buildState(rest, opts);
    const { state, report } = mergeGapLogs(stored, [extra]);
    expect(state.eventCounts.RewardPaid).toBe((stored.eventCounts.RewardPaid ?? 0) + 1);
    expect(BigInt(state.rewardPaidWei) - BigInt(stored.rewardPaidWei)).toBe(5n * 10n ** 18n);
    expect(explainDiff(stored, state, report)).toEqual([]);
    expect(rewardsPreserved(stored, state)).toHaveLength(2);
  });
});

describe("mergeGapLogs refuses what it cannot prove safe", () => {
  const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as ReseedError).code; } return null; };

  it("an empty gap", () => {
    expect(code(() => mergeGapLogs(world().stored, []))).toBe("gap_empty");
  });
  it("the same log twice", () => {
    const { gap, stored } = world();
    expect(code(() => mergeGapLogs(stored, [...gap, gap[0]]))).toBe("gap_duplicate_log");
  });
  it("a block before genesis", () => {
    expect(code(() => mergeGapLogs(world().stored, [mk(SEL.session, 1, 5, 0)]))).toBe("gap_below_genesis");
  });
  it("a block above the checkpoint, which the live scan reads itself", () => {
    expect(code(() => mergeGapLogs(world().stored, [mk(SEL.session, 1, CP + 1, 0)]))).toBe("gap_above_checkpoint");
  });
  it("anything on or after the first day of per-day detail, even if earlier in that day", () => {
    const { stored } = world();
    expect(code(() => mergeGapLogs(stored, [mk(SEL.session, 1, D + 10, 0)]))).toBe("gap_in_detail_coverage");
    expect(code(() => mergeGapLogs(stored, [mk(SEL.session, 1, D - 10, 0)]))).toBe("gap_in_detail_coverage"); // same UTC day, just before D
    expect(code(() => mergeGapLogs(stored, [mk(SEL.session, 1, blockAt("2026-11-03", 12), 0)]))).toBeNull();
  });
  it("a block inside the season XP tally, but not one before it", () => {
    const { gap, stored } = world();
    const tally = (sinceBlock: number): StatsState => ({
      ...structuredClone(stored), seasonTally: { key: "k", startBlock: 1, endBlock: null, sinceBlock, xp: {} },
    });
    expect(code(() => mergeGapLogs(tally(blockAt("2026-09-20")), gap))).toBe("gap_in_season_tally");
    const later = tally(blockAt("2026-10-01"));
    const { state } = mergeGapLogs(later, gap);
    expect(canonical(state.seasonTally)).toBe(canonical(later.seasonTally));
  });
});

describe("explainDiff catches changes the gap does not explain", () => {
  const merged = () => { const w = world(); const m = mergeGapLogs(w.stored, w.gap); return { ...w, ...m }; };

  it("a changed timestamp", () => {
    const { stored, state, report } = merged();
    expect(explainDiff(stored, { ...state, updatedAt: "2026-11-08T00:00:00.000Z" }, report).join()).toContain("updatedAt");
  });
  it("a moved checkpoint", () => {
    const { stored, state, report } = merged();
    expect(explainDiff(stored, { ...state, checkpointBlock: state.checkpointBlock - 1 }, report).join()).toContain("checkpointBlock");
  });
  it("a wallet the gap does not touch", () => {
    const { stored, state, report } = merged();
    const next = structuredClone(state);
    const untouched = Object.keys(next.addrs).find((w) => !report.touchedWallets.includes(w))!;
    next.addrs[untouched][2] += 1;
    expect(explainDiff(stored, next, report).join()).toContain(untouched);
  });
  it("edited per-day detail", () => {
    const { stored, state, report } = merged();
    const next = structuredClone(state);
    next.dailyDetail!["2026-11-05"].sessions += 1;
    expect(explainDiff(stored, next, report).join()).toContain("dailyDetail changed");
  });
  it("G$ paid changing when the gap pays nothing", () => {
    const { stored, state, report } = merged();
    expect(explainDiff(stored, { ...state, rewardPaidWei: "1" }, report).join()).toContain("rewardPaidWei");
  });
  it("a counter that rose by the wrong amount", () => {
    const { stored, state, report } = merged();
    const next = structuredClone(state);
    next.eventCounts.SessionStarted += 1;
    expect(explainDiff(stored, next, report).join()).toContain("eventCounts SessionStarted");
  });
});

describe("locating the hole from public data", () => {
  it("per-day shortfalls add up to the missing logs", () => {
    const { gap, stored, complete } = world();
    const loc = localizeGap(derive(stored).daily, derive(complete).daily);
    expect(loc.totalMissing).toBe(gap.length);
    expect(loc.extras).toEqual([]);
    expect(loc.days.map((d) => d.day)).toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
  });

  const missing = (loc: ReturnType<typeof localizeGap>) => Object.fromEntries(loc.days.map((d) => [d.day, d.missing]));
  const dayLogs = (all: GapLog[], day: string) => all.filter((l) => new Date((ANCHOR_TIME + l.blockNumber - ANCHOR_BLOCK) * 1000).toISOString().startsWith(day));

  it("a gap spanning several days is one cluster with exactly one fitting window, and it is the gap", () => {
    const { all, gap, stored, complete } = world();
    const found = windowClusters(all, missing(localizeGap(derive(stored).daily, derive(complete).daily)));
    expect(found.ok).toBe(true);
    expect(found.clusters).toHaveLength(1);
    expect(found.clusters[0].days).toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
    expect(found.clusters[0].candidates).toHaveLength(1);
    const w = found.clusters[0].candidates[0];
    expect(w.count).toBe(gap.length);
    expect(w.fromBlock).toBe(gap[0].blockNumber);
    expect(w.toBlock).toBe(gap[gap.length - 1].blockNumber);
    // Removing that window reproduces the stored state's public view exactly.
    const sim = buildState(withoutWindows(all, [w]), { checkpointBlock: CP, detailSinceBlock: D, updatedAt: FIXED_AT });
    expect(diffJson(derive(sim), derive(stored), PUBLIC_IGNORE)).toEqual([]);
  });

  it("a gap inside one day leaves several candidate windows, including the true one", () => {
    const { all, opts, complete } = world();
    const day = dayLogs(all, "2026-10-05");
    expect(day.length).toBeGreaterThanOrEqual(4);
    const hole = day.slice(1, 3);
    const stored = buildState(all.filter((l) => !hole.includes(l)), opts);
    const found = windowClusters(all, missing(localizeGap(derive(stored).daily, derive(complete).daily)));
    expect(found.clusters).toHaveLength(1);
    expect(found.clusters[0].candidates.length).toBeGreaterThan(1);
    expect(found.clusters[0].candidates.some((c) => c.fromBlock === hole[0].blockNumber && c.toBlock === hole[1].blockNumber)).toBe(true);
  });

  it("two separate holes are two clusters, one of them a whole day (as on production: 25 Sep and 6 Oct)", () => {
    const { all, opts, complete } = world();
    const partial = dayLogs(all, "2026-09-25").slice(2, 6);
    const whole = dayLogs(all, "2026-10-06");
    expect(whole.length).toBeGreaterThan(0);
    const stored = buildState(all.filter((l) => !partial.includes(l) && !whole.includes(l)), opts);
    const found = windowClusters(all, missing(localizeGap(derive(stored).daily, derive(complete).daily)));
    expect(found.ok).toBe(true);
    expect(found.clusters.map((c) => c.days)).toEqual([["2026-09-25"], ["2026-10-06"]]);
    expect(found.clusters[1].candidates).toHaveLength(1); // a whole day can only be itself
    expect(found.clusters[1].candidates[0].count).toBe(whole.length);
    expect(found.clusters[0].candidates.some((c) => c.fromBlock === partial[0].blockNumber && c.toBlock === partial[3].blockNumber)).toBe(true);
  });

  it("a day in the middle of a run that is only partly short is not a set of contiguous holes", () => {
    const { all } = world();
    const r = windowClusters(all, { "2026-09-20": 1, "2026-09-21": 1, "2026-09-22": 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/inside a run of short days/);
  });

  it("a day short by more logs than it has is refused", () => {
    const { all } = world();
    expect(windowClusters(all, { "2026-09-20": 999 }).ok).toBe(false);
  });

  it("reports extras (a stored series with MORE than a complete one) separately", () => {
    const loc = localizeGap([{ day: "2026-09-01", events: 5 }], [{ day: "2026-09-01", events: 3 }]);
    expect(loc.extras).toHaveLength(1);
    expect(loc.totalMissing).toBe(0);
  });
});

describe("totals and what the app accepts", () => {
  it("compareTotals names each metric that differs", () => {
    const { stored, complete } = world();
    const r = compareTotals(totalsOf(derive(stored)), totalsOf(derive(complete)));
    expect(r.ok).toBe(false);
    expect(r.rows.filter((x) => !x.ok).map((x) => x.metric)).toEqual(expect.arrayContaining(["playerWallets", "logs"]));
    expect(r.rows.find((x) => x.metric === "rewardsPaid")!.ok).toBe(true);
    expect(r.rows.find((x) => x.metric === "gDollarPaid")!.ok).toBe(true);
    expect(compareTotals(totalsOf(derive(complete)), totalsOf(derive(complete))).ok).toBe(true);
  });

  it("the app's own loader accepts a merged state and refuses a broken one", () => {
    const { gap, stored } = world();
    const { state } = mergeGapLogs(stored, gap);
    expect(acceptedByApp(state)).toBe(true);
    expect(acceptedByApp({ ...state, version: 99 })).toBe(false);
  });

  it("parseSnapshot demands the exact bytes the app would have written", () => {
    const { stored } = world();
    const raw = JSON.stringify(stored);
    expect(canonical(parseSnapshot(raw))).toBe(canonical(stored));
    for (const bad of [raw + "\n", JSON.stringify(stored, null, 2)]) expect(() => parseSnapshot(bad)).toThrow(ReseedError);
    expect(() => parseSnapshot("{}")).toThrow(ReseedError);
  });
});

describe("verifyLaterScansOnly: is the stored value the snapshot plus ordinary later scanning?", () => {
  const { stored, complete } = world();
  const touch = (fn: (s: ReturnType<typeof structuredClone<typeof stored>>) => void) => { const c = structuredClone(stored); fn(c); return c; };

  it("accepts the snapshot itself", () => {
    expect(verifyLaterScansOnly(stored, stored)).toEqual([]);
  });

  it("accepts what the app's own refresh produces: an old wallet again, a new wallet, a later day, a later checkpoint", () => {
    const later = advance(stored, laterLogs(), LATER_CP);
    expect(later.checkpointBlock).toBe(LATER_CP);
    expect(Object.keys(later.addrs).length).toBe(Object.keys(stored.addrs).length + 1);
    expect(verifyLaterScansOnly(stored, later)).toEqual([]);
  });

  it("refuses a value that already contains the gap (what a second apply would meet)", () => {
    const problems = verifyLaterScansOnly(stored, complete).join("\n");
    expect(problems).toMatch(/dailyEvents 2026-09-2[234]/);
    expect(problems).toMatch(/is new but was first seen at or before the snapshot's checkpoint/);
  });

  it.each([
    ["a day before the checkpoint changed", (c: typeof stored) => { c.dailyEvents["2026-10-01"] = (c.dailyEvents["2026-10-01"] ?? 0) + 1; c.totalLogs += 1; }, /dailyEvents 2026-10-01/],
    ["a wallet's first block changed", (c: typeof stored) => { const w = Object.keys(c.addrs)[0]; c.addrs[w][0] -= 5; }, /first block changed/],
    ["a wallet disappeared", (c: typeof stored) => { delete c.addrs[Object.keys(c.addrs)[0]]; }, /is gone/],
    ["the checkpoint went back", (c: typeof stored) => { c.checkpointBlock -= 1; }, /checkpoint went back/],
    ["where per-day detail starts moved", (c: typeof stored) => { c.detailSinceBlock = (c.detailSinceBlock ?? 0) + 1; }, /per-day detail starts/],
    ["per-day detail for an earlier day changed", (c: typeof stored) => { c.dailyDetail!["2026-11-04"].sessions += 1; }, /per-day detail for 2026-11-04/],
    ["a season tally appeared", (c: typeof stored) => { c.seasonTally = { key: "k", startBlock: 1, endBlock: null, sinceBlock: 2, xp: {} }; }, /season XP tally/],
    ["G$ paid went down", (c: typeof stored) => { c.rewardPaidWei = "1"; }, /G\$ paid went down/],
    ["an event count went down", (c: typeof stored) => { c.eventCounts.SessionStarted -= 1; }, /eventCounts SessionStarted went down/],
  ])("refuses when %s", (_name, mutate, expected) => {
    expect(verifyLaterScansOnly(stored, touch(mutate)).join("\n")).toMatch(expected);
  });

  it("refuses an older event slipped into the recent feed", () => {
    const c = touch((x) => { x.recentEvents = [{ block: CP - 10, tx: "0x1", type: "SessionStarted", player: wallet(3) }, ...(x.recentEvents ?? [])]; });
    expect(verifyLaterScansOnly(stored, c).join("\n")).toMatch(/recent-events feed/);
  });

  it("totals that do not add up to the daily counts are refused", () => {
    expect(verifyLaterScansOnly(stored, touch((c) => { c.totalLogs += 3; })).join("\n")).toMatch(/totalLogs rose by 3 but the daily counts rose by 0/);
  });
});
