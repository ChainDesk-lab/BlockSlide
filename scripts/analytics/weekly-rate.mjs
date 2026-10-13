/**
 * Weekly transaction rate for the Game2048 contract.
 *
 * Buckets the unique transaction hashes found by demo-stats.mjs into 7-day
 * windows. Week boundaries are resolved to exact block numbers by binary search
 * on block timestamps, so no assumption is made about Celo's block time.
 *
 * "Transaction" = an onchain transaction that emitted at least one Game2048
 * event. Reverted transactions and any that emitted no events are not visible
 * to a log scan and are therefore excluded.
 *
 * Usage: node scripts/weekly-rate.mjs
 */
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { readFileSync, writeFileSync } from "node:fs";

const c = createPublicClient({ chain: celo, transport: http("https://forno.celo.org", { timeout: 30_000 }), batch: { multicall: false } });
const d = JSON.parse(readFileSync("scripts/out/demo-stats.json", "utf8"));
if (!d.txBlocks) { console.error("demo-stats.json has no txBlocks — re-run scripts/demo-stats.mjs"); process.exit(1); }

const head = BigInt(d.toBlock);
const from = BigInt(d.fromBlock);
const headBlk = await c.getBlock({ blockNumber: head });
const now = Number(headBlk.timestamp);
const firstBlk = await c.getBlock({ blockNumber: from });
const deployTs = Number(firstBlk.timestamp);

const cache = new Map();
async function blockAt(ts) {
  if (cache.has(ts)) return cache.get(ts);
  let lo = from, hi = head;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const b = await c.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) < ts) lo = mid + 1n; else hi = mid;
  }
  cache.set(ts, Number(lo));
  return Number(lo);
}

const DAY = 86400, WEEK = 7 * DAY;
const spanDays = (now - deployTs) / DAY;
const nWeeks = Math.ceil((now - deployTs) / WEEK);

// Build week windows backwards from now so the final bucket is the current week.
const bounds = [];
for (let i = 0; i <= nWeeks; i++) bounds.push(now - i * WEEK);
bounds.reverse(); // oldest -> newest
const blocks = [];
for (const ts of bounds) blocks.push(ts <= deployTs ? Number(from) : await blockAt(ts));

const txs = d.txBlocks;
console.log(`contract live ${spanDays.toFixed(1)} days (${(spanDays / 7).toFixed(1)} weeks)`);
console.log(`total transactions: ${txs.length}\n`);
console.log("week ending (UTC)      blocks                    txs    tx/day");
console.log("-".repeat(66));
const rows = [];
for (let i = 0; i < bounds.length - 1; i++) {
  const [lo, hi] = [blocks[i], blocks[i + 1]];
  const n = txs.filter((b) => b >= lo && b < hi).length;
  const endTs = bounds[i + 1];
  const days = (endTs - Math.max(bounds[i], deployTs)) / DAY;
  rows.push({ weekEnding: new Date(endTs * 1000).toISOString().slice(0, 10), fromBlock: lo, toBlock: hi, txs: n, days: +days.toFixed(2) });
  console.log(`  ${new Date(endTs * 1000).toISOString().slice(0, 10)}        ${String(lo).padStart(8)}-${String(hi).padStart(8)}   ${String(n).padStart(5)}   ${(n / days).toFixed(0).padStart(6)}`);
}
// tail: anything at or after the last boundary (current partial period)
const tail = txs.filter((b) => b >= blocks[blocks.length - 1]).length;
if (tail) console.log(`  (at/after last boundary: ${tail})`);

const full = rows.filter((r) => r.days > 6.9);
const mean = full.reduce((a, r) => a + r.txs, 0) / full.length;
const last4 = full.slice(-4);
const last4mean = last4.reduce((a, r) => a + r.txs, 0) / last4.length;
console.log("-".repeat(66));
console.log(`all-time average      : ${(txs.length / (spanDays / 7)).toFixed(0)} tx/week  (${txs.length} txs over ${(spanDays / 7).toFixed(1)} weeks)`);
console.log(`mean of ${String(full.length).padStart(2)} full weeks  : ${mean.toFixed(0)} tx/week`);
console.log(`last 4 full weeks     : ${last4mean.toFixed(0)} tx/week`);
console.log(`most recent full week : ${full[full.length - 1].txs} txs`);
console.log(`peak week             : ${Math.max(...full.map((r) => r.txs))} txs`);

writeFileSync("scripts/out/weekly-rate.json", JSON.stringify({
  generatedAt: new Date().toISOString(), toBlock: d.toBlock, totalTransactions: txs.length,
  spanDays: +spanDays.toFixed(2), weeks: rows,
  allTimeAvgPerWeek: +(txs.length / (spanDays / 7)).toFixed(1),
  meanFullWeeks: +mean.toFixed(1), last4WeekMean: +last4mean.toFixed(1),
}, null, 2));
console.log("\nraw -> scripts/out/weekly-rate.json");
