/**
 * Full verified stats scan for Game2048 on Celo mainnet.
 *
 * Same repeat-and-union method as scripts/count-users.mjs (public Celo RPCs
 * silently return [] on historical ranges, so a single pass undercounts ~30%).
 * Beyond unique addresses this also collects, per address, the blocks it was
 * active in, every unique transaction hash, and the G$ amounts carried in
 * event data — everything the demo-day numbers need, from one pass.
 *
 * Usage: REPEATS=10 CONCURRENCY=10 node scripts/demo-stats.mjs
 */
import { createPublicClient, http, getAddress, toEventSelector } from "viem";
import { celo } from "viem/chains";
import { writeFileSync, mkdirSync } from "node:fs";

const ADDRESS = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const DEPLOY_BLOCK = 69_294_066n;
const MAX_RANGE = 5000n;
const REPEATS = Number(process.env.REPEATS ?? 10);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);

// name, whether topic1 is the player, and the non-indexed data words we care
// about (index -> label). Data words are 32 bytes each, in declaration order.
const EVENTS = [
  { sig: "SessionStarted(address)", player: true },
  { sig: "ScoreSubmitted(address,uint256,uint32)", player: true },
  { sig: "RewardPaid(address,uint32,uint256)", player: true, gDollar: { word: 1, kind: "reward" } },
  { sig: "XpEarned(address,uint256,uint256)", player: true },
  { sig: "StreakUpdated(address,uint256)", player: true },
  { sig: "UsernameSet(address,string)", player: true },
  { sig: "ReferrerSet(address,address)", player: true },
  // legacy shapes (pre-V6): no pricePaid carried
  { sig: "ShieldPurchased(address,uint256)", player: true },
  { sig: "XpBoostPurchased(address,uint8,uint64)", player: true },
  { sig: "ShopPricesUpdated(uint256,uint256,uint256)", player: false },
  // V6 shapes: pricePaid is the last data word
  { sig: "ShieldPurchased(address,uint256,uint256)", player: true, gDollar: { word: 1, kind: "spend" } },
  { sig: "XpBoostPurchased(address,uint8,uint64,uint256)", player: true, gDollar: { word: 2, kind: "spend" } },
  { sig: "UndoPurchased(address,uint256,uint256)", player: true, gDollar: { word: 1, kind: "spend" } },
  { sig: "UndoConsumed(address)", player: true },
  { sig: "CosmeticPurchased(address,uint256,uint256)", player: true, gDollar: { word: 0, kind: "spend" } },
  { sig: "ShopPricesUpdated(uint256,uint256,uint256,uint256)", player: false },
  { sig: "CosmeticCatalogUpdated(uint256,uint256,bool)", player: false },
  // admin / proxy
  { sig: "Upgraded(address)", player: false },
  { sig: "OwnershipTransferred(address,address)", player: false },
  { sig: "Initialized(uint64)", player: false },
  { sig: "TokensUpdated(address,address)", player: false },
];

const label = new Map();
for (const e of EVENTS) label.set(toEventSelector(`event ${e.sig}`), { ...e, name: e.sig.split("(")[0] });

const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org", { timeout: 30_000 }) });
const head = process.env.TO_BLOCK ? BigInt(process.env.TO_BLOCK) : await client.getBlockNumber();

const chunks = [];
for (let b = DEPLOY_BLOCK; b <= head; b += MAX_RANGE) {
  chunks.push([b, b + MAX_RANGE - 1n > head ? head : b + MAX_RANGE - 1n]);
}
console.log(`scanning ${ADDRESS}`);
console.log(`blocks ${DEPLOY_BLOCK} -> ${head}, ${chunks.length} chunks x ${REPEATS} repeats\n`);

const perEvent = new Map();          // event -> Set(address)
const activity = new Map();          // address -> Set(block as Number)
const txHashes = new Set();
const txBlock = new Map();   // tx hash -> block, for time-bucketing
const topicHist = new Map();
const unknownTopics = new Map();
let rewardWei = 0n, spendWei = 0n, rewardCount = 0, spendCount = 0;
let totalLogs = 0, done = 0, unstable = 0;
const ADDR_TOPIC = /^0x0{24}[0-9a-fA-F]{40}$/;
const word = (data, i) => BigInt("0x" + data.slice(2 + i * 64, 2 + (i + 1) * 64));

let cursor = 0;
async function worker() {
  while (cursor < chunks.length) {
    const [from, to] = chunks[cursor++];
    const seen = new Map();
    const sizes = [];
    for (let r = 0; r < REPEATS; r++) {
      let logs = null;
      for (let a = 0; a < 5 && logs === null; a++) {
        try { logs = await client.getLogs({ address: ADDRESS, fromBlock: from, toBlock: to }); }
        catch { await new Promise((res) => setTimeout(res, 300 * 2 ** a)); }
      }
      if (logs === null) continue;
      sizes.push(logs.length);
      for (const l of logs) seen.set(`${l.blockNumber}:${l.logIndex}`, l);
    }
    if (new Set(sizes).size > 1) unstable++;

    for (const log of seen.values()) {
      totalLogs++;
      txHashes.add(log.transactionHash);
      txBlock.set(log.transactionHash, Number(log.blockNumber));
      const t0 = log.topics[0];
      topicHist.set(t0, (topicHist.get(t0) ?? 0) + 1);
      const meta = label.get(t0);
      if (!meta) { unknownTopics.set(t0, (unknownTopics.get(t0) ?? 0) + 1); continue; }

      if (meta.gDollar && log.data && log.data.length >= 2 + (meta.gDollar.word + 1) * 64) {
        const v = word(log.data, meta.gDollar.word);
        if (meta.gDollar.kind === "reward") { rewardWei += v; rewardCount++; }
        else { spendWei += v; spendCount++; }
      }

      if (!meta.player) continue;
      const t1 = log.topics[1];
      if (!t1 || !ADDR_TOPIC.test(t1)) continue;
      const addr = getAddress(`0x${t1.slice(26)}`);
      if (!perEvent.has(meta.name)) perEvent.set(meta.name, new Set());
      perEvent.get(meta.name).add(addr);
      if (!activity.has(addr)) activity.set(addr, new Set());
      activity.get(addr).add(Number(log.blockNumber));
    }
    if (++done % 200 === 0 || done === chunks.length) {
      process.stdout.write(`\r  ${done}/${chunks.length} chunks, ${totalLogs} logs, ${activity.size} addrs, ${unstable} unstable`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("\n");

const rows = [...perEvent.entries()].sort((a, b) => b[1].size - a[1].size);
for (const [n, s] of rows) console.log(`  ${n.padEnd(24)} ${String(s.size).padStart(5)}`);
console.log(`  ${"UNION".padEnd(24)} ${String(activity.size).padStart(5)}`);
console.log(`\nunique transactions : ${txHashes.size}`);
console.log(`total event logs    : ${totalLogs}`);
console.log(`RewardPaid  : ${rewardCount} events, ${(Number(rewardWei) / 1e18).toFixed(2)} G$`);
console.log(`Shop spend  : ${spendCount} events, ${(Number(spendWei) / 1e18).toFixed(2)} G$`);
if (unknownTopics.size) for (const [t, n] of unknownTopics) console.log(`UNKNOWN ${t} x${n}`);

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/demo-stats.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  fromBlock: DEPLOY_BLOCK.toString(), toBlock: head.toString(),
  repeats: REPEATS, unstableChunks: unstable,
  totalLogs, uniqueTransactions: txHashes.size,
  txBlocks: [...txBlock.values()].sort((a, b) => a - b),
  rewardPaidWei: rewardWei.toString(), rewardPaidEvents: rewardCount,
  shopSpendWei: spendWei.toString(), shopSpendEvents: spendCount,
  counts: Object.fromEntries(rows.map(([n, s]) => [n, s.size])),
  union: activity.size,
  addressesByEvent: Object.fromEntries(rows.map(([n, s]) => [n, [...s]])),
  activity: Object.fromEntries([...activity].map(([a, s]) => [a, [...s].sort((x, y) => x - y)])),
}, null, 2));
console.log("\nraw -> scripts/out/demo-stats.json");
