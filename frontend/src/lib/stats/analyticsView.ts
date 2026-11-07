/**
 * Pure helpers for the /analytics page: time ranges, gap-filling and labels.
 * Kept free of React so they can be unit-tested.
 */
import type { RecentEvent } from "./state";

export type Range = "7d" | "30d" | "all";
export const RANGES: Array<{ id: Range; label: string }> = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (day: string) => Date.parse(day + "T00:00:00Z");

/** First UTC day included in `range`, counting `lastDay` as day one. */
export function rangeStart(range: Range, lastDay: string, firstDay: string): string {
  if (range === "all") return firstDay;
  const days = range === "7d" ? 7 : 30;
  const start = iso(ms(lastDay) - (days - 1) * DAY_MS);
  return start < firstDay ? firstDay : start;
}

/**
 * A contiguous day-by-day series from `from` to `to` inclusive. Days with no
 * entry are zero: the aggregate only records a day once something happened on
 * it, so within its coverage a missing day means no events, not missing data.
 */
export function fillDays<T extends { day: string }>(
  rows: readonly T[], from: string, to: string, value: (r: T) => number,
): Array<{ day: string; value: number }> {
  if (from > to) return [];
  const byDay = new Map(rows.map((r) => [r.day, value(r)]));
  const out: Array<{ day: string; value: number }> = [];
  for (let t = ms(from); t <= ms(to); t += DAY_MS) {
    const day = iso(t);
    out.push({ day, value: byDay.get(day) ?? 0 });
  }
  return out;
}

export const sum = (rows: ReadonlyArray<{ value: number }>) => rows.reduce((s, r) => s + r.value, 0);

export function shortDay(day: string): string {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const G = 10n ** 18n;
function gDollar(wei: string): string {
  const v = BigInt(wei);
  const whole = v / G;
  const cents = ((v % G) * 100n) / G;
  return cents === 0n ? `${whole}` : `${whole}.${cents.toString().padStart(2, "0")}`;
}

/** What happened, in words, using only fields the event itself carried. */
export function describeEvent(ev: RecentEvent): { label: string; detail: string } {
  switch (ev.type) {
    case "SessionStarted": return { label: "Started a game", detail: "" };
    case "ScoreSubmitted": return {
      label: "Completed a game",
      detail: ev.score !== undefined ? `Score ${ev.score.toLocaleString("en-US")}${ev.tile ? ` · ${ev.tile} tile` : ""}` : "",
    };
    case "RewardPaid": return {
      label: "Earned a G$ reward",
      detail: [ev.amountWei ? `${gDollar(ev.amountWei)} G$` : "", ev.tile ? `${ev.tile} milestone` : ""].filter(Boolean).join(" · "),
    };
    case "ShieldPurchased": return { label: "Bought a streak shield", detail: "" };
    case "XpBoostPurchased": return { label: "Bought an XP boost", detail: "" };
    case "UndoPurchased": return { label: "Bought undo credits", detail: "" };
    case "CosmeticPurchased": return { label: "Bought a cosmetic", detail: "" };
  }
}

/** "3 min ago" style, from a unix time against `now` (ms). */
export function timeAgo(unix: number, now: number): string {
  const s = Math.max(0, Math.round(now / 1000 - unix));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}
