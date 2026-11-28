/**
 * On-chain reads behind bounty eligibility (server only). Read-only: nothing is signed or sent.
 *
 * Purchases: a bounty's blocks are read in 5,000-block chunks (forno's limit for eth_getLogs),
 * each chunk REPEATS times with the results merged. Public Celo RPCs sometimes return an empty
 * list for a range that does have logs; a missed log can only undercount, never invent a
 * purchase, and the merge (keyed by block and log index) never stores a log twice. Progress is
 * kept in memory per bounty, and also in an optional ScanStore (Redis in production), so a cold
 * start or another server instance picks up where the last request stopped instead of starting
 * again from the bounty's first block. Each request reads until it has caught up, or until
 * MAX_CHUNKS chunks or TIME_BUDGET_MS have been used, whichever comes first, and reports itself
 * incomplete until it has caught up. A whole 5-day race (~87 chunks) fits in one request.
 * Counts are always filtered to the requested window, so blocks read past a bounty's end can
 * never be counted for it.
 *
 * Verification: GoodDollar's Identity.isWhitelisted, through Multicall3 in batches of at most
 * VERIFY_CALLS wallets, cached for a few minutes. A failed read is reported as unknown (null).
 */
import { parseAbi, type PublicClient } from "viem";
import { GAME2048_ADDRESS, IDENTITY_ADDRESS } from "./constants";
import { PURCHASE_TOPICS, addPurchaseLogs, purchaseCounts, type BlockWindow, type PurchaseEntry, type PurchaseLog } from "./bountyEligibility";

const CHUNK = 5_000n;
const REPEATS = Math.max(1, Number(process.env.BOUNTY_SCAN_REPEATS ?? 2));
const MAX_CHUNKS = Math.max(1, Number(process.env.BOUNTY_SCAN_MAX_CHUNKS ?? 200));
/** Stop starting new reads after this long, so the route answers well inside its maxDuration. */
const TIME_BUDGET_MS = Math.max(1_000, Number(process.env.BOUNTY_SCAN_TIME_BUDGET_MS ?? 35_000));
const PARALLEL = 6;
const VERIFY_CALLS = 100;
const VERIFIED_TTL_MS = 5 * 60_000;

interface ScanState { fromBlock: bigint; scannedTo: bigint; seen: Map<string, PurchaseEntry> }
const scans = new Map<string, ScanState>();

/**
 * Where scan progress survives between requests. `load` returns what was saved (or null); `save`
 * stores the new state. Both may fail: a failed load starts from memory, a failed save is ignored.
 */
export interface ScanStore {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
}

/** Saved form: bigints as strings, entries as [key, block, buyer, tx, paid]. */
interface SavedScan { v: 1; fromBlock: string; scannedTo: string; entries: [string, string, string, string, boolean][] }

const storeKey = (bountyId: string, fromBlock: bigint) => `bounty:purchase-scan:v1:${bountyId}:${fromBlock}`;

function encodeScan(s: ScanState): string {
  const entries: SavedScan["entries"] = [];
  s.seen.forEach((e, k) => entries.push([k, e.block.toString(), e.buyer, e.tx, e.paid]));
  return JSON.stringify({ v: 1, fromBlock: s.fromBlock.toString(), scannedTo: s.scannedTo.toString(), entries } satisfies SavedScan);
}

function decodeScan(raw: string | null, fromBlock: bigint): ScanState | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as SavedScan;
    if (d.v !== 1 || BigInt(d.fromBlock) !== fromBlock) return null;
    const seen = new Map<string, PurchaseEntry>();
    for (const [k, block, buyer, tx, paid] of d.entries) seen.set(k, { block: BigInt(block), buyer, tx, paid });
    return { fromBlock, scannedTo: BigInt(d.scannedTo), seen };
  } catch {
    return null;
  }
}

/**
 * Combines two scans of the same window. Each one's logs cover every block up to its own
 * `scannedTo`, so their union covers up to the larger one.
 */
function mergeScans(a: ScanState, b: ScanState | null): ScanState {
  if (!b) return a;
  const seen = new Map(a.seen);
  b.seen.forEach((e, k) => { if (!seen.has(k)) seen.set(k, e); });
  return { fromBlock: a.fromBlock, scannedTo: a.scannedTo > b.scannedTo ? a.scannedTo : b.scannedTo, seen };
}

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
export async function bountyPurchases(client: PublicClient, bountyId: string, window: BlockWindow, store?: ScanStore): Promise<PurchaseScan> {
  const started = Date.now();
  const key = storeKey(bountyId, window.fromBlock);
  let s = scans.get(bountyId);
  if (!s || s.fromBlock !== window.fromBlock) {
    s = { fromBlock: window.fromBlock, scannedTo: window.fromBlock - 1n, seen: new Map() };
  }
  // Pick up progress another instance (or an earlier cold start) saved.
  if (store && s.scannedTo < window.toBlock) {
    try { s = mergeScans(s, decodeScan(await store.load(key), window.fromBlock)); } catch { /* use memory */ }
  }
  scans.set(bountyId, s);
  const before = s.scannedTo;
  const chunks: Array<[bigint, bigint]> = [];
  for (let from = s.scannedTo + 1n; from <= window.toBlock && chunks.length < MAX_CHUNKS; from += CHUNK) {
    const to = from + CHUNK - 1n > window.toBlock ? window.toBlock : from + CHUNK - 1n;
    chunks.push([from, to]);
  }
  // Read in order, a few chunks at a time; stop at the first chunk that fails so `scannedTo`
  // never skips a range that wasn't read.
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
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
  if (store && s.scannedTo > before) {
    try {
      // Merge with whatever was saved meanwhile, so two instances never undo each other's progress.
      const latest = mergeScans(s, decodeScan(await store.load(key), window.fromBlock));
      await store.save(key, encodeScan(latest));
    } catch (err) {
      console.error(`[bountyPurchases] ${bountyId}: saving scan progress failed:`, (err as Error).message);
    }
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
