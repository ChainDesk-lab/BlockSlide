/**
 * Eligibility for bounties with rules (the Season 5 Leaderboard Race): what the app checks from
 * on-chain data, and what only the team can check.
 *
 * Checked from on-chain data (see bountyEligibilityChain for the reads):
 * - GoodDollar verification: Identity.isWhitelisted(wallet), the same check the game makes before
 *   it pays a milestone reward. The subgraph's `isVerified` flag is NOT used for this: the mapping
 *   sets it for any wallet that earns XP, and since V6 unverified wallets can earn XP too.
 * - Qualifying Shop purchases, counted per transaction: a successful transaction that paid for at
 *   least one Shop item counts once, however many items it bought (a smart-account batch, or
 *   several Undo credits). A failed transaction counts zero, because a reverted transaction leaves
 *   no logs. A zero-price purchase event (a free claim) counts zero, and so does every other kind
 *   of transaction, because only the four purchase events are read. Logs are keyed by block and
 *   log index, so a log that is read twice (the scan reads every range more than once) is stored
 *   once, and counts are filtered to the window when they are read.
 *
 * Not checkable here: following an X account. The API lists those as the team's checks, and
 * winners stay provisional until the team has made them.
 */
import { toEventSelector, type Hex } from "viem";
import type { BountyRules, PrizePlace } from "../config/bounties";

/**
 * The V6 Shop purchase events (the live contract's; pre-V6 events predate every rule bounty).
 * In all four, the price paid is the last word of the log data.
 */
export const PURCHASE_EVENT_SIGNATURES = [
  "ShieldPurchased(address,uint256,uint256)",
  "XpBoostPurchased(address,uint8,uint64,uint256)",
  "UndoPurchased(address,uint256,uint256)",
  "CosmeticPurchased(address,uint256,uint256)",
] as const;

export const PURCHASE_TOPICS: Hex[] = PURCHASE_EVENT_SIGNATURES.map((s) => toEventSelector(s));

export interface PurchaseLog {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: bigint | number | string;
  logIndex: number | string;
  transactionHash: string;
  removed?: boolean;
}

/** One purchase event as the scan stores it. */
export interface PurchaseEntry {
  block: bigint;
  buyer: string; // lowercase address
  tx: string;    // lowercase transaction hash
  paid: boolean; // price paid > 0
}

export interface BlockWindow {
  fromBlock: bigint; // inclusive
  toBlock: bigint;   // inclusive
}

const PURCHASE_TOPIC_SET = new Set(PURCHASE_TOPICS.map((t) => t.toLowerCase()));

const toBigInt = (v: bigint | number | string) => (typeof v === "bigint" ? v : BigInt(v));
const toNumber = (v: number | string) => (typeof v === "number" ? v : Number(BigInt(v)));

/** The price paid: the last 32-byte word of the log data (0 if the data is too short). */
function pricePaid(data: string): bigint {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length < 64) return 0n;
  return BigInt(`0x${hex.slice(-64)}`);
}

/**
 * Adds purchase logs to `seen` (key "block:logIndex") and returns how many were new. Ignored: other
 * contracts' logs, other events, logs outside the window, logs a reorg removed, and logs already
 * seen. Zero-price events are stored but never counted (see purchaseCounts).
 */
export function addPurchaseLogs(seen: Map<string, PurchaseEntry>, logs: readonly PurchaseLog[], game: string, window: BlockWindow): number {
  const gameLc = game.toLowerCase();
  let added = 0;
  for (const l of logs) {
    if (l.removed) continue;
    if (l.address.toLowerCase() !== gameLc) continue;
    const t0 = l.topics[0]?.toLowerCase();
    if (!t0 || !PURCHASE_TOPIC_SET.has(t0)) continue;
    const block = toBigInt(l.blockNumber);
    if (block < window.fromBlock || block > window.toBlock) continue;
    const buyerTopic = l.topics[1];
    if (!buyerTopic || buyerTopic.length !== 66 || !l.transactionHash) continue;
    const key = `${block}:${toNumber(l.logIndex)}`;
    if (seen.has(key)) continue;
    seen.set(key, { block, buyer: `0x${buyerTopic.slice(26)}`.toLowerCase(), tx: l.transactionHash.toLowerCase(), paid: pricePaid(l.data ?? "0x") > 0n });
    added++;
  }
  return added;
}

/**
 * Qualifying purchases per buyer (lowercase address): the number of distinct successful
 * transactions in which the buyer paid for at least one Shop item, inside `window` if given.
 */
export function purchaseCounts(seen: ReadonlyMap<string, PurchaseEntry>, window?: BlockWindow): Map<string, number> {
  const txs = new Map<string, Set<string>>();
  seen.forEach((e) => {
    if (!e.paid) return;
    if (window && (e.block < window.fromBlock || e.block > window.toBlock)) return;
    let set = txs.get(e.buyer);
    if (!set) txs.set(e.buyer, (set = new Set()));
    set.add(e.tx);
  });
  const out = new Map<string, number>();
  txs.forEach((set, buyer) => out.set(buyer, set.size));
  return out;
}

/** The automated checks for one player. `null` means the data couldn't be read (yet). */
export interface EntryEligibility {
  goodDollarVerified: boolean | null;
  /** Qualifying purchases counted so far (a lower bound while `purchasesComplete` is false). */
  purchases: number | null;
  purchasesComplete: boolean;
  /** Every automated check passes (true), one fails (false), or one is still unknown (null). */
  meetsChecks: boolean | null;
}

/**
 * `purchases` is a lower bound until the scan has read the whole window, so an incomplete count
 * below the minimum is "unknown", not "fails"; a count that already reaches it passes.
 */
export function evaluateEligibility(
  rules: BountyRules,
  verified: boolean | null | undefined,
  purchases: number | null | undefined,
  purchasesComplete = true,
): EntryEligibility {
  const needsVerification = !!rules.goodDollarVerified;
  const min = rules.minPurchases ?? 0;
  const v = needsVerification ? (verified ?? null) : null;
  const p = min > 0 ? (purchases ?? null) : null;
  const verificationOk = needsVerification ? v : true;
  const purchasesOk = min > 0 ? (p === null ? null : p >= min ? true : purchasesComplete ? false : null) : true;
  const meetsChecks = verificationOk === false || purchasesOk === false ? false : verificationOk === null || purchasesOk === null ? null : true;
  return { goodDollarVerified: v, purchases: p, purchasesComplete: min > 0 ? purchasesComplete && p !== null : true, meetsChecks };
}

export const UNKNOWN_ELIGIBILITY: EntryEligibility = { goodDollarVerified: null, purchases: null, purchasesComplete: false, meetsChecks: null };

/**
 * The first `count` rows, in leaderboard order, that pass every automated check, with their
 * positions. `complete` is false when a row ranked above the last pick (or, with fewer than
 * `count` picks, any row at all) is still unknown: that row could still pass and change the result.
 */
export function eligibleWinners<T>(rows: readonly T[], eligibilityOf: (row: T) => EntryEligibility, count: number): { winners: Array<{ row: T; index: number }>; complete: boolean } {
  const winners: Array<{ row: T; index: number }> = [];
  let complete = true;
  for (let index = 0; index < rows.length && winners.length < count; index++) {
    const e = eligibilityOf(rows[index]).meetsChecks;
    if (e === true) winners.push({ row: rows[index], index });
    else if (e === null) complete = false;
  }
  return { winners, complete };
}

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** "$10 equivalent in G$": a dollar-equivalent amount, never a token quantity. */
export const fmtPrizeUsd = (usd: number) => `$${usd.toLocaleString("en-US")} equivalent in G$`;

export const prizePoolUsd = (table: readonly PrizePlace[]) => table.reduce((sum, p) => sum + p.usd, 0);

export const prizeFor = (table: readonly PrizePlace[] | undefined, place: number) => table?.find((p) => p.place === place)?.usd ?? null;
