/**
 * Reads a block range of the game contract's logs from public RPC nodes, for the stats reseed dry
 * run. Same defence as scan.ts and scripts/analytics/count-users.mjs: Celo's public nodes sometimes
 * answer a range that HAS logs with an empty result instead of an error, so each chunk is read
 * `repeats` times and the results unioned by (block, logIndex). The failure is only ever a missing
 * log, never an invented one, so the union converges upward to the truth.
 *
 * Read-only. The reader is injectable (`getLogs`) so tests need no network.
 */
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { GAME_ADDRESS, MAX_RANGE } from "./config";
import type { GapLog } from "./reseed";

export type GetLogs = (from: number, to: number) => Promise<Array<{ blockNumber: number; logIndex: number; topics: string[]; data: string; transactionHash: string | null }>>;

/** A getLogs over viem for the game contract, spreading reads across `urls`. */
export function viemGetLogs(urls: string[]): GetLogs {
  const clients = urls.map((url) => createPublicClient({ chain: celo, transport: http(url, { timeout: 20_000, fetchOptions: { cache: "no-store" } }) }));
  let n = 0;
  return async (from, to) => {
    const client = clients[n++ % clients.length];
    const logs = await client.getLogs({ address: GAME_ADDRESS, fromBlock: BigInt(from), toBlock: BigInt(to) });
    return logs.map((l) => ({
      blockNumber: Number(l.blockNumber), logIndex: Number(l.logIndex), topics: [...l.topics], data: l.data ?? "0x", transactionHash: l.transactionHash ?? null,
    }));
  };
}

export interface ReadOptions {
  from: number;
  to: number;
  getLogs: GetLogs;
  repeats?: number;
  chunk?: number;
  concurrency?: number;
  /** Attempts per read before it counts as failed. */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onChunk?: (done: number, total: number) => void;
}

export interface ReadResult {
  logs: GapLog[];
  /** Chunks where EVERY read failed. A non-empty list means the result is incomplete and must not be trusted. */
  failedChunks: Array<{ from: number; to: number }>;
  /** Chunks whose repeated reads disagreed, i.e. at least one read came back short: the failure mode the union defends against. */
  disagreeingChunks: Array<{ from: number; to: number; counts: number[] }>;
}

export async function readLogsRange(o: ReadOptions): Promise<ReadResult> {
  const repeats = o.repeats ?? 3, chunk = Math.min(o.chunk ?? MAX_RANGE, MAX_RANGE), concurrency = o.concurrency ?? 4, attempts = o.attempts ?? 3;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ranges: Array<{ from: number; to: number }> = [];
  for (let from = o.from; from <= o.to; from += chunk) ranges.push({ from, to: Math.min(from + chunk - 1, o.to) });

  const union = new Map<string, GapLog>();
  const failedChunks: ReadResult["failedChunks"] = [];
  const disagreeingChunks: ReadResult["disagreeingChunks"] = [];
  let done = 0;
  const queue = [...ranges];

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const counts: number[] = [];
      for (let rep = 0; rep < repeats; rep++) {
        for (let attempt = 0; attempt < attempts; attempt++) {
          try {
            const logs = await o.getLogs(r.from, r.to);
            counts.push(logs.length);
            for (const l of logs) {
              union.set(`${l.blockNumber}:${l.logIndex}`, { blockNumber: l.blockNumber, logIndex: l.logIndex, topics: l.topics, data: l.data, transactionHash: l.transactionHash ?? undefined });
            }
            break;
          } catch {
            await sleep(250 * 2 ** attempt);
          }
        }
      }
      if (counts.length === 0) failedChunks.push(r);
      else if (new Set(counts).size > 1) disagreeingChunks.push({ ...r, counts });
      o.onChunk?.(++done, ranges.length);
    }
  }));

  const logs = [...union.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  return { logs, failedChunks, disagreeingChunks };
}

/** Whether two log sets are identical: same (block, logIndex), topics and data. Returns what differs, if anything. */
export function compareLogSets(a: readonly GapLog[], b: readonly GapLog[]) {
  const key = (l: GapLog) => `${l.blockNumber}:${l.logIndex}`;
  const body = (l: GapLog) => `${l.topics.join(",")}|${l.data ?? "0x"}`;
  const A = new Map(a.map((l) => [key(l), l])), B = new Map(b.map((l) => [key(l), l]));
  const onlyA = [...A.keys()].filter((k) => !B.has(k));
  const onlyB = [...B.keys()].filter((k) => !A.has(k));
  const different = [...A.keys()].filter((k) => B.has(k) && body(A.get(k)!) !== body(B.get(k)!));
  return { identical: onlyA.length + onlyB.length + different.length === 0, onlyA, onlyB, different };
}
