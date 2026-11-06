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
 * Blockscout's newest blocks can still be filling in. Seeding to the newest log it returns and
 * checkpointing there left a permanent hole once (25 Sep 2026: 196 logs never counted, found by
 * a full RPC re-scan on 3 Nov 2026), because the incremental scan only ever reads ABOVE the
 * checkpoint. So the seed stops SAFETY_MARGIN blocks below the newest log Blockscout returns and
 * leaves the rest to /api/stats, which re-reads that stretch from RPC.
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6390/1 node scripts/analytics/seed-stats.mjs
 *   REDIS_URL=... node scripts/analytics/seed-stats.mjs --dry-run
 *   REDIS_URL=... node scripts/analytics/seed-stats.mjs --replace
 *
 * Only a Redis on this machine is written to by default. Writing anywhere else (for example
 * reseeding production) needs --allow-remote, so a stray production REDIS_URL in the shell
 * can't be overwritten by accident.
 *
 * An existing aggregate is never overwritten unless --replace is passed. With --replace, the
 * existing value is first saved to a local file, stats-state-backup-<time>.json in the current
 * directory (it holds only public on-chain data; don't commit it).
 *
 * Recovery. /api/stats never rebuilds the aggregate itself. If it answers:
 *   stats_unavailable                   Redis can't be reached or the read failed. Transient:
 *                                       fix Redis; do NOT reseed. The stored value is untouched.
 *   stats_unseeded                      The key is missing (never seeded, deleted, or evicted).
 *                                       Run this script.
 *   stats_malformed /                   The key holds something this code can't use. It is left
 *   stats_unsupported_version           in place. Find out why (e.g. a rollback across a
 *                                       STATE_VERSION change: redeploying the matching code is
 *                                       the fix, not a reseed). Otherwise reseed with --replace.
 * Run with --dry-run first and check its counts against the page before writing.
 *
 * A reseed rebuilds the all-time totals, wallets, weekly charts and daily event counts. It does
 * not rebuild the optional fields the live scan adds (per-day sessions/games/active wallets,
 * the recent-events feed and the season XP tally): those restart from the new checkpoint, and
 * the page shows earlier days' detail as unknown. The seeded checkpoint is SAFETY_MARGIN blocks
 * behind, so the page catches up over the next few refreshes.
 */
import { writeFileSync } from "node:fs";
import { getAddress, toEventSelector } from "viem";

const GAME = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const GENESIS_BLOCK = 69_294_066;
const ANCHOR_BLOCK = 78_384_272;
const ANCHOR_TIME = Date.parse("2026-09-24T21:23:50Z") / 1000;
const MONDAY_EPOCH = 345_600;
const WEEK = 604_800;
const STATE_KEY = "stats:v1:state";
const LOCK_KEY = "stats:v1:lock";
/** Must equal STATE_VERSION in frontend/src/lib/stats/state.ts, or the app refuses the value. */
const STATE_VERSION = 1;
/** ~14 hours of Celo blocks; logs above (newest log - margin) are left to the incremental scan. */
const SAFETY_MARGIN = 50_000;
const DRY = process.argv.includes("--dry-run");
const REPLACE = process.argv.includes("--replace");

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
  version: STATE_VERSION,
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
const collected = [];

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
    if (log.block_number > maxBlock) maxBlock = log.block_number;
    collected.push(log);
  }
  pages += 1;
  if (pages % 25 === 0) process.stdout.write(`\r  ${pages} pages, ${collected.length} logs`);
  if (!json.next_page_params) break;
  params = json.next_page_params;
}

const cutoff = maxBlock - SAFETY_MARGIN;
for (const log of collected) {
  {
    const t0 = log.topics?.[0];
    if (!t0) continue;
    const block = log.block_number;
    if (block > cutoff) continue; // re-read by the incremental RPC scan
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
}

state.checkpointBlock = cutoff;
state.updatedAt = new Date().toISOString();

const distinct = (name) => {
  const bit = PLAYER_EVENT_SIGS.findIndex(([n]) => n === name);
  return Object.values(state.addrs).filter((r) => r[4] & (1 << bit)).length;
};
console.log(`\n\npages              : ${pages}`);
console.log(`total logs         : ${state.totalLogs}`);
console.log(`newest log seen    : ${maxBlock}`);
console.log(`checkpoint block   : ${state.checkpointBlock} (newest - ${SAFETY_MARGIN}; the rest is re-read from RPC)`);
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
{
  let host = "";
  try { host = new URL(process.env.REDIS_URL).hostname; } catch { /* unparseable: treated as remote */ }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!local && !process.argv.includes("--allow-remote")) {
    console.error(`\nREDIS_URL points at "${host || "an unparseable host"}", not this machine — refusing to write. Pass --allow-remote only if that is really intended.`);
    process.exit(1);
  }
}

// `redis` is a frontend dependency; resolve it from there so this script can
// run from the repo root without a duplicate install.
let createClient;
try {
  ({ createClient } = await import("redis"));
} catch {
  ({ createClient } = await import(new URL("../../frontend/node_modules/redis/dist/index.js", import.meta.url).href));
}
const client = createClient({ url: process.env.REDIS_URL });
client.on("error", (e) => console.error("redis:", e.message));
await client.connect();

// Hold the refresh lock while checking and writing, so a scan in flight can't save between the
// two. (A scan's save also refuses once the stored value has changed under it.)
const lockToken = `seed-stats ${process.pid} ${Date.now()}`;
if ((await client.set(LOCK_KEY, lockToken, { NX: true, EX: 120 })) !== "OK") {
  console.error("\nA stats refresh holds the lock right now; nothing written. Try again in a couple of minutes.");
  await client.quit();
  process.exit(1);
}
try {
  const existing = await client.get(STATE_KEY);
  if (existing !== null) {
    if (!REPLACE) {
      console.error(`\n${STATE_KEY} already holds an aggregate (${(existing.length / 1024).toFixed(0)} KB); nothing written. Pass --replace to back it up and overwrite it.`);
      process.exitCode = 1;
    } else {
      const backup = `stats-state-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      writeFileSync(backup, existing, { flag: "wx" }); // never overwrites an earlier backup
      console.log(`\nbacked up the existing value to ${backup}`);
    }
  }
  if (existing === null || REPLACE) {
    const payload = JSON.stringify(state);
    await client.set(STATE_KEY, payload);
    if ((await client.get(STATE_KEY)) !== payload) throw new Error(`read-back of ${STATE_KEY} did not match what was written`);
    console.log(`\nwrote ${STATE_KEY}`);
  }
} finally {
  if ((await client.get(LOCK_KEY)) === lockToken) await client.del(LOCK_KEY);
  await client.quit();
}
