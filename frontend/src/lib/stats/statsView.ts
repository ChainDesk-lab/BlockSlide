/**
 * Pure helpers for the /stats page (Figma frame 5). No React, so each rule is unit-tested.
 *
 * Every value the page shows comes from the /api/stats snapshot, which is aggregated from
 * the game contract's own event logs. Nothing here estimates: when a figure can't be
 * stated exactly, the helper returns null and the page says so.
 */
import { blockToUnix } from "./config";

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** "8 Jun – 2 Nov 2026" from ISO week starts (Mondays). */
export function weekRangeLabel(weeks: readonly string[]): string | null {
  if (!weeks.length) return null;
  const f = (d: string, year: boolean) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
  return `${f(weeks[0], false)} – ${f(weeks[weeks.length - 1], true)}`;
}

export const shortWeek = (week: string) =>
  new Date(week + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Indices of up to `count` evenly spaced axis labels, always including the first and last. */
export function tickIndices(length: number, count = 5): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const out = new Set<number>();
  for (let k = 0; k < count; k++) out.add(Math.round((k * (length - 1)) / (count - 1)));
  return [...out];
}

/**
 * Event counts by whole UTC days, which is what the aggregate stores (`daily`). A rolling
 * "last 24 hours" can't be computed from daily totals without over- or under-counting, so the
 * page states UTC days: "today" is since 00:00 UTC on the snapshot's day, and "last 7 days"
 * is that day plus the six before it.
 */
export function utcDayEvents(daily: ReadonlyArray<{ day: string; events: number }>, checkpointBlock: number): { today: number; last7: number; headDay: string } {
  const headDay = new Date(blockToUnix(checkpointBlock) * 1000).toISOString().slice(0, 10);
  const first = iso(Date.parse(headDay + "T00:00:00Z") - 6 * DAY_MS);
  let today = 0, last7 = 0;
  for (const d of daily) {
    if (d.day === headDay) today += d.events;
    if (d.day >= first && d.day <= headDay) last7 += d.events;
  }
  return { today, last7, headDay };
}

/** How long a snapshot may go without a refresh before the page warns it may be behind. */
export const STALE_WARNING_MS = 15 * 60_000;

/**
 * Whether to show the "still catching up" notice: the last refresh couldn't reach the chain
 * head, or the snapshot hasn't been refreshed for a while (the scan only runs when the page is
 * requested, and a failed refresh keeps serving the last aggregate).
 */
export function catchingUp(o: { updatedAt: string; scan?: { caughtUp: boolean } | null; now: number }): boolean {
  if (o.scan && !o.scan.caughtUp) return true;
  const age = o.now - Date.parse(o.updatedAt);
  return !Number.isFinite(age) || age > STALE_WARNING_MS;
}

export const pct = (share: number) => `${(share * 100).toFixed(1)}%`;
