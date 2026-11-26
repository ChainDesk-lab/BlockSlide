/**
 * Checks on Celo that a referral payment really reached the player: the transaction succeeded and
 * sent at least the request's amount of G$ to the request's payout wallet. Only then can a
 * request be marked paid.
 */
import { createPublicClient, erc20Abi, fallback, http, parseEventLogs } from "viem";
import { celo } from "viem/chains";
import { G_DOLLAR_ADDRESS } from "./constants";

export const G_DECIMALS = 18n;
export const gToWei = (g: number) => BigInt(g) * 10n ** G_DECIMALS;

export type PaymentCheck =
  | { ok: true; paidWei: bigint }
  | { ok: false; reason: "not_found" | "failed" | "no_transfer" | "too_little"; paidWei?: bigint };

const RPC_URLS = (process.env.CELO_RPC_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);

export async function checkPayment(txHash: `0x${string}`, payTo: string, amountG: number): Promise<PaymentCheck> {
  const client = createPublicClient({
    chain: celo,
    transport: fallback((RPC_URLS.length ? RPC_URLS : ["https://forno.celo.org"]).map((u) => http(u, { timeout: 10_000 }))),
  });
  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch((e: Error) => {
    if (/could not be found|not found/i.test(e.message)) return null;
    throw e;
  });
  if (!receipt) return { ok: false, reason: "not_found" };
  if (receipt.status !== "success") return { ok: false, reason: "failed" };

  const token = G_DOLLAR_ADDRESS.toLowerCase(), to = payTo.toLowerCase();
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
    .filter((l) => l.address.toLowerCase() === token && l.args.to.toLowerCase() === to);
  if (!transfers.length) return { ok: false, reason: "no_transfer" };
  const paidWei = transfers.reduce((n, l) => n + l.args.value, 0n);
  return paidWei >= gToWei(amountG) ? { ok: true, paidWei } : { ok: false, reason: "too_little", paidWei };
}

export function paymentProblem(check: Exclude<PaymentCheck, { ok: true }>, amountG: number, payTo: string): string {
  switch (check.reason) {
    case "not_found": return "That transaction isn't on Celo yet. If you just sent it, wait a few seconds and try again.";
    case "failed": return "That transaction failed on Celo, so no G$ was sent.";
    case "no_transfer": return `That transaction didn't send any G$ to ${payTo}.`;
    case "too_little": {
      const sent = Number((check.paidWei ?? 0n) / 10n ** G_DECIMALS).toLocaleString("en-US");
      return `That transaction sent ${sent} G$ to the payout wallet, less than the ${amountG.toLocaleString("en-US")} G$ requested.`;
    }
  }
}
