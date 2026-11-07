/**
 * A player's lifetime GoodDollar UBI contribution, for their profile.
 *
 * The amount is what the subgraph summed from the contract's UbiContribution
 * events, counting only those whose G$ Transfer to the UBI recipient was found
 * in the same transaction. Nothing here calculates a contribution: the rate is
 * read from the contract only to word the caption, and amounts are base-unit
 * integers formatted without floating point.
 */
import type { UbiContributionInfo } from "../hooks/useUbiContribution";
import { formatG } from "./season5/view";
import { formatBps } from "./ubiContribution";

export type UbiTotals =
  | { kind: "ready"; totalWei: bigint; count: number; unverifiedWei: bigint; unverifiedCount: number }
  /** The subgraph being queried has no UBI fields (a version from before them). */
  | { kind: "not-indexed" }
  | { kind: "error"; message: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^[0-9]+$/;
const FIELDS = ["totalUbiContributed", "ubiContributionCount", "totalUbiUnverified", "ubiUnverifiedCount"] as const;
/** graph-node's wording when a query names a field the schema doesn't have. */
const MISSING_FIELD = /has no field|Cannot query field/i;

export function ubiTotalsQuery(address: string): string {
  return `{
    players(where: { id: "${address.toLowerCase()}" }, first: 1) {
      id
      ${FIELDS.join("\n      ")}
    }
  }`;
}

/** Reads one wallet's UBI totals from the subgraph. Never throws; never reports a failure as zero. */
export async function fetchUbiTotals(
  subgraphUrl: string,
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UbiTotals> {
  if (!subgraphUrl) return { kind: "error", message: "No subgraph configured" };
  if (!ADDRESS.test(address)) return { kind: "error", message: "Not a wallet address" };

  let json: { data?: { players?: Record<string, unknown>[] }; errors?: { message?: string }[] };
  try {
    const res = await fetchImpl(subgraphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: ubiTotalsQuery(address) }),
    });
    if (!res.ok) return { kind: "error", message: `Subgraph returned ${res.status}` };
    json = await res.json();
  } catch {
    return { kind: "error", message: "Subgraph unreachable" };
  }

  if (json.errors?.length) {
    const missing = json.errors.every((e) => MISSING_FIELD.test(e.message ?? "") && FIELDS.some((f) => (e.message ?? "").includes(f)));
    return missing ? { kind: "not-indexed" } : { kind: "error", message: "Subgraph query failed" };
  }
  const players = json.data?.players;
  if (!Array.isArray(players)) return { kind: "error", message: "Unexpected subgraph response" };
  // No Player row: this wallet has no indexed activity, so it has contributed nothing.
  const p = players[0];
  if (!p) return { kind: "ready", totalWei: 0n, count: 0, unverifiedWei: 0n, unverifiedCount: 0 };

  const total = p.totalUbiContributed, unverified = p.totalUbiUnverified;
  const count = p.ubiContributionCount, unverifiedCount = p.ubiUnverifiedCount;
  if (typeof total !== "string" || !UINT.test(total) || typeof unverified !== "string" || !UINT.test(unverified)) {
    return { kind: "error", message: "Unexpected subgraph response" };
  }
  if (!Number.isSafeInteger(count) || (count as number) < 0 || !Number.isSafeInteger(unverifiedCount) || (unverifiedCount as number) < 0) {
    return { kind: "error", message: "Unexpected subgraph response" };
  }
  const totalWei = BigInt(total), unverifiedWei = BigInt(unverified);
  // An amount without a count (or the reverse) means the data is inconsistent: don't show either.
  if ((totalWei > 0n) !== ((count as number) > 0) || (unverifiedWei > 0n) !== ((unverifiedCount as number) > 0)) {
    return { kind: "error", message: "Inconsistent subgraph totals" };
  }
  return { kind: "ready", totalWei, count: count as number, unverifiedWei, unverifiedCount: unverifiedCount as number };
}

const CENT = 10n ** 16n; // 0.01 G$ in wei

/** "1.25 G$", "2 G$", "<0.01 G$" for dust above zero, "0 G$". Integer arithmetic only; truncates, never rounds up. */
export function formatUbiAmount(wei: bigint): string {
  if (wei < 0n) return "—";
  if (wei > 0n && wei < CENT) return "<0.01 G$";
  return formatG(wei.toString());
}

export type UbiStatView =
  | { state: "loading" }
  | { state: "shown"; value: string; note: string; muted: boolean; title?: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the UBI card shows. `totals` is null while the subgraph read is in flight. */
export function ubiStat(o: { rate: UbiContributionInfo; totals: UbiTotals | null }): UbiStatView {
  const { rate, totals } = o;
  if (totals === null) return { state: "loading" };
  if (totals.kind === "error") return { state: "shown", value: "Unavailable", note: "Contributions can't be read right now", muted: true };
  if (totals.kind === "not-indexed") {
    return { state: "shown", value: "Not yet available", note: "Contribution tracking isn't live yet", muted: true };
  }

  const seen = totals.count + totals.unverifiedCount;
  // Nothing recorded yet: whether that is a real zero depends on the contract contributing at all.
  if (seen === 0) {
    if (rate.status === "loading") return { state: "loading" };
    if (rate.status !== "ready") {
      return { state: "shown", value: "Not yet available", note: "Starts when Shop purchases begin contributing to UBI", muted: true };
    }
  }

  // The caption names the rate the contract reports; if it can't be read, it says what happens without a number.
  const base = rate.status === "ready"
    ? `${formatBps(rate.bps)} of Shop purchases sent to GoodDollar UBI`
    : "Shop purchases sent to GoodDollar UBI";
  const note = totals.unverifiedCount > 0 ? `${base} · ${plural(totals.unverifiedCount, "contribution")} awaiting verification` : base;
  return {
    state: "shown",
    value: formatUbiAmount(totals.totalWei),
    note,
    muted: totals.totalWei === 0n,
    title: totals.count > 0 ? `From ${plural(totals.count, "verified contribution")}` : undefined,
  };
}
