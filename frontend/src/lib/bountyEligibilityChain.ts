/**
 * On-chain reads behind bounty eligibility (server only). Read-only: nothing is signed or sent.
 *
 * Purchases: a bounty's blocks are read in 5,000-block chunks (forno's limit for eth_getLogs),
 * each chunk REPEATS times with the results merged. Public Celo RPCs sometimes return an empty
 * list for a range that does have logs; a missed log can only undercount, never invent a
 * purchase, and the merge (keyed by block and log index) never stores a log twice. Progress is
 * kept in memory per bounty, so a request only reads blocks it hasn't read yet. After a cold
 * start the scan restarts from the bounty's first block, at most MAX_CHUNKS chunks per request,
 * and reports itself incomplete until it has caught up. Counts are always filtered to the
 * requested window, so blocks read past a bounty's end can never be counted for it.
 *
 * Verification: GoodDollar's Identity.isWhitelisted, through Multicall3 in batches of at most
 * VERIFY_CALLS wallets, cached for a few minutes. A failed read is reported as unknown (null).
 */
import { parseAbi, type PublicClient } from "viem";
import { GAME2048_ADDRESS, IDENTITY_ADDRESS } from "./constants";
import { PURCHASE_TOPICS, addPurchaseLogs, purchaseCounts, type BlockWindow, type PurchaseEntry, type PurchaseLog } from "./bountyEligibility";

const CHUNK = 5_000n;
const REPEATS = Math.max(1, Number(process.env.BOUNTY_SCAN_REPEATS ?? 2));
const MAX_CHUNKS = Math.max(1, Number(process.env.BOUNTY_SCAN_MAX_CHUNKS ?? 30));
const PARALLEL = 6;
const VERIFY_CALLS = 100;
const VERIFIED_TTL_MS = 5 * 60_000;

interface ScanState { fromBlock: bigint; scannedTo: bigint; seen: Map<string, PurchaseEntry> }
const scans = new Map<string, ScanState>();

export interface PurchaseScan {
  /** Qualifying purchase transactions per buyer inside the window (a lower bound until complete). */
  counts: Map<string, number>;
  /** True once every block in the window has been read. */
  complete: boolean;
  scannedTo: bigint;
}

async function readChunk(client: PublicClient, from: bigint, to: bigint): Promise<PurchaseLog[]> {
  return (await client.request({
    method: "eth_getLogs",
    params: [{ address: GAME2048_ADDRESS, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [PURCHASE_TOPICS] }],
  })) as PurchaseLog[];
}

/**
 * Qualifying purchases per buyer inside `window` (inclusive at both ends). For a live bounty
 * `toBlock` is the latest block, and later calls continue from where this one stopped.
 */
export async function bountyPurchases(client: PublicClient, bountyId: string, window: BlockWindow): Promise<PurchaseScan> {
  let s = scans.get(bountyId);
  if (!s || s.fromBlock !== window.fromBlock) {
    s = { fromBlock: window.fromBlock, scannedTo: window.fromBlock - 1n, seen: new Map() };
    scans.set(bountyId, s);
  }
  const chunks: Array<[bigint, bigint]> = [];
  for (let from = s.scannedTo + 1n; from <= window.toBlock && chunks.length < MAX_CHUNKS; from += CHUNK) {
    const to = from + CHUNK - 1n > window.toBlock ? window.toBlock : from + CHUNK - 1n;
    chunks.push([from, to]);
  }
  // Read in order, a few chunks at a time; stop at the first chunk that fails so `scannedTo`
  // never skips a range that wasn't read.
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      batch.map(async ([from, to]) => (await Promise.all(Array.from({ length: REPEATS }, () => readChunk(client, from, to)))).flat())
    );
    let ok = true;
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status !== "fulfilled") { ok = false; break; }
      addPurchaseLogs(s.seen, r.value, GAME2048_ADDRESS, { fromBlock: s.fromBlock, toBlock: batch[j][1] });
      s.scannedTo = batch[j][1];
    }
    if (!ok) break;
  }
  return { counts: purchaseCounts(s.seen, window), complete: s.scannedTo >= window.toBlock, scannedTo: s.scannedTo };
}

const IDENTITY_ABI = parseAbi(["function isWhitelisted(address account) view returns (bool)"]);
const verifiedCache = new Map<string, { at: number; value: boolean }>();

/** GoodDollar verification per wallet (lowercase address): true, false, or null if it couldn't be read. */
export async function goodDollarVerification(client: PublicClient, wallets: readonly string[]): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  const now = Date.now();
  const todo: string[] = [];
  for (const w of wallets) {
    const hit = verifiedCache.get(w);
    if (hit && now - hit.at < VERIFIED_TTL_MS) out.set(w, hit.value);
    else todo.push(w);
  }
  for (let i = 0; i < todo.length; i += VERIFY_CALLS) {
    const part = todo.slice(i, i + VERIFY_CALLS);
    try {
      const results = await client.multicall({
        allowFailure: true,
        contracts: part.map((w) => ({ address: IDENTITY_ADDRESS, abi: IDENTITY_ABI, functionName: "isWhitelisted" as const, args: [w as `0x${string}`] })),
      });
      results.forEach((r, k) => {
        if (r.status === "success") {
          out.set(part[k], r.result as boolean);
          verifiedCache.set(part[k], { at: now, value: r.result as boolean });
        } else {
          out.set(part[k], null);
        }
      });
    } catch {
      for (const w of part) out.set(w, null);
    }
  }
  return out;
}

/** The chain head, for a live bounty's purchase window. */
export const latestBlock = (client: PublicClient) => client.getBlockNumber();

/** Test hook: forget scan progress and cached verification. */
export function resetEligibilityCaches() {
  scans.clear();
  verifiedCache.clear();
}
