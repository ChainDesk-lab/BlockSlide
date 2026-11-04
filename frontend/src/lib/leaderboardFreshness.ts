/**
 * Is the leaderboard's data current? Pure logic, no I/O — the
 * /api/leaderboard route supplies the subgraph's indexed block and the chain
 * head, and this decides whether to flag the result as stale and why.
 *
 * Why this exists: in September a frozen subgraph went unnoticed for 12 days.
 * It reported `hasIndexingErrors: false` the whole time because it wasn't
 * erroring, only stopped; nothing compared how far it had indexed with the
 * chain itself.
 */

/**
 * Default lag, in blocks, before the leaderboard is flagged stale. Celo
 * produces a block about every second, so 600 blocks is roughly 10 minutes.
 * Override with LEADERBOARD_MAX_LAG_BLOCKS.
 */
export const DEFAULT_MAX_LAG_BLOCKS = 600;

export function maxLagBlocksFromEnv(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_LAG_BLOCKS;
}

export type StaleReason =
  | "subgraph_unconfigured" // no subgraph URL set
  | "subgraph_unavailable" // fetch failed or returned only part of the players
  | "subgraph_empty" // answered with no players while a saved leaderboard has some
  | "indexing_errors" // the subgraph reports it has stopped on an error
  | "indexing_lag"; // indexed block trails chain head by more than the limit

export interface Freshness {
  stale: boolean;
  reason: StaleReason | null;
  indexedBlock: number | null;
  /** null when no RPC could report the chain head — lag is then unknown. */
  headBlock: number | null;
  lagBlocks: number | null;
  maxLagBlocks: number;
}

export function assessFreshness(input: {
  configured: boolean;
  /** The full player set was fetched (no error, not cut short). */
  complete: boolean;
  indexedBlock: number | null;
  headBlock: number | null;
  hasIndexingErrors: boolean | null;
  maxLagBlocks: number;
}): Freshness {
  const { configured, complete, indexedBlock, headBlock, hasIndexingErrors, maxLagBlocks } = input;
  const lagBlocks =
    indexedBlock !== null && headBlock !== null ? Math.max(0, headBlock - indexedBlock) : null;
  const base = { indexedBlock, headBlock, lagBlocks, maxLagBlocks };

  if (!configured) return { ...base, stale: true, reason: "subgraph_unconfigured" };
  if (!complete) return { ...base, stale: true, reason: "subgraph_unavailable" };
  if (hasIndexingErrors === true) return { ...base, stale: true, reason: "indexing_errors" };
  if (lagBlocks !== null && lagBlocks > maxLagBlocks) return { ...base, stale: true, reason: "indexing_lag" };
  return { ...base, stale: false, reason: null };
}

/** What the leaderboard shows above the table, or null when the data is current. */
export function freshnessNotice(
  response: {
    stale?: boolean;
    freshness?: { reason?: StaleReason | null; lagBlocks?: number | null } | null;
    servedFrom?: "live" | "last_known_good" | null;
    builtAt?: number | null;
  },
  now: number = Date.now()
): string | null {
  if (response.servedFrom === "last_known_good") {
    const mins = response.builtAt ? Math.max(1, Math.round((now - response.builtAt) / 60_000)) : null;
    return mins
      ? `Live rankings are unavailable right now. Showing the last update from ${mins} min ago.`
      : "Live rankings are unavailable right now. Showing the last saved update.";
  }
  if (!response.stale) return null;
  const reason = response.freshness?.reason ?? null;
  const lag = response.freshness?.lagBlocks ?? null;
  if (reason === "indexing_lag" && lag !== null) {
    // Celo blocks are ~1 s apart, so blocks ≈ seconds.
    const mins = Math.max(1, Math.round(lag / 60));
    return `Rankings are about ${mins} min behind the chain — recent games may not show yet.`;
  }
  if (reason === "indexing_errors") return "Live rankings have stopped updating. Recent games may not show yet.";
  return "Live rankings are catching up — some recent XP may not show yet.";
}

/**
 * May `next` replace the saved last-known-good leaderboard `prev`?
 *
 * Only a build with players that indexed at least as far as the saved one. A
 * subgraph can answer "successfully" with nothing or with old data (a wrong or
 * freshly deployed endpoint, or the frozen staging subgraph of September), and
 * that must never overwrite a fuller, newer leaderboard kept for outages.
 */
export function shouldReplaceLastGood(
  next: { subgraphPlayers: number; indexedBlock: number | null },
  prev: { subgraphPlayers: number; indexedBlock: number | null } | null
): boolean {
  if (next.subgraphPlayers === 0) return false;
  if (!prev) return true;
  if (prev.indexedBlock !== null && (next.indexedBlock === null || next.indexedBlock < prev.indexedBlock)) {
    return false;
  }
  return true;
}
