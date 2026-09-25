/**
 * Incremental chain scan. Only ever reads blocks above the stored checkpoint,
 * which keeps each refresh small and makes double-counting impossible.
 *
 * Celo public RPC nodes sometimes return an empty getLogs result for a range
 * that does have logs, rather than erroring. The union-of-repeats method from
 * scripts/count-users.mjs defends against it: a chunk is read REPEATS times and
 * the logs unioned by (block, logIndex). The failure mode is only ever a
 * MISSING log, never an invented one, so the union converges upward to truth.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { celo } from "viem/chains";
import { GAME_ADDRESS, MAX_RANGE } from "./config";
import { applyLogs, type RawLog, type StatsState } from "./state";

const RPCS = (process.env.CELO_RPC_URLS ?? "https://forno.celo.org").split(",").map((s) => s.trim()).filter(Boolean);
const REPEATS = Number(process.env.STATS_SCAN_REPEATS ?? 3);

/** Cap per invocation so a serverless request cannot run past its timeout. */
const MAX_CHUNKS_PER_RUN = Number(process.env.STATS_MAX_CHUNKS ?? 12);

/**
 * `cache: "no-store"` is load-bearing, not defensive.
 *
 * Next patches global fetch and applies its own cache, including a cache that
 * persists on disk across server restarts. viem's transport calls fetch, so
 * without this every JSON-RPC read — chain head AND getLogs — can be served
 * from that cache. Measured: eth_blockNumber returned a head 16,924 blocks
 * (~4.7 hours) stale, identically across repeated reads and across a restart,
 * while the same call outside Next returned the true tip. The page would have
 * frozen at whatever head was cached first while reporting itself caught up.
 */
const clients: PublicClient[] = RPCS.map(
  (url) => createPublicClient({
    chain: celo,
    transport: http(url, { timeout: 15_000, fetchOptions: { cache: "no-store" } }),
  }) as PublicClient
);

/**
 * Chain head, read defensively.
 *
 * forno is a load-balanced pool whose members are not equally caught up: a
 * single read was measured returning a head ~16,900 blocks (nearly 5 hours)
 * behind the true tip. An under-reported head is not a correctness problem —
 * scanForward simply stops early and the next run continues — but it makes the
 * page silently lag while reporting itself caught up.
 *
 * So: read several times with caching disabled and take the MAXIMUM. Heads only
 * move forward, so the largest answer is the most current one, and a lagging
 * node can only ever be outvoted, never believed over a fresher one.
 */
export async function getHeadBlock(): Promise<number> {
  const reads = await Promise.all(
    Array.from({ length: Math.max(3, clients.length) }, async (_, i) => {
      try {
        return Number(await clients[i % clients.length].getBlockNumber({ cacheTime: 0 }));
      } catch {
        return 0;
      }
    })
  );
  const head = Math.max(...reads);
  if (head === 0) throw new Error("could not read chain head from any RPC");
  return head;
}

async function readChunk(from: bigint, to: bigint): Promise<RawLog[] | null> {
  const seen = new Map<string, RawLog>();
  let anySuccess = false;
  for (let rep = 0; rep < REPEATS; rep++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const logs = await clients[(rep + attempt) % clients.length].getLogs({
          address: GAME_ADDRESS, fromBlock: from, toBlock: to,
        });
        anySuccess = true;
        for (const l of logs) {
          seen.set(`${l.blockNumber}:${l.logIndex}`, {
            blockNumber: Number(l.blockNumber),
            topics: l.topics as unknown as string[],
            data: l.data as string | undefined,
          });
        }
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
  }
  if (!anySuccess) return null; // every read errored: do NOT advance the checkpoint
  return [...seen.values()];
}

export interface ScanResult { scannedTo: number; chunks: number; logs: number; caughtUp: boolean }

/**
 * Advance `state` toward chain head. Returns how far it got; the caller saves.
 * Stops early on a hard RPC failure so the checkpoint never skips a range.
 */
export async function scanForward(state: StatsState, head: number): Promise<ScanResult> {
  let from = state.checkpointBlock + 1;
  let chunks = 0;
  let logCount = 0;

  while (from <= head && chunks < MAX_CHUNKS_PER_RUN) {
    const to = Math.min(from + MAX_RANGE - 1, head);
    const logs = await readChunk(BigInt(from), BigInt(to));
    if (logs === null) {
      return { scannedTo: state.checkpointBlock, chunks, logs: logCount, caughtUp: false };
    }
    logs.sort((a, b) => a.blockNumber - b.blockNumber);
    applyLogs(state, logs, to);
    logCount += logs.length;
    chunks += 1;
    from = to + 1;
  }

  return { scannedTo: state.checkpointBlock, chunks, logs: logCount, caughtUp: state.checkpointBlock >= head };
}
