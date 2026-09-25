/**
 * Seeds the /stats aggregate in Redis with full contract history.
 *
 * Reads every log from Blockscout's archive index rather than an RPC pool.
 * Blockscout serves from its own indexed database, so it does not exhibit the
 * silent-empty-getLogs behaviour of Celo's public RPC nodes; a scan of the same
 * range via repeat-and-union RPC reads produced byte-identical counts
 * (13,884 logs, 676 player wallets, 588 usernames) on 24 Sep 2026.
 *
 * Run once to bootstrap. After that /api/stats keeps itself current
 * incrementally, and this only needs re-running to rebuild from scratch.
 *
 * Usage:
 *   REDIS_URL=... node scripts/seed-stats.mjs
 *   REDIS_URL=... node scripts/seed-stats.mjs --dry-run
 */
import { getAddress, toEventSelector } from "viem";

const GAME = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const GENESIS_BLOCK = 69_294_066;
const ANCHOR_BLOCK = 78_384_272;
const ANCHOR_TIME = Date.parse("2026-09-24T21:23:50Z") / 1000;
const MONDAY_EPOCH = 345_600;
const WEEK = 604_800;
const STATE_KEY = "stats:v1:state";
const DRY = process.argv.includes("--dry-run");

const blockToUnix = (b) => ANCHOR_TIME + (b - ANCHOR_BLOCK);
const weekIndexOf = (u) => Math.floor((u - MONDAY_EPOCH) / WEEK);
const BASE_WEEK = weekIndexOf(blockToUnix(GENESIS_BLOCK));

// Must stay in lockstep with frontend/src/lib/stats/config.ts
const PLAYER_EVENT_SIGS = [
  ["UsernameSet", ["UsernameSet(address,string)"]],
  ["SessionStarted", ["SessionStarted(address)"]],
  ["ScoreSubmitted", ["ScoreSubmitted(address,uint256,uint32)"]],
  ["XpEarned", ["XpEarned(address,uint256,uint256)"]],
  ["StreakUpdated", ["StreakUpdated(address,uint256)"]],
  ["RewardPaid", ["RewardPaid(address,uint32,uint256)"]],
  ["XpBoostPurchased", ["XpBoostPurchased(address,uint8,uint64)", "XpBoostPurchased(address,uint8,uint64,uint256)"]],
  ["ShieldPurchased", ["ShieldPurchased(address,uint256)", "ShieldPurchased(address,uint256,uint256)"]],
  ["UndoPurchased", ["UndoPurchased(address,uint256,uint256)"]],
  ["UndoConsumed", ["UndoConsumed(address)"]],
  ["CosmeticPurchased", ["CosmeticPurchased(address,uint256,uint256)"]],
  ["ReferrerSet", ["ReferrerSet(address,address)"]],
];
const TOPIC = {};
PLAYER_EVENT_SIGS.forEach(([name, sigs], bit) => {
  for (const s of sigs) TOPIC[toEventSelector(`event ${s}`)] = { name, bit };
});
const ADDRESS_TOPIC = /^0x0{24}[0-9a-fA-F]{40}$/;

const state = {
  version: 1,
  genesisBlock: GENESIS_BLOCK,
  checkpointBlock: GENESIS_BLOCK - 1,
  updatedAt: new Date().toISOString(),
  totalLogs: 0,
  eventCounts: {},
  addrs: {},
  dailyEvents: {},
  rewardPaidWei: "0",
};

const setBit = (hex, bit) => (BigInt("0x" + (hex || "0")) | (1n << BigInt(bit))).toString(16);

const BASE = `https://celo.blockscout.com/api/v2/addresses/${GAME}/logs`;
let params = null, pages = 0, maxBlock = 0;

console.log(`seeding from Blockscout archive index: ${GAME}`);
while (true) {
  const url = params ? `${BASE}?${new URLSearchParams(params)}` : BASE;
  let json = null;
  for (let a = 0; a < 6 && !json; a++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      json = await r.json();
    } catch (err) {
      if (a === 5) { console.error("FAILED:", err.message); process.exit(1); }
      await new Promise((r) => setTimeout(r, 500 * 2 ** a));
    }
  }
  for (const log of json.items ?? []) {
    const t0 = log.topics?.[0];
    if (!t0) continue;
    const block = log.block_number;
    if (block > maxBlock) maxBlock = block;
    state.totalLogs += 1;

    const unix = blockToUnix(block);
    const day = new Date(unix * 1000).toISOString().slice(0, 10);
    state.dailyEvents[day] = (state.dailyEvents[day] ?? 0) + 1;

    const meta = TOPIC[t0];
    if (!meta) continue;
    state.eventCounts[meta.name] = (state.eventCounts[meta.name] ?? 0) + 1;

    const t1 = log.topics?.[1];
    if (!t1 || !ADDRESS_TOPIC.test(t1)) continue;
    const addr = ("0x" + t1.slice(26)).toLowerCase();
    if (meta.name === "RewardPaid" && log.data && log.data.length >= 2 + 128) {
      const amount = BigInt("0x" + log.data.slice(2 + 64, 2 + 128));
      state.rewardPaidWei = (BigInt(state.rewardPaidWei) + amount).toString();
    }

    const week = weekIndexOf(unix) - BASE_WEEK;
    const isGame = meta.name === "ScoreSubmitted";

    const row = state.addrs[addr];
    if (!row) {
      state.addrs[addr] = [block, block, 1, isGame ? 1 : 0, 1 << meta.bit, setBit("0", week)];
    } else {
      if (block < row[0]) row[0] = block;
      if (block > row[1]) row[1] = block;
      row[2] += 1;
      if (isGame) row[3] += 1;
      row[4] |= 1 << meta.bit;
      row[5] = setBit(row[5], week);
    }
  }
  pages += 1;
  if (pages % 25 === 0) process.stdout.write(`\r  ${pages} pages, ${state.totalLogs} logs`);
  if (!json.next_page_params) break;
  params = json.next_page_params;
}

state.checkpointBlock = maxBlock;
state.updatedAt = new Date().toISOString();

const distinct = (name) => {
  const bit = PLAYER_EVENT_SIGS.findIndex(([n]) => n === name);
  return Object.values(state.addrs).filter((r) => r[4] & (1 << bit)).length;
};
console.log(`\n\npages              : ${pages}`);
console.log(`total logs         : ${state.totalLogs}`);
console.log(`checkpoint block   : ${state.checkpointBlock}`);
console.log(`player wallets     : ${Object.keys(state.addrs).length}`);
console.log(`  set a username   : ${distinct("UsernameSet")}`);
console.log(`  started session  : ${distinct("SessionStarted")}`);
console.log(`  completed a game : ${distinct("ScoreSubmitted")}`);
console.log(`  earned a reward  : ${distinct("RewardPaid")}`);
console.log(`games completed    : ${state.eventCounts.ScoreSubmitted ?? 0}`);
console.log(`G$ paid to players : ${Number(BigInt(state.rewardPaidWei) / 10n ** 16n) / 100}`);
console.log(`payload size       : ${(JSON.stringify(state).length / 1024).toFixed(0)} KB`);

if (DRY) { console.log("\n--dry-run: nothing written"); process.exit(0); }
if (!process.env.REDIS_URL) { console.error("\nREDIS_URL not set — refusing to write"); process.exit(1); }

// `redis` is a frontend dependency; resolve it from there so this script can
// run from the repo root without a duplicate install.
let createClient;
try {
  ({ createClient } = await import("redis"));
} catch {
  ({ createClient } = await import(new URL("../frontend/node_modules/redis/dist/index.js", import.meta.url).href));
}
const client = createClient({ url: process.env.REDIS_URL });
client.on("error", (e) => console.error("redis:", e.message));
await client.connect();
await client.set(STATE_KEY, JSON.stringify(state));
await client.quit();
console.log(`\nwrote ${STATE_KEY}`);
