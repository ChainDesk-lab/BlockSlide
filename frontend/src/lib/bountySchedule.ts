/**
 * Bounty scheduling: build a run of recurring bounties, and check a schedule before it ships.
 *
 * This only computes dates. Every prize, title and rule comes from the caller, so nothing here
 * decides economics, and no bounty exists until someone adds it to src/config/bounties.ts.
 */
import type { Bounty } from "../config/bounties";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecurringBountyPlan {
  /** Ids become `${idPrefix}-${n}`, numbered from `firstNumber`. */
  idPrefix: string;
  firstNumber?: number;
  /** ISO UTC start of the first bounty, e.g. "2026-12-01T11:00:00Z". */
  firstStart: string;
  /** Days from one bounty's start to the next one's. */
  everyDays: number;
  /** Length of each bounty in days. Must not exceed everyDays, so runs never overlap. */
  durationDays: number;
  count: number;
  /** Per-occurrence fields, given the bounty number (1, 2, …). The prize text is always the caller's. */
  details: (n: number) => Omit<Bounty, "id" | "startTime" | "endTime">;
}

const isoUtc = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

export function recurringBounties(plan: RecurringBountyPlan): Bounty[] {
  const start = Date.parse(plan.firstStart);
  if (Number.isNaN(start) || !/Z$|[+-]\d\d:\d\d$/.test(plan.firstStart)) {
    throw new Error(`firstStart must be an ISO time with a zone: ${plan.firstStart}`);
  }
  for (const [k, v] of [["everyDays", plan.everyDays], ["durationDays", plan.durationDays], ["count", plan.count]] as const) {
    if (!(v > 0) || !Number.isFinite(v)) throw new Error(`${k} must be a positive number`);
  }
  if (!Number.isInteger(plan.count)) throw new Error("count must be a whole number");
  if (plan.durationDays > plan.everyDays) throw new Error("durationDays can't exceed everyDays: bounties would overlap");

  const first = plan.firstNumber ?? 1;
  return Array.from({ length: plan.count }, (_, i) => {
    const n = first + i;
    const s = start + i * plan.everyDays * DAY_MS;
    return {
      id: `${plan.idPrefix}-${n}`,
      ...plan.details(n),
      startTime: isoUtc(s),
      endTime: isoUtc(s + plan.durationDays * DAY_MS),
    };
  });
}

/**
 * Everything wrong with a schedule, as readable messages; empty when it's sound.
 * The bounty page features "the first bounty not yet ended", so overlapping bounties would hide one.
 */
export function scheduleProblems(list: readonly Bounty[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const timed: Array<{ id: string; start: number; end: number }> = [];

  for (const b of list) {
    if (!b.id.trim()) problems.push("a bounty has an empty id");
    if (seen.has(b.id)) problems.push(`duplicate id ${b.id}`);
    seen.add(b.id);
    for (const [k, v] of [["title", b.title], ["prizes", b.prizes], ["winnerCriteria", b.winnerCriteria]] as const) {
      if (!v.trim()) problems.push(`${b.id}: ${k} is empty`);
    }
    const start = Date.parse(b.startTime);
    const end = Date.parse(b.endTime);
    const zoned = (t: string) => /Z$|[+-]\d\d:\d\d$/.test(t);
    if (Number.isNaN(start) || !zoned(b.startTime)) { problems.push(`${b.id}: startTime isn't an ISO time with a zone`); continue; }
    if (Number.isNaN(end) || !zoned(b.endTime)) { problems.push(`${b.id}: endTime isn't an ISO time with a zone`); continue; }
    if (end <= start) { problems.push(`${b.id}: ends before it starts`); continue; }
    timed.push({ id: b.id, start, end });
  }

  for (let i = 1; i < timed.length; i++) {
    if (timed[i].start < timed[i - 1].start) problems.push(`${timed[i].id} is listed after ${timed[i - 1].id} but starts earlier`);
    else if (timed[i].start < timed[i - 1].end) problems.push(`${timed[i].id} overlaps ${timed[i - 1].id}`);
  }
  return problems;
}
