/**
 * READ-ONLY: reconcile the 5% GoodDollar UBI contribution on a chain, from its
 * logs alone. Every eligible Shop purchase must have a UbiContribution event
 * and a G$ Transfer from the game to the UBI recipient for exactly
 * floor(amountPaid × 5%) — recomputed here, not taken from the contract.
 *
 *   FROM_BLOCK=<upgrade block> npx hardhat run scripts/checks/reconcile-ubi-contributions.ts
 *
 * Env: RPC_URL (default https://forno.celo.org), FROM_BLOCK (required),
 * TO_BLOCK (default latest), REPEATS (default 5: public Celo RPCs silently drop
 * logs, so each chunk is read REPEATS times and the results unioned),
 * GAME, TOKEN, RECIPIENT (default: production addresses), OUT (JSON report path).
 * Exits 1 if anything doesn't reconcile. Nothing is signed or sent.
 */
import { writeFileSync } from "node:fs";
import { createPublicClient, getAddress, http, type Address } from "viem";
import { GAME_EVENTS_ABI, TRANSFER_ABI, reconcileUbiContributions, type ChainLog } from "../lib/ubiReconcile.js";

const RPC_URL = process.env.RPC_URL ?? "https://forno.celo.org";
const GAME = getAddress(process.env.GAME ?? "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const TOKEN = getAddress(process.env.TOKEN ?? "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
const RECIPIENT = getAddress(process.env.RECIPIENT ?? "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1");
const REPEATS = Number(process.env.REPEATS ?? 5);
const CHUNK = 5_000n; // forno's range cap
if (!process.env.FROM_BLOCK) throw new Error("Set FROM_BLOCK (the upgrade block): contributions can't exist before it");

const client = createPublicClient({ transport: http(RPC_URL, { retryCount: 4, retryDelay: 800 }) });
const from = BigInt(process.env.FROM_BLOCK);
const to = process.env.TO_BLOCK ? BigInt(process.env.TO_BLOCK) : await client.getBlockNumber();

const logs: ChainLog[] = [];
let calls = 0;
for (let a = from; a <= to; a += CHUNK) {
  const b = a + CHUNK - 1n < to ? a + CHUNK - 1n : to;
  for (let r = 0; r < REPEATS; r++) {
    const [gameLogs, toRecipient] = await Promise.all([
      client.getLogs({ address: GAME, events: GAME_EVENTS_ABI, fromBlock: a, toBlock: b }),
      client.getLogs({ address: TOKEN, event: TRANSFER_ABI[0], args: { from: GAME, to: RECIPIENT }, fromBlock: a, toBlock: b }),
    ]);
    calls += 2;
    for (const l of [...gameLogs, ...toRecipient]) {
      logs.push({
        transactionHash: l.transactionHash!, logIndex: l.logIndex!, blockNumber: l.blockNumber!,
        address: l.address as Address, topics: l.topics, data: l.data,
      });
    }
  }
}

const report = reconcileUbiContributions(logs, { game: GAME, token: TOKEN, recipient: RECIPIENT });
const g = (wei: bigint) => `${wei / 10n ** 18n}.${(wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4)} G$`;
console.log(`blocks ${from}..${to}, ${calls} log queries (${REPEATS} passes, duplicates dropped: ${report.duplicatesDropped})`);
console.log(`purchases ${report.purchases} (eligible ${report.eligiblePurchases}), paid ${g(report.paid)}`);
console.log(`expected (recomputed) ${g(report.expected)}`);
console.log(`recorded by UbiContribution events ${g(report.recordedByEvents)}`);
console.log(`transferred to ${RECIPIENT} ${g(report.transferredToRecipient)}`);
console.log(`verified (purchase, event and transfer agree) ${g(report.verified)} in ${report.verifiedCount} contributions`);
for (const d of report.discrepancies) console.log(`DISCREPANCY ${d.kind} ${d.transactionHash}#${d.logIndex}: ${d.detail}`);
if (process.env.OUT) {
  writeFileSync(process.env.OUT, JSON.stringify({ from: String(from), to: String(to), ...report }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}
if (report.discrepancies.length > 0 || report.verified !== report.expected) {
  console.log("RECONCILIATION FAILED");
  process.exitCode = 1;
} else {
  console.log("RECONCILED: every eligible purchase contributed exactly 5%, with a matching G$ transfer");
}
