/**
 * The dry run of a stats reseed, as one pure function: from a complete list of the contract's logs
 * and either the operator's snapshot of the stored aggregate or just the public /api/stats response,
 * work out where the hole is, prove it explains every public number, and say whether a merge is safe.
 *
 * Nothing here touches Redis or the network. scripts/analytics/reseed-dry-run.ts feeds it and
 * prints/writes the result; docs/runbooks/STATS_RESEED.md says what to do with it.
 */
import { derive, type StatsSnapshot, type StatsState } from "./state";
import { digest } from "./reseedHash";
import { blockToUnix } from "./config";
import {
  PUBLIC_IGNORE, ReseedError, acceptedByApp, buildState, canonical, compareTotals, diffJson, explainDiff, localizeGap, mergeGapLogs,
  isDescendant, parseSnapshot, rewardsPreserved, sortLogs, summariseGap, totalsOf, verifyLaterScansOnly, windowClusters, withoutWindows,
  type DayGap, type GapLog, type GapReport, type Totals, type WindowCandidate,
} from "./reseed";

export interface Coverage {
  /** Newest block Blockscout returned. */
  blockscoutNewest: number;
  /** Logs at or below this block came from Blockscout; above it from RPC (Blockscout's newest blocks can still be filling in). */
  blockscoutHorizon: number;
  /** Whether the stretch above the horizon, up to the checkpoint, was read from RPC. */
  tailFromRpc: boolean;
  /** RPC chunks where every read failed. Anything above zero means the log list is incomplete. */
  rpcFailedChunks: number;
}

export interface RpcGapCheck { identical: boolean; onlyBlockscout: number; onlyRpc: number; different: number; failedChunks: number }

export interface PlanInput {
  /** Every log up to the checkpoint. */
  logs: ReadonlyArray<GapLog>;
  checkpointBlock: number;
  detailSinceBlock: number | null;
  /** The stored aggregate exactly as the operator snapshotted it. Without it the plan is built from `publicStats` alone. */
  snapshot?: StatsState;
  /** GET /api/stats, public. */
  publicStats?: StatsSnapshot;
  expected?: Totals;
  coverage?: Coverage;
  /** Whether the located gap's logs were re-read from RPC and found identical; omit if that was not run. */
  rpcGapCheck?: RpcGapCheck | null;
  /** Most combinations of per-hole candidate runs to try (default 5,000). More is refused as too ambiguous to infer. */
  maxCombinations?: number;
}

export type GateStatus = "pass" | "fail" | "skipped";
export interface Gate { id: string; title: string; status: GateStatus; detail: string }

export interface PlanReport {
  mode: "snapshot" | "public";
  checkpointBlock: number;
  detailSinceBlock: number | null;
  logsRead: number;
  /** What is stored now. */
  current: Totals;
  /** A complete scan, from the logs. */
  independent: Totals;
  /** What the stored aggregate will show after the merge. Equals `independent` when every gate passes. */
  replacement: Totals;
  expected?: Totals;
  rows: Array<{ metric: keyof Totals; current: number; replacement: number; expected?: number; replacementOk: boolean; expectedOk?: boolean }>;
  shortfallDays: DayGap[];
  /** Each hole the plan found, in block order. Empty when there is nothing to do or no explanation was found. */
  windows: Array<{
    /** The days it covers. */
    days: string[];
    fromBlock: number; toBlock: number; fromTime: string; toTime: string; logs: number;
    byEvent: Record<string, number>; byDay: Record<string, number>;
    /** How many different runs of logs fit this hole equally well (1 unless it sits inside a single day). */
    equivalentCandidates: number;
    /**
     * The nearest logs that ARE counted on each side. The hole is every log from `fromBlock` to `toBlock`;
     * any boundary placed between `lastCountedBefore` and `fromBlock`, or `toBlock` and `firstCountedAfter`, is equivalent.
     */
    lastCountedBefore: number | null;
    firstCountedAfter: number | null;
  }>;
  /** All the holes together. `newWallets` is -1 only when it cannot be known. */
  holes: null | { logs: number; byEvent: Record<string, number>; newWallets: number; touchedWallets: number; combinationsThatFit: number };
  gates: Gate[];
  /** No gate failed. */
  ok: boolean;
  /** Snapshot mode, nothing failed and nothing was skipped: the replacement may be applied by the operator. */
  readyToApply: boolean;
  nothingToDo: boolean;
  gapLogs?: GapLog[];
  replacementState?: StatsState;
  /** What /api/stats should serve once the replacement is in place (before any later scans): the input to the post-reseed verification. */
  expectedView: StatsSnapshot;
}

const FIXED_AT = "1970-01-01T00:00:00.000Z";
/** Most combinations of per-hole candidates tried; more than this means the hole is too ambiguous to infer from public data. */
const MAX_COMBINATIONS = 5_000;
const iso = (block: number) => new Date(blockToUnix(block) * 1000).toISOString();
const pick = (s: StatsState) => canonical({ totalLogs: s.totalLogs, eventCounts: s.eventCounts, dailyEvents: s.dailyEvents, rewardPaidWei: s.rewardPaidWei, addrs: s.addrs });

export function planReseed(inp: PlanInput): PlanReport {
  if (!inp.snapshot && !inp.publicStats) throw new Error("planReseed needs the snapshot or the public stats response");
  const mode: PlanReport["mode"] = inp.snapshot ? "snapshot" : "public";
  const logs = sortLogs(inp.logs.filter((l) => l.blockNumber <= inp.checkpointBlock));
  const build = { checkpointBlock: inp.checkpointBlock, detailSinceBlock: inp.detailSinceBlock, updatedAt: FIXED_AT };
  const complete = buildState(logs, build);
  const completeView = derive(complete);
  const currentView: StatsSnapshot = inp.snapshot ? derive(inp.snapshot) : inp.publicStats!;
  const gates: Gate[] = [];
  const gate = (id: string, title: string, status: GateStatus, detail: string) => { gates.push({ id, title, status, detail }); };
  const verdict = (ok: boolean): GateStatus => (ok ? "pass" : "fail");

  // The inputs describe the same state.
  if (inp.snapshot) {
    const sameDetail = (inp.snapshot.detailSinceBlock ?? null) === inp.detailSinceBlock;
    gate("snapshot-matches", "The snapshot's checkpoint and detail start are the ones used to build the comparison",
      verdict(inp.snapshot.checkpointBlock === inp.checkpointBlock && sameDetail),
      `snapshot checkpoint ${inp.snapshot.checkpointBlock}, detail from ${inp.snapshot.detailSinceBlock ?? "none"}; built at ${inp.checkpointBlock}, detail from ${inp.detailSinceBlock ?? "none"}`);
  } else if (inp.publicStats) {
    gate("public-matches", "The public response's checkpoint and detail start are the ones used to build the comparison",
      verdict(inp.publicStats.checkpointBlock === inp.checkpointBlock && (inp.publicStats.detail.sinceBlock ?? null) === inp.detailSinceBlock),
      `public checkpoint ${inp.publicStats.checkpointBlock}, detail from ${inp.publicStats.detail.sinceBlock ?? "none"}`);
  }

  if (inp.coverage) {
    const c = inp.coverage;
    const covered = c.rpcFailedChunks === 0 && (inp.checkpointBlock <= c.blockscoutHorizon || c.tailFromRpc);
    gate("log-source-complete", "The log list covers every block up to the checkpoint",
      verdict(covered),
      `Blockscout is trusted to block ${c.blockscoutHorizon} (its newest log is ${c.blockscoutNewest}); checkpoint ${inp.checkpointBlock}; newest stretch read from RPC: ${c.tailFromRpc ? "yes" : "no"}; RPC chunks that failed outright: ${c.rpcFailedChunks}`);
  } else gate("log-source-complete", "The log list covers every block up to the checkpoint", "skipped", "no coverage information was supplied");

  const loc = localizeGap(currentView.daily, completeView.daily);
  const nothingToDo = loc.days.length === 0;
  gate("shortfall-found", "A shortfall exists to correct", "pass", nothingToDo ? "no day differs: the stored series already matches a complete scan" : `${loc.totalMissing} logs short across ${loc.days.length} day(s): ${loc.days.map((d) => `${d.day} -${d.missing}`).join(", ")}`);
  gate("no-extras", "The stored series never has MORE than a complete scan", verdict(loc.extras.length === 0),
    loc.extras.length ? `extras on ${loc.extras.map((d) => `${d.day} (+${-d.missing})`).join(", ")}: this is a different problem, not a hole` : "none");

  const missingByDay = Object.fromEntries(loc.days.filter((d) => d.missing > 0).map((d) => [d.day, d.missing]));
  const search = windowClusters(logs, missingByDay);
  gate("contiguous", "The shortfall is one or more contiguous runs of logs, each a separate hole", verdict(nothingToDo || search.ok),
    search.ok ? `${search.clusters.length} hole(s): ${search.clusters.map((c) => `${c.days.join("..")} (${c.candidates.length} candidate run${c.candidates.length === 1 ? "" : "s"})`).join("; ")}` : (search.reason ?? "not contiguous"));

  // Which combination of candidate runs (one per hole) explains the public numbers exactly?
  const lists = search.clusters.map((c) => c.candidates);
  const combos = lists.length === 0 ? 0 : lists.reduce((n, l) => n * l.length, 1);
  type Evaluated = { windows: WindowCandidate[]; merged?: ReturnType<typeof mergeGapLogs>; sample: string[] };
  const exact: Evaluated[] = [];
  let firstFailure: Evaluated | null = null;
  const maxCombos = inp.maxCombinations ?? MAX_COMBINATIONS;
  const tooMany = combos > maxCombos;
  if (!tooMany && combos > 0) {
    const pickIdx = Array.from({ length: lists.length }, () => 0);
    for (let k = 0; k < combos; k++) {
      const windows = pickIdx.map((i, c) => lists[c][i]);
      let ev: Evaluated;
      if (inp.snapshot) {
        const gapLogs = windows.flatMap((w) => logs.slice(w.fromIndex, w.toIndex + 1));
        try {
          const merged = mergeGapLogs(inp.snapshot, gapLogs);
          const diffs = diffJson(derive(merged.state), completeView, PUBLIC_IGNORE, 3);
          const agg = pick(merged.state) === pick(complete);
          ev = { windows, merged, sample: diffs.map((d) => `${d.path}: ${String(d.a)} vs ${String(d.b)}`).concat(agg ? [] : ["aggregate fields differ from a complete scan"]) };
        } catch (e) { ev = { windows, sample: [(e as Error).message] }; }
      } else {
        const diffs = diffJson(derive(buildState(withoutWindows(logs, windows), build)), currentView, PUBLIC_IGNORE, 3);
        ev = { windows, sample: diffs.map((d) => `${d.path}: ${String(d.a)} (without the runs) vs ${String(d.b)} (stored)`) };
      }
      if (ev.sample.length === 0) exact.push(ev); else firstFailure ??= ev;
      for (let c = pickIdx.length - 1; c >= 0; c--) { if (++pickIdx[c] < lists[c].length) break; pickIdx[c] = 0; }
    }
  }
  const chosen = exact[0] ?? null;
  gate("explains-everything", inp.snapshot ? "Merging the runs reproduces a complete scan exactly (every public series and every aggregate field)" : "Removing exactly these runs reproduces every public series exactly",
    nothingToDo ? "skipped" : verdict(chosen !== null),
    nothingToDo ? "nothing to explain" : tooMany ? `${combos} combinations of candidate runs is more than the ${maxCombos} tried; run again with the operator's snapshot, which narrows it by wallet`
      : chosen ? `${exact.length} combination(s) of ${combos} fit exactly${exact.length > 1 ? "; they are equivalent in effect" : ""}`
        : `none of ${combos} combinations fits; closest left: ${(firstFailure?.sample ?? ["no candidate runs"]).join("; ")}`);

  const chosenWindows = chosen?.windows ?? [];
  const gapLogs = chosen ? chosenWindows.flatMap((w) => logs.slice(w.fromIndex, w.toIndex + 1)) : undefined;
  const gapReport: GapReport | null = chosen ? (chosen.merged?.report ?? summariseGap(gapLogs!)) : null;
  const replacementState = chosen?.merged?.state;

  // Rewards and G$ paid must come through unchanged.
  if (chosen && gapReport) {
    const problems = inp.snapshot && replacementState
      ? rewardsPreserved(inp.snapshot, replacementState)
      : [
          ...(currentView.totals.rewardsPaid !== completeView.totals.rewardsPaid ? [`rewards paid ${currentView.totals.rewardsPaid} vs ${completeView.totals.rewardsPaid}`] : []),
          ...(currentView.gDollarPaid !== completeView.gDollarPaid ? [`G$ paid ${currentView.gDollarPaid} vs ${completeView.gDollarPaid}`] : []),
        ];
    if ((gapReport.byEvent.RewardPaid ?? 0) > 0) problems.push(`the gap itself contains ${gapReport.byEvent.RewardPaid} RewardPaid logs`);
    gate("rewards-preserved", "Rewards paid and G$ paid are unchanged by the merge", verdict(problems.length === 0),
      problems.length ? problems.join("; ") : `rewards paid ${currentView.totals.rewardsPaid} and G$ paid ${currentView.gDollarPaid} before and after; the gap has none`);
  } else gate("rewards-preserved", "Rewards paid and G$ paid are unchanged by the merge", nothingToDo ? "skipped" : "fail", "no gap was identified");

  if (inp.snapshot && chosen?.merged) {
    const problems = explainDiff(inp.snapshot, chosen.merged.state, chosen.merged.report);
    gate("only-the-gap-changed", "Only what the gap explains changed (checkpoint, timestamp, detail, feed, tally and every other wallet are untouched)", verdict(problems.length === 0), problems.length ? problems.join("; ") : "verified field by field");
    gate("app-accepts", "The app's own loader accepts the replacement", verdict(acceptedByApp(chosen.merged.state)), "parseStoredState on the replacement");
  } else {
    gate("only-the-gap-changed", "Only what the gap explains changed", "skipped", "needs the operator's snapshot (a public response cannot show the untouched fields)");
    gate("app-accepts", "The app's own loader accepts the replacement", "skipped", "needs the operator's snapshot");
  }

  const independent = totalsOf(completeView);
  const replacement = replacementState ? totalsOf(derive(replacementState)) : independent;
  if (inp.expected) {
    const cmp = compareTotals(replacement, inp.expected);
    gate("expected-totals", "The replacement totals equal the expected totals", verdict(cmp.ok), cmp.ok ? "all seven metrics match" : cmp.rows.filter((r) => !r.ok).map((r) => `${r.metric} ${r.actual} vs expected ${r.expected}`).join("; "));
  } else gate("expected-totals", "The replacement totals equal the expected totals", "skipped", "no expected totals supplied");

  if (inp.rpcGapCheck) {
    const r = inp.rpcGapCheck;
    gate("rpc-confirms-gap", "The gap's logs, re-read from RPC, are identical to Blockscout's", verdict(r.identical && r.failedChunks === 0),
      r.identical && r.failedChunks === 0 ? "same logs, same topics and data" : `only in Blockscout ${r.onlyBlockscout}, only in RPC ${r.onlyRpc}, different content ${r.different}, failed RPC chunks ${r.failedChunks}`);
  } else gate("rpc-confirms-gap", "The gap's logs, re-read from RPC, are identical to Blockscout's", "skipped", "not run (use --rpc-verify-gap)");

  const metrics = Object.keys(independent) as Array<keyof Totals>;
  const current = totalsOf(currentView);
  const rows = metrics.map((metric) => ({
    metric, current: current[metric], replacement: replacement[metric], expected: inp.expected?.[metric],
    replacementOk: replacement[metric] === independent[metric], expectedOk: inp.expected ? replacement[metric] === inp.expected[metric] : undefined,
  }));

  const ok = gates.every((g) => g.status !== "fail");
  return {
    mode, checkpointBlock: inp.checkpointBlock, detailSinceBlock: inp.detailSinceBlock, logsRead: logs.length,
    current, independent, replacement, expected: inp.expected, rows, shortfallDays: loc.days,
    windows: chosenWindows.map((w, i) => {
      const wl = logs.slice(w.fromIndex, w.toIndex + 1), rep = summariseGap(wl);
      return {
        days: search.clusters[i].days, fromBlock: w.fromBlock, toBlock: w.toBlock, fromTime: iso(w.fromBlock), toTime: iso(w.toBlock), logs: w.count,
        byEvent: rep.byEvent, byDay: rep.byDay,
        equivalentCandidates: new Set(exact.map((e) => `${e.windows[i].fromIndex}:${e.windows[i].toIndex}`)).size,
        lastCountedBefore: w.fromIndex > 0 ? logs[w.fromIndex - 1].blockNumber : null,
        firstCountedAfter: w.toIndex + 1 < logs.length ? logs[w.toIndex + 1].blockNumber : null,
      };
    }),
    holes: chosen && gapReport ? {
      logs: gapReport.logs, byEvent: gapReport.byEvent, combinationsThatFit: exact.length, touchedWallets: gapReport.touchedWallets.length,
      newWallets: inp.snapshot ? gapReport.newWallets : completeView.playerWallets - currentView.playerWallets,
    } : null,
    gates, ok, nothingToDo,
    readyToApply: mode === "snapshot" && ok && !nothingToDo && gates.every((g) => g.status === "pass"),
    gapLogs, replacementState,
    expectedView: replacementState ? derive(replacementState) : completeView,
  };
}

// ── Re-verifying what a dry run left behind ─────────────────────────────────────────────────

export interface ReportFile {
  mode?: string;
  readyToApply?: boolean;
  inputs?: { stored?: { sha256?: string }; replacement?: { sha256?: string }; gapLogs?: { sha256?: string } };
}

/**
 * Everything the apply step checks offline, from the FILES alone, so it trusts nothing the dry run
 * merely claims. In particular it recomputes the merge from the snapshot and the gap logs and requires
 * the replacement to be exactly that, byte for byte. Empty `problems` means the files agree.
 */
export function verifyApplyInputs(i: { snapshotRaw: string; replacementRaw: string; gapLogsRaw: string; report: ReportFile }): { problems: string[]; snapshot?: StatsState; replacement?: StatsState } {
  const problems: string[] = [];
  const r = i.report;
  if (r.mode !== "snapshot") problems.push("the report was made from the public response, not from a snapshot");
  if (!r.readyToApply) problems.push("the report is not 'ready to apply': at least one gate failed or was skipped");
  if (r.inputs?.stored?.sha256 !== digest("sha256", i.snapshotRaw)) problems.push("this snapshot is not the one the dry run was made from (checksum differs)");
  if (r.inputs?.replacement?.sha256 !== digest("sha256", i.replacementRaw)) problems.push("replacement-state.json is not the one the dry run wrote (checksum differs)");
  if (r.inputs?.gapLogs?.sha256 !== digest("sha256", i.gapLogsRaw)) problems.push("gap-logs.json is not the one the dry run wrote (checksum differs)");

  let snapshot: StatsState | undefined, replacement: StatsState | undefined;
  try { snapshot = parseSnapshot(i.snapshotRaw); } catch (e) { problems.push(`snapshot: ${(e as Error).message}`); }
  try { replacement = parseSnapshot(i.replacementRaw); } catch (e) { problems.push(`replacement: ${(e as Error).message}`); }
  let gapLogs: GapLog[] | null = null;
  try { gapLogs = JSON.parse(i.gapLogsRaw) as GapLog[]; } catch { problems.push("gap-logs.json is not valid JSON"); }
  if (!snapshot || !replacement || !gapLogs) return { problems };

  try {
    const merged = mergeGapLogs(snapshot, gapLogs);
    if (JSON.stringify(merged.state) !== i.replacementRaw) problems.push("the replacement is not exactly the snapshot with these gap logs merged in");
    problems.push(...explainDiff(snapshot, replacement, merged.report));
  } catch (e) {
    problems.push(e instanceof ReseedError ? `the gap logs cannot be merged into this snapshot (${e.code}): ${e.message}` : (e as Error).message);
  }
  problems.push(...rewardsPreserved(snapshot, replacement));
  if (!acceptedByApp(replacement)) problems.push("the app's own loader would not accept the replacement");
  return { problems, snapshot, replacement };
}

// ── Deciding what to write from the value actually found ────────────────────────────────────

/** What a guarded swap writes given the value actually stored, or why it must not. */
export type Resolution = { newRaw: string } | { refuse: string };

/**
 * What `apply` decides under the lock. The app rewrites the stored value on every refresh, so by the
 * time the swap happens it is normally not byte-identical to the snapshot. Two cases are acceptable:
 *  - it IS the snapshot: write the replacement the dry run produced (already verified offline);
 *  - it is the snapshot plus only scans of later blocks (proved field by field): merge the same
 *    approved gap logs into the value actually stored. The merge is commutative, so the result is the
 *    replacement plus those later scans.
 * Anything else (the checkpoint went back, history changed, the gap is already in) is refused. That last
 * case is what stops a second apply from counting the gap twice.
 */
export function applyResolver(i: { snapshotRaw: string; replacementRaw: string; gapLogsRaw: string }): (currentRaw: string) => Resolution {
  const snapshot = parseSnapshot(i.snapshotRaw);
  const gapLogs = JSON.parse(i.gapLogsRaw) as GapLog[];
  return (currentRaw) => {
    if (currentRaw === i.snapshotRaw) return { newRaw: i.replacementRaw };
    let current: StatsState;
    try { current = parseSnapshot(currentRaw); } catch (e) { return { refuse: `the stored value is not a usable aggregate: ${(e as Error).message}` }; }
    const later = verifyLaterScansOnly(snapshot, current);
    if (later.length) return { refuse: `the stored value is not the snapshot plus later scans: ${later.slice(0, 4).join("; ")}` };
    let merged: ReturnType<typeof mergeGapLogs>;
    try { merged = mergeGapLogs(current, gapLogs); } catch (e) { return { refuse: `the approved gap logs cannot be merged into the stored value: ${(e as Error).message}` }; }
    const problems = [...explainDiff(current, merged.state, merged.report), ...rewardsPreserved(current, merged.state)];
    if (!acceptedByApp(merged.state)) problems.push("the app's own loader would not accept the result");
    if (problems.length) return { refuse: problems.slice(0, 4).join("; ") };
    return { newRaw: JSON.stringify(merged.state) };
  };
}

/**
 * What `rollback` decides under the lock: put the snapshot's exact bytes back, provided the stored value
 * is the replacement or the replacement plus later scans (so nothing the app has added is lost track of:
 * it rescans deterministically from the snapshot's checkpoint). Anything else needs the operator to say
 * they know what they are replacing, by passing the SHA-256 `status` shows.
 */
export function rollbackResolver(i: { snapshotRaw: string; replacementRaw: string; acknowledgedSha256?: string }): (currentRaw: string) => Resolution {
  const replacement = parseSnapshot(i.replacementRaw);
  return (currentRaw) => {
    if (i.acknowledgedSha256 && digest("sha256", currentRaw) === i.acknowledgedSha256) return { newRaw: i.snapshotRaw };
    if (currentRaw === i.snapshotRaw) return { refuse: "the stored value already is the snapshot: there is nothing to roll back" };
    let current: StatsState;
    try { current = parseSnapshot(currentRaw); } catch (e) { return { refuse: `the stored value is not a usable aggregate (${(e as Error).message}); pass --current-sha256 <hash from status> if you really mean to replace it` }; }
    const problems = isDescendant(replacement, current);
    if (problems.length) return { refuse: `the stored value is not the replacement or a later scan of it (${problems.slice(0, 3).join("; ")}); pass --current-sha256 <hash from status> if you really mean to replace it` };
    return { newRaw: i.snapshotRaw };
  };
}
