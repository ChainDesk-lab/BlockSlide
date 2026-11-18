/**
 * Independent reconciliation of the 5% GoodDollar UBI contribution, from raw
 * chain logs only: the game's purchase events, its UbiContribution events and
 * the G$ token's own Transfer logs. It recomputes every expected contribution
 * itself (floor(amountPaid × bps / 10,000)) instead of trusting the contract,
 * and reports any purchase, event or transfer that doesn't line up.
 *
 * Pure: give it logs, get a report. scripts/checks/reconcile-ubi-contributions.ts
 * fetches the logs from a chain; tests feed it synthetic and simulated logs.
 */
import { decodeEventLog, getAddress, parseAbi, type Address, type Hex } from "viem";

export interface ChainLog {
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  address: Address;
  topics: readonly Hex[];
  data: Hex;
}

export interface ReconcileConfig {
  game: Address;
  token: Address;
  recipient: Address;
  /** The required rate, in basis points. Default 500 (5%). */
  bps?: bigint;
}

export type DiscrepancyKind =
  | "missing_contribution" // an eligible purchase with no UbiContribution
  | "wrong_amount" // the event's contribution isn't floor(amountPaid × bps / 10,000), or amountPaid differs from the purchase
  | "wrong_recipient" // the event names another recipient
  | "missing_transfer" // an event without its G$ Transfer to the recipient
  | "transfer_mismatch" // the Transfer's value differs from the event's contribution
  | "orphan_event" // a UbiContribution with no purchase event after it in the same transaction
  | "orphan_transfer" // a G$ Transfer from the game to the recipient that no event accounts for
  | "duplicate_log"; // the same (transaction, log index) appeared more than once in the input

export interface Discrepancy {
  kind: DiscrepancyKind;
  transactionHash: Hex;
  logIndex: number;
  detail: string;
}

export interface Contribution {
  transactionHash: Hex;
  blockNumber: bigint;
  purchaseLogIndex: number;
  eventLogIndex: number;
  transferLogIndex: number;
  buyer: Address;
  purchase: string;
  amountPaid: bigint;
  contribution: bigint;
}

export interface ReconcileReport {
  purchases: number;
  /** Purchases whose 5% rounds above zero, which must contribute. */
  eligiblePurchases: number;
  paid: bigint;
  /** Recomputed here from the purchase amounts. */
  expected: bigint;
  /** What the UbiContribution events claim. */
  recordedByEvents: bigint;
  /** What the token's Transfer logs show reaching the recipient from the game. */
  transferredToRecipient: bigint;
  /** Contributions where purchase, event and transfer all agree. */
  verified: bigint;
  verifiedCount: number;
  contributions: Contribution[];
  discrepancies: Discrepancy[];
  duplicatesDropped: number;
}

export const GAME_EVENTS_ABI = parseAbi([
  "event ShieldPurchased(address indexed player, uint256 count, uint256 pricePaid)",
  "event XpBoostPurchased(address indexed player, uint8 multiplier, uint64 expiry, uint256 pricePaid)",
  "event UndoPurchased(address indexed player, uint256 quantity, uint256 pricePaid)",
  "event CosmeticPurchased(address indexed player, uint256 indexed itemId, uint256 pricePaid)",
  "event UbiContribution(address indexed buyer, uint8 indexed item, uint256 itemId, uint256 quantity, uint256 amountPaid, uint256 contribution, address indexed recipient)",
]);
export const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const PURCHASES = new Set(["ShieldPurchased", "XpBoostPurchased", "UndoPurchased", "CosmeticPurchased"]);

/** The rule the product requires: floor(amount × bps / 10,000). */
export const expectedContribution = (amount: bigint, bps = 500n) => (amount * bps) / 10_000n;

const key = (l: { transactionHash: Hex; logIndex: number }) => `${l.transactionHash.toLowerCase()}:${l.logIndex}`;

export function reconcileUbiContributions(logs: readonly ChainLog[], config: ReconcileConfig): ReconcileReport {
  const game = getAddress(config.game);
  const token = getAddress(config.token);
  const recipient = getAddress(config.recipient);
  const bps = config.bps ?? 500n;
  const discrepancies: Discrepancy[] = [];

  // One copy of each log: public RPCs are read repeatedly and unioned, so duplicates are normal input.
  const unique = new Map<string, ChainLog>();
  let duplicatesDropped = 0;
  for (const l of logs) {
    const k = key(l);
    if (unique.has(k)) {
      duplicatesDropped++;
      const prev = unique.get(k)!;
      if (prev.data !== l.data || prev.topics.join() !== l.topics.join()) {
        discrepancies.push({ kind: "duplicate_log", transactionHash: l.transactionHash, logIndex: l.logIndex, detail: "same position, different content" });
      }
      continue;
    }
    unique.set(k, l);
  }

  type Purchase = { logIndex: number; name: string; buyer: Address; amount: bigint };
  type UbiEvent = { logIndex: number; buyer: Address; amountPaid: bigint; contribution: bigint; recipient: Address; used: boolean };
  type ToRecipient = { logIndex: number; value: bigint; used: boolean };
  const byTx = new Map<string, { hash: Hex; block: bigint; purchases: Purchase[]; events: UbiEvent[]; transfers: ToRecipient[] }>();
  const tx = (l: ChainLog) => {
    const h = l.transactionHash.toLowerCase();
    if (!byTx.has(h)) byTx.set(h, { hash: l.transactionHash, block: l.blockNumber, purchases: [], events: [], transfers: [] });
    return byTx.get(h)!;
  };

  for (const l of unique.values()) {
    const at = getAddress(l.address);
    if (at === game) {
      let ev;
      try {
        ev = decodeEventLog({ abi: GAME_EVENTS_ABI, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      } catch {
        continue; // another game event (sessions, scores, …)
      }
      const a = ev.args as Record<string, unknown>;
      if (ev.eventName === "UbiContribution") {
        tx(l).events.push({
          logIndex: l.logIndex, buyer: getAddress(a.buyer as Address), amountPaid: a.amountPaid as bigint,
          contribution: a.contribution as bigint, recipient: getAddress(a.recipient as Address), used: false,
        });
      } else if (PURCHASES.has(ev.eventName)) {
        tx(l).purchases.push({ logIndex: l.logIndex, name: ev.eventName, buyer: getAddress(a.player as Address), amount: a.pricePaid as bigint });
      }
    } else if (at === token) {
      try {
        const ev = decodeEventLog({ abi: TRANSFER_ABI, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
        if (getAddress(ev.args.from) === game && getAddress(ev.args.to) === recipient) {
          tx(l).transfers.push({ logIndex: l.logIndex, value: ev.args.value, used: false });
        }
      } catch {
        /* not a Transfer */
      }
    }
  }

  const report: ReconcileReport = {
    purchases: 0, eligiblePurchases: 0, paid: 0n, expected: 0n, recordedByEvents: 0n, transferredToRecipient: 0n,
    verified: 0n, verifiedCount: 0, contributions: [], discrepancies, duplicatesDropped,
  };

  for (const t of [...byTx.values()].sort((x, y) => (x.block === y.block ? 0 : x.block < y.block ? -1 : 1))) {
    t.purchases.sort((x, y) => x.logIndex - y.logIndex);
    t.events.sort((x, y) => x.logIndex - y.logIndex);
    t.transfers.sort((x, y) => x.logIndex - y.logIndex);
    for (const e of t.events) report.recordedByEvents += e.contribution;
    for (const tr of t.transfers) report.transferredToRecipient += tr.value;

    for (const p of t.purchases) {
      report.purchases++;
      report.paid += p.amount;
      const want = expectedContribution(p.amount, bps);
      report.expected += want;
      if (want === 0n) continue; // rounds to zero: no transfer and no event, by design
      report.eligiblePurchases++;
      // _collectPayment emits UbiContribution just before the purchase event: take the nearest unused one.
      const ev = [...t.events].reverse().find((e) => !e.used && e.logIndex < p.logIndex && e.buyer === p.buyer);
      if (!ev) {
        discrepancies.push({ kind: "missing_contribution", transactionHash: t.hash, logIndex: p.logIndex, detail: `${p.name} paid ${p.amount}, expected ${want}` });
        continue;
      }
      ev.used = true;
      let ok = true;
      if (ev.amountPaid !== p.amount || ev.contribution !== want) {
        ok = false;
        discrepancies.push({ kind: "wrong_amount", transactionHash: t.hash, logIndex: ev.logIndex, detail: `event says ${ev.contribution} of ${ev.amountPaid}; purchase paid ${p.amount}, expected ${want}` });
      }
      if (ev.recipient !== recipient) {
        ok = false;
        discrepancies.push({ kind: "wrong_recipient", transactionHash: t.hash, logIndex: ev.logIndex, detail: `event recipient ${ev.recipient}` });
      }
      // ...and its G$ Transfer to the recipient just before the event.
      const tr = [...t.transfers].reverse().find((x) => !x.used && x.logIndex < ev.logIndex);
      if (!tr) {
        ok = false;
        discrepancies.push({ kind: "missing_transfer", transactionHash: t.hash, logIndex: ev.logIndex, detail: `no G$ Transfer to the recipient for ${ev.contribution}` });
      } else {
        tr.used = true;
        if (tr.value !== ev.contribution) {
          ok = false;
          discrepancies.push({ kind: "transfer_mismatch", transactionHash: t.hash, logIndex: tr.logIndex, detail: `Transfer ${tr.value}, event ${ev.contribution}` });
        }
      }
      if (ok) {
        report.verified += want;
        report.verifiedCount++;
        report.contributions.push({
          transactionHash: t.hash, blockNumber: t.block, purchaseLogIndex: p.logIndex, eventLogIndex: ev.logIndex,
          transferLogIndex: tr!.logIndex, buyer: p.buyer, purchase: p.name, amountPaid: p.amount, contribution: want,
        });
      }
    }
    for (const e of t.events) {
      if (!e.used) discrepancies.push({ kind: "orphan_event", transactionHash: t.hash, logIndex: e.logIndex, detail: `UbiContribution ${e.contribution} with no purchase` });
    }
    for (const tr of t.transfers) {
      if (!tr.used) discrepancies.push({ kind: "orphan_transfer", transactionHash: t.hash, logIndex: tr.logIndex, detail: `G$ Transfer ${tr.value} to the recipient with no UbiContribution` });
    }
  }
  return report;
}
