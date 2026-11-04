import { decodeEventLog, getAddress } from "viem";
import { GAME2048_UBI_ABI } from "./abiUbi";

/**
 * GoodDollar UBI contribution: 5% of every paid shop purchase, sent by the
 * contract to the GoodDollar UBIScheme in the purchase transaction.
 *
 * Every number shown comes from the chain: the rate from
 * UBI_CONTRIBUTION_BPS(), the confirmed amount from the UbiContribution event
 * in the purchase receipt. Nothing here is hard-coded to 5%.
 */

/** Same formula as the contract's ubiContributionFor: floor(amount × bps / 10,000). */
export function ubiContributionFor(amount: bigint, bps: bigint): bigint {
  return (amount * bps) / 10_000n;
}

/** "5%" for 500 bps; "2.5%" for 250. */
export function formatBps(bps: bigint): string {
  const whole = bps / 100n;
  const frac = bps % 100n;
  return frac === 0n ? `${whole}%` : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}%`;
}

export interface ConfirmedContribution {
  contribution: bigint;
  amountPaid: bigint;
  recipient: `0x${string}`;
}

/**
 * The UbiContribution(s) the game contract emitted in a confirmed receipt for
 * this buyer. Empty when there were none — e.g. on the implementation live
 * before the upgrade — in which case nothing is claimed.
 */
export function contributionsFromReceipt(
  logs: readonly { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }[],
  game: `0x${string}`,
  buyer: `0x${string}`,
): ConfirmedContribution[] {
  const out: ConfirmedContribution[] = [];
  for (const log of logs) {
    if (getAddress(log.address) !== getAddress(game)) continue;
    try {
      const ev = decodeEventLog({ abi: GAME2048_UBI_ABI, data: log.data, topics: log.topics as any });
      if (ev.eventName !== "UbiContribution") continue;
      const a = ev.args as unknown as { buyer: string; amountPaid: bigint; contribution: bigint; recipient: `0x${string}` };
      if (getAddress(a.buyer) !== getAddress(buyer)) continue;
      out.push({ contribution: a.contribution, amountPaid: a.amountPaid, recipient: a.recipient });
    } catch {
      /* not a UbiContribution log */
    }
  }
  return out;
}
