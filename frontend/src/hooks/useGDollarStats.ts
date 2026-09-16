import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { GAME2048_ADDRESS } from "../lib/constants";
import { TARGET_CHAIN } from "../lib/constants";
import { decodeEventLog } from "viem";
import { GAME2048_MERGED_ABI } from "../lib/abiMerged";

interface GDollarStats {
  /** null means "could not be determined" — distinct from "0", which means "none". */
  totalEarned: string | null;
  totalSpent: string | null;
}

const DEPLOYMENT_BLOCK = 69_294_066n;
/** Public Celo RPCs reject wider ranges: "query exceeds range, retry smaller (max block range 5000)". */
const MAX_BLOCK_RANGE = 5000n;
const CHUNK_CONCURRENCY = 8;

/**
 * The event-scan fallback is disabled by default. Set true to re-enable.
 *
 * Measured reasons, as of 2026-09-15:
 *
 * 1. It cannot add anything. The subgraph indexes RewardPaid, ShieldPurchased
 *    and XpBoostPurchased, so every wallet with G$ activity has an entry —
 *    verified: all 54 wallets with an on-chain G$ event are in the subgraph,
 *    and all 527 players expose both G$ fields. The fallback never fires.
 *
 * 2. If it did fire it would be ~1,660 RPC requests per page view. `gdollarData`
 *    is null both when a player genuinely has no fields AND when the subgraph
 *    is unreachable, so a subgraph outage would turn every profile view into an
 *    RPC flood.
 *
 * 3. A single read per window silently drops logs. forno's pooled archive nodes
 *    return [] rather than erroring on historical ranges; a one-pass chunked
 *    scan collected 6,424 of 12,113 known logs (~47% loss). Correcting that
 *    needs the repeat-and-union approach in scripts/count-users.mjs, which is
 *    far too expensive for a page load. Under-reporting someone's G$ balance is
 *    worse than saying "unavailable".
 *
 * The chunking below is correct and complete regardless — see the range
 * arithmetic, which is gapless and never exceeds the 5000-block cap.
 */
const ENABLE_EVENT_SCAN_FALLBACK = false;

/**
 * Sum a player's G$ earned/spent from contract events.
 *
 * The range is walked in 5000-block windows. The previous single call passed no
 * `toBlock` and so asked for ~8.2M blocks at once, which every provider rejects
 * — meaning this fallback never actually returned data, it just logged an error
 * and reported zero.
 *
 * Returns null totals if ANY window fails. Summing whatever windows happened to
 * succeed would silently under-report a player's balance, which is worse than
 * admitting we don't know.
 */
async function fetchGDollarStatsFromEvents(
  address: string,
  publicClient: any
): Promise<GDollarStats> {
  if (!publicClient || !address) return { totalEarned: null, totalSpent: null };

  const addressLower = address.toLowerCase();

  let head: bigint;
  try {
    head = await publicClient.getBlockNumber();
  } catch (err) {
    console.error("[GDollarStats] Could not read chain head:", err);
    return { totalEarned: null, totalSpent: null };
  }

  const ranges: Array<[bigint, bigint]> = [];
  for (let from = DEPLOYMENT_BLOCK; from <= head; from += MAX_BLOCK_RANGE) {
    const to = from + MAX_BLOCK_RANGE - 1n > head ? head : from + MAX_BLOCK_RANGE - 1n;
    ranges.push([from, to]);
  }

  const collected: any[] = [];
  let failed = false;
  let cursor = 0;

  async function worker() {
    while (cursor < ranges.length && !failed) {
      const [from, to] = ranges[cursor++];
      let logs: any[] | null = null;
      for (let attempt = 0; attempt < 3 && logs === null; attempt++) {
        try {
          logs = await publicClient.getLogs({
            address: GAME2048_ADDRESS as `0x${string}`,
            fromBlock: from,
            toBlock: to,
          });
        } catch (err) {
          if (attempt === 2) {
            console.error(`[GDollarStats] window ${from}-${to} failed:`, err);
            failed = true;
          } else {
            await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
          }
        }
      }
      if (logs) collected.push(...logs);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, ranges.length) }, worker)
  );

  if (failed) return { totalEarned: null, totalSpent: null };

  let totalEarned = 0n;
  let totalSpent = 0n;

  for (const log of collected) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: GAME2048_MERGED_ABI,
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue; // not an event we know; ignore
    }

    const args = decoded.args as Record<string, any>;
    const eventPlayer = args?.player;
    if (!eventPlayer || String(eventPlayer).toLowerCase() !== addressLower) continue;

    switch (decoded.eventName) {
      case "RewardPaid": {
        const amount = args?.amount;
        if (typeof amount === "bigint") totalEarned += amount;
        break;
      }
      case "ShieldPurchased":
      case "XpBoostPurchased":
      case "UndoPurchased":
      case "CosmeticPurchased": {
        // Only the V6+ shapes carry pricePaid; older ones have no price to sum.
        const pricePaid = args?.pricePaid;
        if (typeof pricePaid === "bigint") totalSpent += pricePaid;
        break;
      }
    }
  }

  return { totalEarned: totalEarned.toString(), totalSpent: totalSpent.toString() };
}

/**
 * G$ earned/spent for a player, preferring the subgraph and falling back to a
 * contract-event scan.
 *
 * `loading` and the null totals let the caller render "unavailable" rather than
 * a confident 0 — a failed lookup previously reported "0 G$", which reads as a
 * real balance instead of a missing one.
 */
export function useGDollarStats(
  address: string | null,
  _subgraphUrl: string, // kept for consistency, not used in current implementation
  subgraphData: { totalGEarned?: string; totalGSpent?: string } | null | undefined
): {
  totalEarned: string | null;
  totalSpent: string | null;
  loading: boolean;
  unavailable: boolean;
} {
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN.id });

  const hasSubgraphStats =
    subgraphData?.totalGEarned != null && subgraphData?.totalGSpent != null;

  // This query is declared unconditionally. It used to sit behind an early
  // return taken once subgraph data arrived, so the hook count changed between
  // renders — React's hook list desynced and the profile route died with
  // "Cannot read properties of undefined (reading 'length')". `enabled` is the
  // correct way to skip the work; returning early is not.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["gdollar-stats-events", address],
    enabled:
      ENABLE_EVENT_SCAN_FALLBACK && !!address && !!publicClient && !hasSubgraphStats,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: () => fetchGDollarStatsFromEvents(address as string, publicClient),
  });

  if (hasSubgraphStats) {
    return {
      totalEarned: subgraphData!.totalGEarned!,
      totalSpent: subgraphData!.totalGSpent!,
      loading: false,
      unavailable: false,
    };
  }

  const totalEarned = data?.totalEarned ?? null;
  const totalSpent = data?.totalSpent ?? null;

  // With the scan disabled the query never runs, so isLoading stays false and
  // this resolves straight to "unavailable" — the caller renders the stats card
  // in its empty state rather than a misleading 0.
  return {
    totalEarned,
    totalSpent,
    loading: ENABLE_EVENT_SCAN_FALLBACK && isLoading,
    unavailable: totalEarned === null || totalSpent === null || isError,
  };
}
