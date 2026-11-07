/** The reseed dry run, end to end on the synthetic history: no Redis, no network. */
import { describe, expect, it } from "vitest";
import { derive } from "./state";
import { applyResolver, planReseed, rollbackResolver, verifyApplyInputs, type PlanInput, type PlanReport } from "./reseedPlan";
import { digest } from "./reseedHash";
import { buildState, canonical, mergeGapLogs, totalsOf } from "./reseed";
import { CP, D, LATER_CP, SEL, advance, blockAt, laterLogs, mk, rewardData, world } from "./reseedTestWorld";

const coverageOk = { blockscoutNewest: CP, blockscoutHorizon: CP, tailFromRpc: false, rpcFailedChunks: 0 };
const rpcOk = { identical: true, onlyBlockscout: 0, onlyRpc: 0, different: 0, failedChunks: 0 };
const gate = (r: PlanReport, id: string) => r.gates.find((g) => g.id === id)!;

function base() {
  const w = world();
  const expected = totalsOf(derive(w.complete));
  const input: PlanInput = { logs: w.all, checkpointBlock: CP, detailSinceBlock: D, expected };
  return { ...w, expected, input };
}
const dayOf = (block: number) => new Date((Date.parse("2026-09-24T21:23:50Z") / 1000 + block - 78_384_272) * 1000).toISOString().slice(0, 10);

describe("planReseed from the public response alone", () => {
  it("locates the gap exactly and proves it explains every public series", () => {
    const { all, gap, stored, complete, input } = base();
    const r = planReseed({ ...input, publicStats: derive(stored) });
    expect(r.mode).toBe("public");
    expect(r.ok).toBe(true);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]).toMatchObject({ fromBlock: gap[0].blockNumber, toBlock: gap[gap.length - 1].blockNumber, logs: gap.length, equivalentCandidates: 1 });
    expect(r.holes!.newWallets).toBe(Object.keys(complete.addrs).length - Object.keys(stored.addrs).length);
    // The counted logs either side of the hole bound where its edges can sit.
    const idx = all.findIndex((l) => l === gap[0]);
    expect(r.windows[0].lastCountedBefore).toBe(all[idx - 1].blockNumber);
    expect(r.windows[0].firstCountedAfter).toBe(all[idx + gap.length].blockNumber);
    expect(r.windows[0].lastCountedBefore!).toBeLessThan(r.windows[0].fromBlock);
    expect(r.windows[0].firstCountedAfter!).toBeGreaterThan(r.windows[0].toBlock);
    expect(r.shortfallDays.map((d) => d.day)).toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
    expect(gate(r, "explains-everything").status).toBe("pass");
    expect(gate(r, "rewards-preserved").status).toBe("pass");
    expect(r.replacement).toEqual(totalsOf(derive(complete)));
    expect(r.rows.every((x) => x.replacementOk && x.expectedOk)).toBe(true);
  });

  it("is never 'ready to apply': that needs the operator's snapshot", () => {
    const { stored, input } = base();
    const r = planReseed({ ...input, publicStats: derive(stored), coverage: coverageOk, rpcGapCheck: rpcOk });
    expect(r.readyToApply).toBe(false);
    expect(gate(r, "only-the-gap-changed").status).toBe("skipped");
    expect(gate(r, "app-accepts").status).toBe("skipped");
  });

  it("a hole inside a single day is still found, and several equivalent runs are reported honestly", () => {
    const { all, opts, input } = base();
    const day = all.filter((l) => dayOf(l.blockNumber) === "2026-10-05");
    const stored = buildState(all.filter((l) => !day.slice(1, 3).includes(l)), opts);
    const r = planReseed({ ...input, publicStats: derive(stored) });
    expect(r.ok).toBe(true);
    expect(r.windows[0].equivalentCandidates).toBeGreaterThanOrEqual(1);
  });
});

describe("planReseed with the operator's snapshot", () => {
  it("is ready to apply when every gate passes, and the replacement is a complete scan", () => {
    const { gap, stored, complete, input } = base();
    const r = planReseed({ ...input, snapshot: stored, coverage: coverageOk, rpcGapCheck: rpcOk });
    expect(r.ok).toBe(true);
    expect(r.readyToApply).toBe(true);
    expect(r.gates.every((g) => g.status === "pass")).toBe(true);
    expect(canonical(r.replacementState)).toBe(canonical(complete));
    expect(r.gapLogs).toHaveLength(gap.length);
    expect(r.holes!.newWallets).toBeGreaterThanOrEqual(3);
  });

  it("is not ready while a required check is still skipped", () => {
    const { stored, input } = base();
    const noRpc = planReseed({ ...input, snapshot: stored, coverage: coverageOk });
    expect(noRpc.ok).toBe(true);
    expect(noRpc.readyToApply).toBe(false);
    expect(gate(noRpc, "rpc-confirms-gap").status).toBe("skipped");
    const noCoverage = planReseed({ ...input, snapshot: stored, rpcGapCheck: rpcOk });
    expect(noCoverage.readyToApply).toBe(false);
  });

  it("does not modify the snapshot or the logs it is given", () => {
    const { all, stored, input } = base();
    const s0 = canonical(stored), l0 = canonical(all);
    planReseed({ ...input, snapshot: stored, coverage: coverageOk, rpcGapCheck: rpcOk });
    expect(canonical(stored)).toBe(s0);
    expect(canonical(all)).toBe(l0);
  });

  it("finds nothing to do when the stored aggregate is already complete", () => {
    const { complete, input } = base();
    const r = planReseed({ ...input, snapshot: complete, coverage: coverageOk, rpcGapCheck: rpcOk });
    expect(r.nothingToDo).toBe(true);
    expect(r.windows).toEqual([]);
    expect(r.holes).toBeNull();
    expect(r.readyToApply).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("stops when the shortfall is inside the per-day detail period, which a merge cannot repair", () => {
    const { all, opts, input } = base();
    const missing = all.find((l) => l.blockNumber === blockAt("2026-11-05", 10))!;
    const stored = buildState(all.filter((l) => l !== missing), opts);
    const snap = planReseed({ ...input, snapshot: stored, coverage: coverageOk, rpcGapCheck: rpcOk });
    expect(snap.ok).toBe(false);
    expect(snap.readyToApply).toBe(false);
    expect(gate(snap, "explains-everything").detail).toMatch(/per-day detail/);
  });
});

describe("planReseed with several separate holes (production had two: 25 Sep and 6 Oct)", () => {
  const dayLogs = (all: ReturnType<typeof base>["all"], day: string) => all.filter((l) => dayOf(l.blockNumber) === day);
  function twoHoles() {
    const b = base();
    const partial = dayLogs(b.all, "2026-09-25").slice(2, 6);
    const whole = dayLogs(b.all, "2026-10-06");
    const stored = buildState(b.all.filter((l) => !partial.includes(l) && !whole.includes(l)), b.opts);
    return { ...b, partial, whole, stored };
  }

  it("finds both, from the public response alone", () => {
    const { input, stored, partial, whole, complete } = twoHoles();
    const r = planReseed({ ...input, publicStats: derive(stored) });
    expect(r.ok).toBe(true);
    expect(r.windows.map((w) => w.days)).toEqual([["2026-09-25"], ["2026-10-06"]]);
    expect(r.windows[1]).toMatchObject({ logs: whole.length, fromBlock: whole[0].blockNumber, toBlock: whole[whole.length - 1].blockNumber, equivalentCandidates: 1 });
    expect(r.windows[0].logs).toBe(partial.length);
    expect(r.holes!.logs).toBe(partial.length + whole.length);
    expect(r.replacement).toEqual(totalsOf(derive(complete)));
  });

  it("merges both from the snapshot, and the result is a complete scan", () => {
    const { input, stored, complete } = twoHoles();
    const r = planReseed({ ...input, snapshot: stored, coverage: coverageOk, rpcGapCheck: rpcOk });
    expect(r.readyToApply).toBe(true);
    expect(canonical(r.replacementState)).toBe(canonical(complete));
    expect(r.gapLogs).toHaveLength(r.holes!.logs);
  });

  it("reports the holes in block order with their own bounds", () => {
    const { input, stored } = twoHoles();
    const r = planReseed({ ...input, publicStats: derive(stored) });
    expect(r.windows[0].toBlock).toBeLessThan(r.windows[1].fromBlock);
    expect(r.windows[0].firstCountedAfter!).toBeGreaterThan(r.windows[0].toBlock);
    expect(r.windows[1].lastCountedBefore!).toBeLessThan(r.windows[1].fromBlock);
  });

  it("finds three holes at once", () => {
    const { all, opts, input } = twoHoles();
    const pickLogs = (day: string) => dayLogs(all, day).slice(0, 2);
    const hole = new Set([...pickLogs("2026-09-12"), ...pickLogs("2026-09-30"), ...pickLogs("2026-10-15")]);
    const stored = buildState(all.filter((l) => !hole.has(l)), opts);
    const r = planReseed({ ...input, publicStats: derive(stored) });
    expect(r.ok).toBe(true);
    expect(r.windows).toHaveLength(3);
  });

  it("refuses, rather than guesses, when the candidate combinations are more than it will try", () => {
    const { input, stored } = twoHoles();
    const r = planReseed({ ...input, publicStats: derive(stored), maxCombinations: 1 });
    expect(gate(r, "explains-everything").status).toBe("fail");
    expect(gate(r, "explains-everything").detail).toMatch(/more than the 1 tried/);
    expect(r.ok).toBe(false);
    expect(r.windows).toEqual([]);
  });
});

describe("planReseed stops on anything that is not a clean hole", () => {
  it("a stored series with MORE logs than a complete scan is a different problem", () => {
    const { rest, opts, input } = base();
    const stored = buildState([...rest, mk(SEL.session, 1, blockAt("2026-10-01", 20), 8)], opts);
    const r = planReseed({ ...input, publicStats: derive(stored) });
    expect(gate(r, "no-extras").status).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("a shortfall that cannot be a set of contiguous runs is refused", () => {
    // Three consecutive short days where the middle one is only partly short: no single run produces that.
    const { all, opts, input } = base();
    const d1 = all.filter((l) => dayOf(l.blockNumber) === "2026-09-12" && l.topics.length > 1).slice(-1);
    const d2 = all.filter((l) => dayOf(l.blockNumber) === "2026-09-13" && l.topics.length > 1).slice(0, 1);
    const d3 = all.filter((l) => dayOf(l.blockNumber) === "2026-09-14" && l.topics.length > 1).slice(0, 1);
    const stored = buildState(all.filter((l) => !d1.includes(l) && !d2.includes(l) && !d3.includes(l)), opts);
    const r = planReseed({ ...input, publicStats: derive(stored) });
    expect(gate(r, "contiguous").status).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("a gap that contains a reward payment fails the rewards gate (and says why)", () => {
    const { all, opts, input } = base();
    const reward = all.find((l) => l.topics[0] === SEL.reward && dayOf(l.blockNumber) === "2026-09-15")!;
    const stored = buildState(all.filter((l) => l !== reward), opts);
    const r = planReseed({ ...input, snapshot: stored, coverage: coverageOk, rpcGapCheck: rpcOk });
    expect(gate(r, "rewards-preserved").status).toBe("fail");
    expect(gate(r, "rewards-preserved").detail).toContain("the gap itself contains 1 RewardPaid logs");
    expect(gate(r, "rewards-preserved").detail).toMatch(/rewards paid changed|G\$ paid changed/);
    expect(r.ok).toBe(false);
  });

  it("expected totals that do not match are named", () => {
    const { stored, expected, input } = base();
    const r = planReseed({ ...input, expected: { ...expected, playerWallets: 999 }, publicStats: derive(stored) });
    expect(gate(r, "expected-totals").status).toBe("fail");
    expect(gate(r, "expected-totals").detail).toContain("playerWallets");
  });

  it("a snapshot taken at a different checkpoint than the comparison is refused", () => {
    const { stored, input } = base();
    const r = planReseed({ ...input, snapshot: { ...structuredClone(stored), checkpointBlock: CP - 1 }, coverage: coverageOk, rpcGapCheck: rpcOk });
    expect(gate(r, "snapshot-matches").status).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("a log list that does not reach the checkpoint is refused unless the tail came from RPC", () => {
    const { stored, input } = base();
    const behind = { blockscoutNewest: CP, blockscoutHorizon: CP - 100, tailFromRpc: false, rpcFailedChunks: 0 };
    expect(gate(planReseed({ ...input, snapshot: stored, coverage: behind, rpcGapCheck: rpcOk }), "log-source-complete").status).toBe("fail");
    expect(gate(planReseed({ ...input, snapshot: stored, coverage: { ...behind, tailFromRpc: true }, rpcGapCheck: rpcOk }), "log-source-complete").status).toBe("pass");
    expect(gate(planReseed({ ...input, snapshot: stored, coverage: { ...coverageOk, rpcFailedChunks: 1 }, rpcGapCheck: rpcOk }), "log-source-complete").status).toBe("fail");
  });

  it("RPC disagreeing with Blockscout about the gap's logs fails the independent check", () => {
    const { stored, input } = base();
    const r = planReseed({ ...input, snapshot: stored, coverage: coverageOk, rpcGapCheck: { ...rpcOk, identical: false, onlyBlockscout: 2 } });
    expect(gate(r, "rpc-confirms-gap").status).toBe("fail");
    expect(r.readyToApply).toBe(false);
  });

  it("needs either a snapshot or the public response", () => {
    expect(() => planReseed({ logs: [], checkpointBlock: CP, detailSinceBlock: D })).toThrow(/snapshot or the public/);
  });
});

describe("verifyApplyInputs: what the apply step re-checks from the files alone", () => {
  function files() {
    const { stored, input } = base();
    const plan = planReseed({ ...input, snapshot: stored, coverage: coverageOk, rpcGapCheck: rpcOk });
    const snapshotRaw = JSON.stringify(stored);
    const replacementRaw = JSON.stringify(plan.replacementState);
    const gapLogsRaw = JSON.stringify(plan.gapLogs);
    const report = {
      mode: plan.mode, readyToApply: plan.readyToApply,
      inputs: { stored: { sha256: digest("sha256", snapshotRaw) }, replacement: { sha256: digest("sha256", replacementRaw) }, gapLogs: { sha256: digest("sha256", gapLogsRaw) } },
    };
    return { snapshotRaw, replacementRaw, gapLogsRaw, report, plan };
  }

  it("accepts what a clean dry run produced (including wallets the gap touches but did not introduce)", () => {
    const f = files();
    expect(f.plan.holes!.touchedWallets).toBeGreaterThan(f.plan.holes!.newWallets); // some wallets already existed
    expect(verifyApplyInputs(f).problems).toEqual([]);
  });

  it("refuses a replacement with a single byte changed, saying why", () => {
    const f = files();
    const problems = verifyApplyInputs({ ...f, replacementRaw: f.replacementRaw.replace(/"totalLogs":\d+/, (m) => `"totalLogs":${Number(m.split(":")[1]) + 1}`) }).problems.join("\n");
    expect(problems).toMatch(/replacement-state.json is not the one the dry run wrote/);
    expect(problems).toMatch(/not exactly the snapshot with these gap logs merged in/);
    expect(problems).toMatch(/totalLogs rose by/);
  });

  it("refuses a replacement that is a valid state but not the merge of THIS snapshot and THESE logs, even if its checksum was updated to match", () => {
    const f = files();
    const other = JSON.stringify({ ...JSON.parse(f.replacementRaw), updatedAt: "2026-12-01T00:00:00.000Z" });
    const report = { ...f.report, inputs: { ...f.report.inputs, replacement: { sha256: digest("sha256", other) } } };
    const problems = verifyApplyInputs({ ...f, replacementRaw: other, report }).problems.join("\n");
    expect(problems).toMatch(/not exactly the snapshot with these gap logs merged in/);
    expect(problems).toMatch(/updatedAt changed/);
  });

  it("refuses gap logs that were changed after the dry run", () => {
    const f = files();
    const logs = JSON.parse(f.gapLogsRaw);
    logs.pop();
    expect(verifyApplyInputs({ ...f, gapLogsRaw: JSON.stringify(logs) }).problems.join("\n")).toMatch(/gap-logs.json is not the one the dry run wrote/);
  });

  it("refuses a snapshot other than the one the dry run saw", () => {
    const f = files();
    const edited = JSON.stringify({ ...JSON.parse(f.snapshotRaw), updatedAt: "2026-11-08T00:00:00.000Z" });
    expect(verifyApplyInputs({ ...f, snapshotRaw: edited }).problems.join("\n")).toMatch(/not the one the dry run was made from/);
  });

  it("refuses a report that was not 'ready to apply', or came from the public response", () => {
    const f = files();
    expect(verifyApplyInputs({ ...f, report: { ...f.report, readyToApply: false } }).problems.join("\n")).toMatch(/not 'ready to apply'/);
    expect(verifyApplyInputs({ ...f, report: { ...f.report, mode: "public" } }).problems.join("\n")).toMatch(/public response/);
  });

  it("refuses gap logs that fall inside the per-day detail period, which a merge cannot repair", () => {
    const f = files();
    const late = JSON.stringify([mk(SEL.session, 1, blockAt("2026-11-05", 12), 9)]);
    const report = { ...f.report, inputs: { ...f.report.inputs, gapLogs: { sha256: digest("sha256", late) } } };
    expect(verifyApplyInputs({ ...f, gapLogsRaw: late, report }).problems.join("\n")).toMatch(/gap_in_detail_coverage/);
  });

  it("refuses a replacement that changes rewards or G$ paid, even when the gap explains it and every checksum agrees", () => {
    const { rest, opts } = world();
    const stored = buildState(rest, opts);
    const reward = mk(SEL.reward, 3, blockAt("2026-09-23", 20), 9, rewardData(256, 5n * 10n ** 18n));
    const merged = mergeGapLogs(stored, [reward]); // internally consistent: the gap does explain the change
    const snapshotRaw = JSON.stringify(stored), replacementRaw = JSON.stringify(merged.state), gapLogsRaw = JSON.stringify([reward]);
    const report = { mode: "snapshot", readyToApply: true, inputs: { stored: { sha256: digest("sha256", snapshotRaw) }, replacement: { sha256: digest("sha256", replacementRaw) }, gapLogs: { sha256: digest("sha256", gapLogsRaw) } } };
    const problems = verifyApplyInputs({ snapshotRaw, replacementRaw, gapLogsRaw, report }).problems;
    expect(problems.join("\n")).toMatch(/rewards paid changed/);
    expect(problems.join("\n")).toMatch(/G\$ paid changed/);
    expect(problems.join("\n")).not.toMatch(/not exactly the snapshot/); // everything else about it is consistent
  });

  it("refuses files that are not what the app writes", () => {
    const f = files();
    expect(verifyApplyInputs({ ...f, snapshotRaw: f.snapshotRaw + "\n" }).problems.join("\n")).toMatch(/snapshot:/);
    expect(verifyApplyInputs({ ...f, gapLogsRaw: "not json" }).problems.join("\n")).toMatch(/gap-logs.json is not valid JSON/);
  });
});

describe("applyResolver and rollbackResolver: deciding from the value actually stored", () => {
  function setup() {
    const { all, stored, input } = base();
    const plan = planReseed({ ...input, snapshot: stored, coverage: coverageOk, rpcGapCheck: rpcOk });
    const snapshotRaw = JSON.stringify(stored), replacementRaw = JSON.stringify(plan.replacementState), gapLogsRaw = JSON.stringify(plan.gapLogs);
    return { all, stored, plan, snapshotRaw, replacementRaw, gapLogsRaw, apply: applyResolver({ snapshotRaw, replacementRaw, gapLogsRaw }), rollback: rollbackResolver({ snapshotRaw, replacementRaw }) };
  }
  const norm = (raw: string) => canonical({ ...JSON.parse(raw), updatedAt: "X" });

  it("the stored value is the snapshot: it writes exactly the replacement the dry run produced", () => {
    const t = setup();
    expect(t.apply(t.snapshotRaw)).toEqual({ newRaw: t.replacementRaw });
  });

  it("the app has refreshed since: it merges the same gap into the value actually stored, and the result is a complete scan at the LATER checkpoint", () => {
    const t = setup();
    const later = advance(t.stored, laterLogs(), LATER_CP);
    const r = t.apply(JSON.stringify(later));
    if (!("newRaw" in r)) throw new Error(`refused: ${r.refuse}`);
    const complete = buildState([...t.all, ...laterLogs()], { checkpointBlock: LATER_CP, detailSinceBlock: D, updatedAt: "X" });
    expect(norm(r.newRaw)).toBe(canonical({ ...complete, updatedAt: "X" }));
    expect(r.newRaw).not.toBe(t.replacementRaw);
  });

  it("refuses a value that already has the gap in it, so a second apply cannot count it twice", () => {
    const t = setup();
    const r = t.apply(t.replacementRaw);
    expect(r).toHaveProperty("refuse");
    expect((r as { refuse: string }).refuse).toMatch(/not the snapshot plus later scans/);
    const advanced = JSON.stringify(advance(JSON.parse(t.replacementRaw), laterLogs(), LATER_CP));
    expect(t.apply(advanced)).toHaveProperty("refuse");
  });

  it("refuses anything that is not the snapshot plus later scans", () => {
    const t = setup();
    expect((t.apply("not json") as { refuse: string }).refuse).toMatch(/not a usable aggregate/);
    expect((t.apply(JSON.stringify({ ...t.stored, checkpointBlock: t.stored.checkpointBlock - 1 })) as { refuse: string }).refuse).toMatch(/checkpoint went back/);
    const rewritten = structuredClone(t.stored); rewritten.dailyEvents["2026-10-01"] = (rewritten.dailyEvents["2026-10-01"] ?? 0) + 1; rewritten.totalLogs += 1;
    expect((t.apply(JSON.stringify(rewritten)) as { refuse: string }).refuse).toMatch(/dailyEvents 2026-10-01/);
  });

  it("on the rebased path it still refuses a merge that would change rewards or G$ paid", () => {
    const { rest, opts } = world();
    const stored = buildState(rest, opts);
    const reward = mk(SEL.reward, 3, blockAt("2026-09-23", 20), 9, rewardData(256, 5n * 10n ** 18n));
    const snapshotRaw = JSON.stringify(stored), gapLogsRaw = JSON.stringify([reward]);
    const replacementRaw = JSON.stringify(mergeGapLogs(stored, [reward]).state);
    const resolver = applyResolver({ snapshotRaw, replacementRaw, gapLogsRaw });
    const moved = JSON.stringify(advance(stored, laterLogs(), LATER_CP));
    const r = resolver(moved);
    expect((r as { refuse: string }).refuse).toMatch(/rewards paid changed/);
    expect((r as { refuse: string }).refuse).toMatch(/G\$ paid changed/);
  });

  it("a rollback accepts the replacement, and the replacement plus later scans, and refuses the rest", () => {
    const t = setup();
    expect(t.rollback(t.replacementRaw)).toEqual({ newRaw: t.snapshotRaw });
    const later = JSON.stringify(advance(JSON.parse(t.replacementRaw), laterLogs(), LATER_CP));
    expect(t.rollback(later)).toEqual({ newRaw: t.snapshotRaw });
    expect((t.rollback(t.snapshotRaw) as { refuse: string }).refuse).toMatch(/nothing to roll back/);
    const odd = JSON.stringify(buildState(t.all.slice(10), { checkpointBlock: CP, detailSinceBlock: D, updatedAt: "X" }));
    expect((t.rollback(odd) as { refuse: string }).refuse).toMatch(/--current-sha256/);
    expect((t.rollback("{") as { refuse: string }).refuse).toMatch(/--current-sha256/);
  });

  it("a rollback of anything else needs the operator to name the value by its SHA-256", () => {
    const t = setup();
    const odd = JSON.stringify(buildState(t.all.slice(10), { checkpointBlock: CP, detailSinceBlock: D, updatedAt: "X" }));
    const named = rollbackResolver({ snapshotRaw: t.snapshotRaw, replacementRaw: t.replacementRaw, acknowledgedSha256: digest("sha256", odd) });
    expect(named(odd)).toEqual({ newRaw: t.snapshotRaw });
    const wrong = rollbackResolver({ snapshotRaw: t.snapshotRaw, replacementRaw: t.replacementRaw, acknowledgedSha256: "0".repeat(64) });
    expect(wrong(odd)).toHaveProperty("refuse");
  });
});
