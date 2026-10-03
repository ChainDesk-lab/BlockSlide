/**
 * Fresh scan of the last 30 days for DAU / WAU / MAU and daily+weekly tx counts.
 *
 * Scans to the CURRENT head (the full historical scan is minutes stale by the
 * time it finishes, which matters for a "last 24 hours" number). Same
 * repeat-and-union method; recent ranges are far more stable than archive
 * ranges but repeats cost little over a 30-day window.
 *
 * Window boundaries are resolved to exact blocks by binary search on
 * timestamps. "Transaction" = a tx that emitted >=1 Game2048 event.
 *
 * Usage: REPEATS=8 node scripts/recent-activity.mjs
 */
import { createPublicClient, http, getAddress } from "viem";
import { celo } from "viem/chains";
import { writeFileSync, mkdirSync } from "node:fs";

const ADDRESS = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const DEPLOY_BLOCK = 69_294_066n;
const MAX_RANGE = 5000n;
const REPEATS = Number(process.env.REPEATS ?? 8);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const ADDR_TOPIC = /^0x0{24}[0-9a-fA-F]{40}$/;

const c = createPublicClient({ chain: celo, transport: http("https://forno.celo.org", { timeout: 30_000 }) });
const head = await c.getBlockNumber();
const headBlk = await c.getBlock({ blockNumber: head });
const now = Number(headBlk.timestamp);

async function blockAt(ts) {
  let lo = DEPLOY_BLOCK, hi = head;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const b = await c.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) < ts) lo = mid + 1n; else hi = mid;
  }
  return lo;
}
const DAY = 86400;
const b1 = await blockAt(now - 1 * DAY);
const b7 = await blockAt(now - 7 * DAY);
const b30 = await blockAt(now - 30 * DAY);
console.log(`head ${head} @ ${new Date(now * 1000).toISOString()}`);
console.log(`  24h ago -> ${b1}\n   7d ago -> ${b7}\n  30d ago -> ${b30}\n`);

const chunks = [];
for (let b = b30; b <= head; b += MAX_RANGE) chunks.push([b, b + MAX_RANGE - 1n > head ? head : b + MAX_RANGE - 1n]);
console.log(`scanning ${chunks.length} chunks x ${REPEATS} repeats`);

const logsByKey = new Map();
let cursor = 0, done = 0, unstable = 0;
async function worker() {
  while (cursor < chunks.length) {
    const [from, to] = chunks[cursor++];
    const seen = new Map(); const sizes = [];
    for (let r = 0; r < REPEATS; r++) {
      let got = null;
      for (let a = 0; a < 5 && got === null; a++) {
        try { got = await c.getLogs({ address: ADDRESS, fromBlock: from, toBlock: to }); }
        catch { await new Promise((res) => setTimeout(res, 250 * 2 ** a)); }
      }
      if (got === null) continue;
      sizes.push(got.length);
      for (const l of got) seen.set(`${l.blockNumber}:${l.logIndex}`, l);
    }
    if (new Set(sizes).size > 1) unstable++;
    for (const [k, v] of seen) logsByKey.set(k, v);
    if (++done % 100 === 0 || done === chunks.length) process.stdout.write(`\r  ${done}/${chunks.length} chunks, ${logsByKey.size} logs, ${unstable} unstable`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("\n");

const win = (lo) => {
  const tx = new Set(), addrs = new Set();
  let logs = 0;
  for (const l of logsByKey.values()) {
    if (BigInt(l.blockNumber) < lo) continue;
    logs++;
    tx.add(l.transactionHash);
    const t1 = l.topics[1];
    if (t1 && ADDR_TOPIC.test(t1)) addrs.add(getAddress(`0x${t1.slice(26)}`).toLowerCase());
  }
  return { logs, txs: tx.size, wallets: addrs.size, addresses: [...addrs] };
};
const w1 = win(b1), w7 = win(b7), w30 = win(b30);

const fmt = (n) => String(n).padStart(6);
console.log("window        logs     txs   wallets");
console.log("-".repeat(38));
console.log(`last 24h  ${fmt(w1.logs)}  ${fmt(w1.txs)}  ${fmt(w1.wallets)}`);
console.log(`last  7d  ${fmt(w7.logs)}  ${fmt(w7.txs)}  ${fmt(w7.wallets)}`);
console.log(`last 30d  ${fmt(w30.logs)}  ${fmt(w30.txs)}  ${fmt(w30.wallets)}`);
console.log(`\nunstable chunks: ${unstable}/${chunks.length}`);

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/recent-activity.json", JSON.stringify({
  generatedAt: new Date().toISOString(), headBlock: head.toString(), headTime: new Date(now * 1000).toISOString(),
  repeats: REPEATS, unstableChunks: unstable, chunks: chunks.length,
  boundaries: { d1: b1.toString(), d7: b7.toString(), d30: b30.toString() },
  last24h: w1, last7d: w7, last30d: w30,
}, null, 2));
console.log("raw -> scripts/out/recent-activity.json");
