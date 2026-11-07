/**
 * Stats reseed helpers: correct a historical hole in the stored aggregate by MERGING the missing
 * logs into it, not by rebuilding it. Pure functions only: no Redis, no network, no clock.
 * docs/runbooks/STATS_RESEED.md is the procedure; scripts/analytics/reseed-dry-run.ts drives these.
 *
 * Why a merge and not a rebuild
 * -----------------------------
 * The aggregate grows by applyLogs() (state.ts). Every field a log touches there is a commutative
 * merge: counters add, `addrs` rows take min(first block), max(last block), sum(events, games),
 * OR(event mask) and OR(week bitmap). The only order-dependent parts are the per-day detail, the
 * recent-events feed and the season tally, and those only cover the UTC day of `detailSinceBlock`
 * (or the tally's `sinceBlock`) onward. A hole before those can therefore be filled by folding
 * the missing logs into the stored aggregate, and the result is exactly what a complete scan would
 * have produced, while every unrelated field (the detail, the feed, the checkpoint, the timestamp,
 * the rewards totals) stays byte-for-byte as it was. A rebuild from scratch (scripts/analytics/
 * seed-stats.mjs --replace) resets those fields, which is why it is not used here.
 *
 * mergeGapLogs() refuses anything it cannot prove safe in that sense (see ReseedErrorCode).
 */
import { applyLogs, derive, emptyState, type AddrRow, type RawLog, type StatsSnapshot, type StatsState } from "./state";
import { BASE_WEEK, GENESIS_BLOCK, blockToUnix, weekIndexOf } from "./config";
import { parseStoredState } from "./store";

/** A log with its position in the block, needed to tell two logs of one block apart. */
export type GapLog = RawLog & { logIndex: number };

export type ReseedErrorCode =
  | "gap_empty"
  | "gap_duplicate_log"
  | "gap_below_genesis"
  | "gap_above_checkpoint"
  | "gap_in_detail_coverage"
  | "gap_in_season_tally"
  | "snapshot_not_round_trip";

export class ReseedError extends Error {
  constructor(readonly code: ReseedErrorCode, message: string) {
    super(message);
    this.name = "ReseedError";
  }
}

export const sortLogs = <T extends RawLog & { logIndex?: number }>(logs: readonly T[]): T[] =>
  [...logs].sort((a, b) => a.blockNumber - b.blockNumber || (a.logIndex ?? 0) - (b.logIndex ?? 0));

const dayOfBlock = (block: number) => new Date(blockToUnix(block) * 1000).toISOString().slice(0, 10);

/** Stable text for a JSON value: object keys sorted, so equal values compare equal. */
export function canonical(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

// ── Building a state from a complete list of logs ───────────────────────────────────────────

export interface BuildOptions {
  /** Last block included, inclusive; logs above it are ignored. */
  checkpointBlock: number;
  /** Where per-day detail starts. Omit to track it from genesis. */
  detailSinceBlock?: number | null;
  updatedAt?: string;
}

/**
 * The state a COMPLETE scan produces, evolved the way a live aggregate evolves: history before
 * `detailSinceBlock` was applied by code that had no per-day detail, everything after by code that
 * does. That keeps `detailSinceBlock`, `dailyDetail` and `recentEvents` identical to a live state's,
 * which a single pass from genesis would not.
 */
export function buildState(logs: readonly (RawLog & { logIndex?: number })[], opts: BuildOptions): StatsState {
  const all = sortLogs(logs).filter((l) => l.blockNumber <= opts.checkpointBlock);
  const state = emptyState();
  const d = opts.detailSinceBlock ?? null;
  if (d !== null && d > GENESIS_BLOCK) {
    applyLogs(state, all.filter((l) => l.blockNumber < d), d - 1);
    delete state.dailyDetail;
    delete state.recentEvents;
    delete state.detailSinceBlock; // the next applyLogs sets it to checkpoint + 1 = d
    applyLogs(state, all.filter((l) => l.blockNumber >= d), opts.checkpointBlock);
  } else {
    applyLogs(state, all, opts.checkpointBlock);
  }
  if (opts.updatedAt) state.updatedAt = opts.updatedAt;
  return state;
}

// ── Merging the missing logs into a stored aggregate ────────────────────────────────────────

export interface GapReport {
  logs: number;
  fromBlock: number;
  toBlock: number;
  /** Player events in the gap, by name. Non-player logs count only toward `logs`. */
  byEvent: Record<string, number>;
  /** Logs in the gap per UTC day. */
  byDay: Record<string, number>;
  rewardPaidWei: string;
  /** Wallets the gap touches (lowercase), and how many of them the aggregate had never seen. */
  touchedWallets: string[];
  newWallets: number;
}

const orHex = (x: string, y: string) => (BigInt("0x" + (x || "0")) | BigInt("0x" + (y || "0"))).toString(16);

function mergeRow(a: AddrRow, b: AddrRow): AddrRow {
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1]), a[2] + b[2], a[3] + b[3], a[4] | b[4], orHex(a[5], b[5])];
}

/**
 * The stored aggregate with the missing logs folded in. Returns a new object; `snapshot` is not
 * modified. Throws ReseedError unless the merge is provably the same as a complete scan.
 */
export function mergeGapLogs(snapshot: StatsState, gap: readonly GapLog[]): { state: StatsState; report: GapReport } {
  if (gap.length === 0) throw new ReseedError("gap_empty", "there are no missing logs to merge");
  const sorted = sortLogs(gap);
  const first = sorted[0].blockNumber;
  const last = sorted[sorted.length - 1].blockNumber;

  const keys = new Set<string>();
  for (const l of sorted) {
    const k = `${l.blockNumber}:${l.logIndex}`;
    if (keys.has(k)) throw new ReseedError("gap_duplicate_log", `log ${k} appears twice in the missing logs`);
    keys.add(k);
  }
  if (first < GENESIS_BLOCK) throw new ReseedError("gap_below_genesis", `block ${first} is below the genesis block ${GENESIS_BLOCK}`);
  if (last > snapshot.checkpointBlock) {
    throw new ReseedError("gap_above_checkpoint", `block ${last} is above the checkpoint ${snapshot.checkpointBlock}: the live scan reads that range itself`);
  }
  // Day granularity, not block: the first covered day's "active wallets" count reads each wallet's
  // previous event, so a gap log earlier on that same day (but before the start block) would change it.
  if (snapshot.detailSinceBlock !== undefined && dayOfBlock(last) >= dayOfBlock(snapshot.detailSinceBlock)) {
    throw new ReseedError(
      "gap_in_detail_coverage",
      `block ${last} falls on ${dayOfBlock(last)}, inside the per-day detail (it starts on ${dayOfBlock(snapshot.detailSinceBlock)}, block ${snapshot.detailSinceBlock}); a merge would corrupt that day's active-wallet count and the recent-events feed`,
    );
  }
  if (snapshot.seasonTally && last >= snapshot.seasonTally.sinceBlock) {
    throw new ReseedError("gap_in_season_tally", `block ${last} is inside the season XP tally (from ${snapshot.seasonTally.sinceBlock})`);
  }

  // The reducer itself computes what the gap contributes on its own, so there is one definition
  // of "a log's effect" and the merge cannot drift from it.
  const delta = deltaOf(sorted);

  const state = structuredClone(snapshot);
  state.totalLogs += delta.totalLogs;
  for (const [name, n] of Object.entries(delta.eventCounts)) state.eventCounts[name] = (state.eventCounts[name] ?? 0) + n;
  for (const [day, n] of Object.entries(delta.dailyEvents)) state.dailyEvents[day] = (state.dailyEvents[day] ?? 0) + n;
  state.rewardPaidWei = (BigInt(state.rewardPaidWei || "0") + BigInt(delta.rewardPaidWei || "0")).toString();
  let newWallets = 0;
  for (const [addr, row] of Object.entries(delta.addrs)) {
    const have = state.addrs[addr];
    if (have) state.addrs[addr] = mergeRow(have, row);
    else { state.addrs[addr] = row; newWallets += 1; }
  }

  return { state, report: { ...reportOf(delta, first, last), newWallets } };
}

/** What these logs add up to on their own, by the reducer's own rules. `sorted` must be non-empty and in order. */
function deltaOf(sorted: readonly GapLog[]): StatsState {
  const delta = emptyState();
  applyLogs(delta, sorted as GapLog[], sorted[sorted.length - 1].blockNumber);
  return delta;
}

function reportOf(delta: StatsState, first: number, last: number): GapReport {
  return {
    logs: delta.totalLogs,
    fromBlock: first,
    toBlock: last,
    byEvent: { ...delta.eventCounts },
    byDay: { ...delta.dailyEvents },
    rewardPaidWei: delta.rewardPaidWei,
    touchedWallets: Object.keys(delta.addrs).sort(),
    newWallets: delta.addrs ? Object.keys(delta.addrs).length : 0, // overwritten by mergeGapLogs, which knows which wallets are new
  };
}

/** The same summary without a snapshot: every wallet the logs touch counts as new. */
export function summariseGap(gap: readonly GapLog[]): GapReport {
  if (gap.length === 0) throw new ReseedError("gap_empty", "there are no missing logs to summarise");
  const sorted = sortLogs(gap);
  return reportOf(deltaOf(sorted), sorted[0].blockNumber, sorted[sorted.length - 1].blockNumber);
}

// ── Proving the merge changed only what the gap explains ────────────────────────────────────

export interface StateDiff {
  scalars: Array<{ field: string; before: unknown; after: unknown }>;
  eventCounts: Record<string, { before: number; after: number }>;
  dailyEvents: Record<string, { before: number; after: number }>;
  addrs: { added: string[]; removed: string[]; changed: string[] };
  unchanged: { dailyDetail: boolean; recentEvents: boolean; seasonTally: boolean };
}

const SCALARS = ["version", "genesisBlock", "checkpointBlock", "updatedAt", "totalLogs", "rewardPaidWei", "detailSinceBlock"] as const;

export function diffStates(before: StatsState, after: StatsState): StateDiff {
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const counts = (x: Record<string, number>, y: Record<string, number>) => {
    const out: Record<string, { before: number; after: number }> = {};
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if ((x[k] ?? 0) !== (y[k] ?? 0)) out[k] = { before: x[k] ?? 0, after: y[k] ?? 0 };
    }
    return out;
  };
  const wallets = Object.keys(after.addrs);
  return {
    scalars: SCALARS.filter((f) => canonical(b[f]) !== canonical(a[f])).map((f) => ({ field: f, before: b[f], after: a[f] })),
    eventCounts: counts(before.eventCounts, after.eventCounts),
    dailyEvents: counts(before.dailyEvents, after.dailyEvents),
    addrs: {
      added: wallets.filter((w) => !(w in before.addrs)).sort(),
      removed: Object.keys(before.addrs).filter((w) => !(w in after.addrs)).sort(),
      changed: wallets.filter((w) => w in before.addrs && canonical(before.addrs[w]) !== canonical(after.addrs[w])).sort(),
    },
    unchanged: {
      dailyDetail: canonical(before.dailyDetail) === canonical(after.dailyDetail),
      recentEvents: canonical(before.recentEvents) === canonical(after.recentEvents),
      seasonTally: canonical(before.seasonTally) === canonical(after.seasonTally),
    },
  };
}

/**
 * Everything wrong with a before/after pair, given what the gap should have changed. Empty means
 * the only differences are the gap's: counters up by exactly its counts, only its wallets touched,
 * and the checkpoint, timestamp, rewards, detail, feed and tally untouched.
 */
export function explainDiff(before: StatsState, after: StatsState, gap: GapReport): string[] {
  const problems: string[] = [];
  const d = diffStates(before, after);

  const allowedScalars = new Set(["totalLogs", ...(BigInt(gap.rewardPaidWei) > 0n ? ["rewardPaidWei"] : [])]);
  for (const s of d.scalars) if (!allowedScalars.has(s.field)) problems.push(`${s.field} changed (${String(s.before)} -> ${String(s.after)}) but the gap does not explain it`);
  if (after.totalLogs - before.totalLogs !== gap.logs) problems.push(`totalLogs rose by ${after.totalLogs - before.totalLogs}, the gap has ${gap.logs} logs`);

  const expectCounts = (what: string, got: Record<string, { before: number; after: number }>, want: Record<string, number>) => {
    for (const k of new Set([...Object.keys(got), ...Object.keys(want)])) {
      const rose = got[k] ? got[k].after - got[k].before : 0;
      if (rose !== (want[k] ?? 0)) problems.push(`${what} ${k} rose by ${rose}, the gap has ${want[k] ?? 0}`);
    }
  };
  expectCounts("eventCounts", d.eventCounts, gap.byEvent);
  expectCounts("dailyEvents", d.dailyEvents, gap.byDay);

  const touched = new Set(gap.touchedWallets);
  if (d.addrs.removed.length) problems.push(`${d.addrs.removed.length} wallets were removed`);
  for (const w of [...d.addrs.added, ...d.addrs.changed]) if (!touched.has(w)) problems.push(`wallet ${w} changed but the gap does not touch it`);
  if (d.addrs.added.length !== gap.newWallets) problems.push(`${d.addrs.added.length} wallets were added, the gap introduces ${gap.newWallets}`);

  for (const [name, same] of Object.entries(d.unchanged)) if (!same) problems.push(`${name} changed but must be left alone`);
  return problems;
}

// ── Locating the hole from public data ──────────────────────────────────────────────────────

export interface DayGap { day: string; current: number; reference: number; missing: number }

/**
 * Days whose event count differs between the stored series and a complete one. `missing` is
 * reference - current: positive means the stored series lacks logs, negative that it has extras.
 */
export function localizeGap(current: ReadonlyArray<{ day: string; events: number }>, reference: ReadonlyArray<{ day: string; events: number }>) {
  const cur = new Map(current.map((d) => [d.day, d.events]));
  const ref = new Map(reference.map((d) => [d.day, d.events]));
  const days: DayGap[] = [];
  for (const day of [...new Set([...cur.keys(), ...ref.keys()])].sort()) {
    const c = cur.get(day) ?? 0, r = ref.get(day) ?? 0;
    if (c !== r) days.push({ day, current: c, reference: r, missing: r - c });
  }
  return {
    days,
    totalMissing: days.reduce((s, d) => s + Math.max(d.missing, 0), 0),
    extras: days.filter((d) => d.missing < 0),
  };
}

export interface WindowCandidate { fromIndex: number; toIndex: number; fromBlock: number; toBlock: number; count: number }

/** One hole: the days it covers and every run of logs that could be it. */
export interface WindowCluster { days: string[]; candidates: WindowCandidate[] }

/**
 * Where could the missing logs be, given how many each UTC day is short? The days are grouped into
 * clusters: a maximal run of consecutive short days is ONE hole, and separate runs are separate holes.
 * Within a cluster the hole is a contiguous run of the full log list. Several days pin it uniquely
 * (the tail of the first day, every log of the days between, the head of the last day); a single day
 * leaves every run of that length as a candidate. `ok` is false when the shortfalls cannot be a set of
 * contiguous runs (for example a day in the middle of a run that is only partly short).
 */
export function windowClusters(sortedLogs: readonly RawLog[], missingByDay: Record<string, number>): { ok: boolean; reason?: string; clusters: WindowCluster[] } {
  const days = Object.keys(missingByDay).filter((d) => missingByDay[d] > 0).sort();
  if (days.length === 0) return { ok: true, clusters: [] };

  const byDay = new Map<string, number[]>();
  sortedLogs.forEach((l, i) => {
    const d = dayOfBlock(l.blockNumber);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(i);
  });
  const mk = (from: number, to: number): WindowCandidate => ({
    fromIndex: from, toIndex: to, fromBlock: sortedLogs[from].blockNumber, toBlock: sortedLogs[to].blockNumber, count: to - from + 1,
  });

  const runs: string[][] = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && Date.parse(d + "T00:00:00Z") - Date.parse(last[last.length - 1] + "T00:00:00Z") === 86_400_000) last.push(d);
    else runs.push([d]);
  }

  const clusters: WindowCluster[] = [];
  for (const run of runs) {
    if (run.length === 1) {
      const idx = byDay.get(run[0]) ?? [];
      const m = missingByDay[run[0]];
      if (m > idx.length) return { ok: false, reason: `${run[0]} is short by ${m} but the full list has only ${idx.length} logs that day`, clusters: [] };
      const candidates: WindowCandidate[] = [];
      for (let s = 0; s + m <= idx.length; s++) candidates.push(mk(idx[s], idx[s + m - 1]));
      clusters.push({ days: run, candidates });
      continue;
    }
    for (const mid of run.slice(1, -1)) {
      const have = (byDay.get(mid) ?? []).length;
      if (missingByDay[mid] !== have) return { ok: false, reason: `${mid} lies inside a run of short days but is short by ${missingByDay[mid]} of ${have}, not all of it`, clusters: [] };
    }
    const first = byDay.get(run[0]) ?? [], last = byDay.get(run[run.length - 1]) ?? [];
    const m1 = missingByDay[run[0]], mN = missingByDay[run[run.length - 1]];
    if (m1 > first.length || mN > last.length) return { ok: false, reason: "a boundary day is short by more logs than it has", clusters: [] };
    clusters.push({ days: run, candidates: [mk(first[first.length - m1], last[mN - 1])] });
  }
  return { ok: true, clusters };
}

/** The logs with the given windows removed, to simulate a state that lacks exactly those runs. */
export function withoutWindows<T extends RawLog>(sortedLogs: readonly T[], windows: ReadonlyArray<Pick<WindowCandidate, "fromIndex" | "toIndex">>): T[] {
  return sortedLogs.filter((_, i) => !windows.some((w) => i >= w.fromIndex && i <= w.toIndex));
}

// ── Comparing what the public sees ──────────────────────────────────────────────────────────

export interface Difference { path: string; a: unknown; b: unknown }

/** Every place two JSON values differ, by path, up to `cap` entries. */
export function diffJson(a: unknown, b: unknown, ignore: readonly string[] = [], cap = 50): Difference[] {
  const out: Difference[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (out.length >= cap || ignore.includes(path)) return;
    if (x && y && typeof x === "object" && typeof y === "object") {
      const keys = Array.isArray(x) && Array.isArray(y)
        ? Array.from({ length: Math.max(x.length, y.length) }, (_, i) => String(i))
        : [...new Set([...Object.keys(x as object), ...Object.keys(y as object)])];
      for (const k of keys) walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`);
    } else if (x !== y) out.push({ path, a: x, b: y });
  };
  walk(a, b, "$");
  return out;
}

/** The public snapshot minus the fields that legitimately differ between two reads of one state. */
export const PUBLIC_IGNORE = ["$.updatedAt", "$.scan"] as const;

export const publicView = (state: StatsState): StatsSnapshot => derive(state);

// ── Expected totals ─────────────────────────────────────────────────────────────────────────

export interface Totals {
  playerWallets: number;
  logs: number;
  sessionsStarted: number;
  gamesCompleted: number;
  usernamesSet: number;
  rewardsPaid: number;
  gDollarPaid: number;
}

export const totalsOf = (s: Pick<StatsSnapshot, "playerWallets" | "totals" | "gDollarPaid">): Totals => ({
  playerWallets: s.playerWallets,
  logs: s.totals.logs,
  sessionsStarted: s.totals.sessionsStarted,
  gamesCompleted: s.totals.gamesCompleted,
  usernamesSet: s.totals.usernamesSet,
  rewardsPaid: s.totals.rewardsPaid,
  gDollarPaid: s.gDollarPaid,
});

export function compareTotals(actual: Totals, expected: Totals) {
  const rows = (Object.keys(expected) as Array<keyof Totals>).map((metric) => ({
    metric, expected: expected[metric], actual: actual[metric], delta: actual[metric] - expected[metric], ok: actual[metric] === expected[metric],
  }));
  return { ok: rows.every((r) => r.ok), rows };
}

/** Rewards must come through a reseed exactly as they were. */
export function rewardsPreserved(before: StatsState, after: StatsState): string[] {
  const problems: string[] = [];
  if ((before.eventCounts.RewardPaid ?? 0) !== (after.eventCounts.RewardPaid ?? 0)) {
    problems.push(`rewards paid changed from ${before.eventCounts.RewardPaid ?? 0} to ${after.eventCounts.RewardPaid ?? 0}`);
  }
  if (before.rewardPaidWei !== after.rewardPaidWei) problems.push(`G$ paid changed from ${before.rewardPaidWei} to ${after.rewardPaidWei} wei`);
  return problems;
}

// ── Telling a later scan from anything else ─────────────────────────────────────────────────

/**
 * Whether `current` could be `replacement` plus later scans: nothing in it has gone DOWN. A value
 * that has been overwritten with the old snapshot fails this on the repaired days. Empty = fine.
 */
export function isDescendant(replacement: StatsState, current: StatsState): string[] {
  const problems: string[] = [];
  if (current.checkpointBlock < replacement.checkpointBlock) problems.push(`checkpoint went back from ${replacement.checkpointBlock} to ${current.checkpointBlock}`);
  if (current.totalLogs < replacement.totalLogs) problems.push(`totalLogs went down from ${replacement.totalLogs} to ${current.totalLogs}`);
  for (const [k, v] of Object.entries(replacement.eventCounts)) if ((current.eventCounts[k] ?? 0) < v) problems.push(`eventCounts ${k} went down from ${v} to ${current.eventCounts[k] ?? 0}`);
  for (const [d, v] of Object.entries(replacement.dailyEvents)) if ((current.dailyEvents[d] ?? 0) < v) problems.push(`dailyEvents ${d} went down from ${v} to ${current.dailyEvents[d] ?? 0}`);
  for (const [w, row] of Object.entries(replacement.addrs)) {
    const have = current.addrs[w];
    if (!have) problems.push(`wallet ${w} is missing`);
    else if (have[2] < row[2]) problems.push(`wallet ${w} event count went down`);
  }
  if (BigInt(current.rewardPaidWei || "0") < BigInt(replacement.rewardPaidWei || "0")) problems.push("G$ paid went down");
  return problems.slice(0, 20);
}

/**
 * Why `current` is NOT simply `snapshot` plus scans of blocks above the snapshot's checkpoint; empty
 * means it is. The app rewrites the stored value on every refresh, so between a snapshot and an apply
 * the bytes normally differ; this proves the difference is only ordinary later scanning, so the same
 * missing logs can safely be merged into the current value instead. Everything at or before the
 * snapshot's checkpoint must be unchanged: history days, every wallet's first block, the per-day detail
 * and the recent-events feed's older entries; and only later blocks can have added anything.
 */
export function verifyLaterScansOnly(snapshot: StatsState, current: StatsState): string[] {
  const problems: string[] = [];
  const cp = snapshot.checkpointBlock;
  const cpDay = dayOfBlock(cp);
  const cpWeek = weekIndexOf(blockToUnix(cp)) - BASE_WEEK;
  const add = (m: string) => { if (problems.length < 20) problems.push(m); };

  if (current.version !== snapshot.version) add("the format version differs");
  if (current.genesisBlock !== snapshot.genesisBlock) add("the genesis block differs");
  if (current.checkpointBlock < cp) add(`the checkpoint went back from ${cp} to ${current.checkpointBlock}`);
  if (canonical(current.detailSinceBlock) !== canonical(snapshot.detailSinceBlock)) add("where per-day detail starts differs");
  if (canonical(current.seasonTally) !== canonical(snapshot.seasonTally)) add("the season XP tally differs");
  if (BigInt(current.rewardPaidWei || "0") < BigInt(snapshot.rewardPaidWei || "0")) add("G$ paid went down");

  let dailyDelta = 0;
  for (const d of new Set([...Object.keys(snapshot.dailyEvents), ...Object.keys(current.dailyEvents)])) {
    const a = snapshot.dailyEvents[d] ?? 0, b = current.dailyEvents[d] ?? 0;
    dailyDelta += b - a;
    if (d < cpDay ? a !== b : b < a) add(`dailyEvents ${d}: ${a} became ${b}${d < cpDay ? " (a day before the snapshot's checkpoint must not change)" : ""}`);
  }
  if (current.totalLogs - snapshot.totalLogs !== dailyDelta) add(`totalLogs rose by ${current.totalLogs - snapshot.totalLogs} but the daily counts rose by ${dailyDelta}`);
  for (const [k, v] of Object.entries(snapshot.eventCounts)) if ((current.eventCounts[k] ?? 0) < v) add(`eventCounts ${k} went down`);

  for (const [w, a] of Object.entries(snapshot.addrs)) {
    const b = current.addrs[w];
    if (!b) { add(`wallet ${w} is gone`); continue; }
    if (b[0] !== a[0]) add(`wallet ${w}: first block changed`);
    if (b[1] < a[1]) add(`wallet ${w}: last block went back`);
    if (b[2] < a[2] || b[3] < a[3]) add(`wallet ${w}: a count went down`);
    if ((a[4] & ~b[4]) !== 0) add(`wallet ${w}: event kinds were lost`);
    const A = BigInt("0x" + (a[5] || "0")), B = BigInt("0x" + (b[5] || "0"));
    if ((A & ~B) !== 0n) add(`wallet ${w}: active weeks were lost`);
    if (cpWeek > 0 && ((B & ~A) & ((1n << BigInt(cpWeek)) - 1n)) !== 0n) add(`wallet ${w}: gained activity in a week before the snapshot's checkpoint`);
    if (b[2] > a[2] && b[1] <= cp) add(`wallet ${w}: gained events but none after the snapshot's checkpoint`);
  }
  for (const [w, b] of Object.entries(current.addrs)) if (!(w in snapshot.addrs) && b[0] <= cp) add(`wallet ${w} is new but was first seen at or before the snapshot's checkpoint`);

  const detail = (state: StatsState) => state.dailyDetail ?? {};
  for (const d of new Set([...Object.keys(detail(snapshot)), ...Object.keys(detail(current))])) {
    if (d < cpDay && canonical(detail(snapshot)[d]) !== canonical(detail(current)[d])) add(`per-day detail for ${d} changed`);
  }
  const had = new Set((snapshot.recentEvents ?? []).map(canonical));
  for (const e of current.recentEvents ?? []) if (e.block <= cp && !had.has(canonical(e))) add("the recent-events feed has an older event the snapshot did not");
  return problems;
}

// ── What the app will accept ────────────────────────────────────────────────────────────────

/** True when the app's own loader accepts `state` as a usable aggregate (otherwise /api/stats answers 503). */
export const acceptedByApp = (state: StatsState): boolean => parseStoredState(JSON.stringify(state)).status === "ok";

/**
 * Parses a stored value and requires that serialising it again gives back the same bytes, which is
 * what lets a merge leave every untouched field byte-identical.
 */
export function parseSnapshot(raw: string): StatsState {
  const parsed = parseStoredState(raw);
  if (parsed.status !== "ok") throw new ReseedError("snapshot_not_round_trip", `the snapshot is not a usable aggregate (${parsed.status}: ${"detail" in parsed ? parsed.detail : ""})`);
  if (JSON.stringify(JSON.parse(raw)) !== raw) {
    throw new ReseedError("snapshot_not_round_trip", "the snapshot does not serialise back to the same bytes, so a patched copy could differ in more than the gap (was it edited by hand, or saved with a newline?)");
  }
  return parsed.state;
}
