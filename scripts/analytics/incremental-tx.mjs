/**
 * Brings the verified transaction count current without re-scanning history.
 *
 * A transaction cannot span blocks, so any tx found above the baseline's
 * toBlock is necessarily distinct from the baseline set — the counts simply
 * add. Same repeat-and-union read method; recent ranges are more stable than
 * archive ranges but repeats still cost little over a short window.
 */
import { createPublicClient, http, getAddress } from "viem";
import { celo } from "viem/chains";
import { readFileSync } from "node:fs";

const ADDRESS = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const MAX_RANGE = 5000n;
const REPEATS = Number(process.env.REPEATS ?? 8);
const base = JSON.parse(readFileSync("scripts/out/demo-stats.json", "utf8"));
const baseTo = BigInt(base.toBlock);

const c = createPublicClient({ chain: celo, transport: http("https://forno.celo.org", { timeout: 30_000 }) });
const head = await c.getBlockNumber();
const from = baseTo + 1n;
console.log(`baseline : ${base.uniqueTransactions} txs through block ${baseTo}`);
console.log(`scanning : ${from} -> ${head}  (${head - from} blocks)\n`);

const chunks = [];
for (let b = from; b <= head; b += MAX_RANGE) chunks.push([b, b + MAX_RANGE - 1n > head ? head : b + MAX_RANGE - 1n]);

const seen = new Map();
let unstable = 0;
for (const [f, t] of chunks) {
  const local = new Map(); const sizes = [];
  for (let r = 0; r < REPEATS; r++) {
    let got = null;
    for (let a = 0; a < 5 && got === null; a++) {
      try { got = await c.getLogs({ address: ADDRESS, fromBlock: f, toBlock: t }); }
      catch { await new Promise((res) => setTimeout(res, 250 * 2 ** a)); }
    }
    if (got === null) continue;
    sizes.push(got.length);
    for (const l of got) local.set(`${l.blockNumber}:${l.logIndex}`, l);
  }
  if (new Set(sizes).size > 1) unstable++;
  for (const [k, v] of local) seen.set(k, v);
}
const txs = new Set(), wallets = new Set();
const ADDR = /^0x0{24}[0-9a-fA-F]{40}$/;
for (const l of seen.values()) {
  txs.add(l.transactionHash);
  if (l.topics[1] && ADDR.test(l.topics[1])) wallets.add(l.topics[1].slice(26).toLowerCase());
}
console.log(`new since baseline : ${seen.size} logs, ${txs.size} txs, ${wallets.size} distinct wallets`);
console.log(`unstable chunks    : ${unstable}/${chunks.length}`);
console.log(`\nTOTAL TRANSACTIONS : ${base.uniqueTransactions + txs.size}  (through block ${head})`);
