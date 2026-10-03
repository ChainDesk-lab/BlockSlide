/**
 * ALL transactions sent to the Game2048 contract since deployment — including
 * reverted ones and any that emitted no events.
 *
 * A log scan (scripts/demo-stats.mjs) can only see transactions that emitted at
 * least one event, so it structurally undercounts. This walks Blockscout's
 * transaction index instead, which records every transaction regardless of
 * outcome. Blockscout v2 needs no API key; Celoscan/Etherscan v2 does.
 *
 * Cross-check: the "ok" subset here should be >= the log-scan count, since a
 * successful transaction may still emit no events.
 *
 * Usage: node scripts/all-transactions.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";

const ADDRESS = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";
const DEPLOY_BLOCK = 69_294_066;
const BASE = `https://celo.blockscout.com/api/v2/addresses/${ADDRESS}/transactions`;

async function getPage(params) {
  const qs = new URLSearchParams({ filter: "to", ...params }).toString();
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await fetch(`${BASE}?${qs}`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt === 5) throw new Error(`page failed: ${e.message}`);
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
    }
  }
}

const byStatus = new Map();
const byMethod = new Map();
const revertReasons = new Map();
const failByMethod = new Map();   // method -> failures, to show WHERE users fail
const okByMethod = new Map();
const hashes = new Set();
let minBlock = Infinity, maxBlock = 0, pages = 0;
let params = {};

while (true) {
  const j = await getPage(params);
  const items = j.items ?? [];
  if (!items.length) break;
  for (const it of items) {
    if (hashes.has(it.hash)) continue;       // guard against pagination overlap
    hashes.add(it.hash);
    const st = it.status ?? "unknown";
    byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
    const m = it.method ?? "(none)";
    byMethod.set(m, (byMethod.get(m) ?? 0) + 1);
    if (st === "ok") okByMethod.set(m, (okByMethod.get(m) ?? 0) + 1);
    else failByMethod.set(m, (failByMethod.get(m) ?? 0) + 1);
    if (st !== "ok") {
      const rr = it.revert_reason?.raw ?? it.revert_reason ?? it.result ?? "(unspecified)";
      const key = typeof rr === "string" ? rr.slice(0, 60) : JSON.stringify(rr).slice(0, 60);
      revertReasons.set(key, (revertReasons.get(key) ?? 0) + 1);
    }
    if (it.block_number < minBlock) minBlock = it.block_number;
    if (it.block_number > maxBlock) maxBlock = it.block_number;
  }
  pages++;
  process.stdout.write(`\r  page ${pages}, ${hashes.size} txs, down to block ${minBlock}`);
  if (!j.next_page_params) break;
  params = Object.fromEntries(Object.entries(j.next_page_params).map(([k, v]) => [k, String(v)]));
}
console.log("\n");

const total = hashes.size;
console.log(`TOTAL transactions to contract : ${total}`);
console.log(`block range covered            : ${minBlock} -> ${maxBlock}`);
console.log(`reached deployment block?      : ${minBlock <= DEPLOY_BLOCK + 50_000 ? "yes" : `NO — stopped at ${minBlock}`}`);
console.log(`\nby status`);
for (const [k, v] of [...byStatus].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(6)}  ${(v / total * 100).toFixed(1)}%`);
}
console.log(`\ntop methods`);
for (const [k, v] of [...byMethod].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(k).padEnd(24)} ${String(v).padStart(6)}`);
}
if (revertReasons.size) {
  console.log(`\nfailure reasons`);
  for (const [k, v] of [...revertReasons].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
}

console.log(`\nfailure rate by method`);
const allM = new Set([...okByMethod.keys(), ...failByMethod.keys()]);
const rowsM = [...allM].map((m) => ({ m, ok: okByMethod.get(m) ?? 0, bad: failByMethod.get(m) ?? 0 }))
  .filter((r) => r.ok + r.bad >= 5).sort((a, b) => b.bad - a.bad);
for (const r of rowsM) {
  const t = r.ok + r.bad;
  console.log(`  ${String(r.m).padEnd(20)} ${String(r.bad).padStart(5)} failed / ${String(t).padStart(5)} total  ${(r.bad / t * 100).toFixed(1)}%`);
}

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/all-transactions.json", JSON.stringify({
  generatedAt: new Date().toISOString(), source: "blockscout v2 (celo.blockscout.com)",
  contract: ADDRESS, pages, total,
  minBlock, maxBlock,
  byStatus: Object.fromEntries(byStatus),
  byMethod: Object.fromEntries(byMethod),
  okByMethod: Object.fromEntries(okByMethod),
  failByMethod: Object.fromEntries(failByMethod),
  failureReasons: Object.fromEntries(revertReasons),
}, null, 2));
console.log("\nraw -> scripts/out/all-transactions.json");
