/**
 * Authoritative unique-player count for BlockSlide, read straight from Celo
 * mainnet logs. No subgraph, no Dune, no cache.
 *
 * Single pass over every log emitted by the Game2048 proxy from its deployment
 * block to chain head. For each log it records:
 *   - a full topic0 histogram (so no event type can be silently missed)
 *   - the decoded player address for every known player-bearing event
 *   - every address-shaped indexed topic, whether or not the event is known
 *     (the "appears in any contract interaction at all" superset)
 *
 * Chunk failures are counted and reported; a non-zero failure count means the
 * result is incomplete and must not be trusted.
 *
 * Usage:  node scripts/count-users.mjs
 * Output: console report + scripts/out/user-count.json
 */
import { createPublicClient, http, getAddress, toEventSelector } from "viem";
import { celo } from "viem/chains";
import { writeFileSync, mkdirSync } from "node:fs";

const ADDRESS = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const DEPLOY_BLOCK = 69_294_066n; // verified by binary search on getBytecode
const MAX_RANGE = 5000n; // forno hard limit: "max block range 5000"
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 12);
const RPCS = (process.env.RPCS ?? "https://forno.celo.org").split(",");

// Player-bearing events, from contracts/Game2048.sol + Game2048_ABI.json.
const PLAYER_EVENTS = [
  "SessionStarted(address)",
  "ScoreSubmitted(address,uint256,uint32)",
  "RewardPaid(address,uint32,uint256)",
  "XpEarned(address,uint256,uint256)",
  "StreakUpdated(address,uint256)",
  "ShieldPurchased(address,uint256)",
  "XpBoostPurchased(address,uint8,uint64)",
  // The proxy has been upgraded repeatedly and older/newer event shapes both
  // appear on-chain. Both variants must be counted.
  "XpBoostPurchased(address,uint8,uint64,uint256)",
  "ShieldPurchased(address,uint256,uint256)",
  "UndoPurchased(address,uint256,uint256)",
  "UndoConsumed(address)",
  "CosmeticPurchased(address,uint256,uint256)",
  "UsernameSet(address,string)",
  "ReferrerSet(address,address)",
];
// Non-player events, listed so they show up as "known" in the histogram.
const OTHER_EVENTS = [
  "ShopPricesUpdated(uint256,uint256,uint256)",
  "TokensUpdated(address,address)",
  "Upgraded(address)",
  "OwnershipTransferred(address,address)",
  "Initialized(uint64)",
  "AdminChanged(address,address)",
];

const label = new Map();
for (const s of PLAYER_EVENTS) label.set(toEventSelector(`event ${s}`), { name: s.split("(")[0], player: true });
for (const s of OTHER_EVENTS) label.set(toEventSelector(`event ${s}`), { name: s.split("(")[0], player: false });

const clients = RPCS.map((url) =>
  createPublicClient({ chain: celo, transport: http(url, { timeout: 30_000 }) })
);

const head = process.env.TO_BLOCK ? BigInt(process.env.TO_BLOCK) : await clients[0].getBlockNumber();
const chunks = [];
for (let b = DEPLOY_BLOCK; b <= head; b += MAX_RANGE) {
  chunks.push([b, b + MAX_RANGE - 1n > head ? head : b + MAX_RANGE - 1n]);
}

console.log(`contract    : ${ADDRESS}`);
console.log(`block range : ${DEPLOY_BLOCK} -> ${head}  (${head - DEPLOY_BLOCK} blocks)`);
console.log(`chunks      : ${chunks.length} x ${MAX_RANGE} blocks, concurrency ${CONCURRENCY}\n`);

const perEvent = new Map();      // event name -> Set(address)
const topicHist = new Map();     // topic0 -> count
const knownPlayers = new Set();  // union over known player events
const anyAddress = new Set();    // any address-shaped indexed topic, any event
const failures = [];
let totalLogs = 0;
let done = 0;

const ADDR_TOPIC = /^0x0{24}[0-9a-fA-F]{40}$/;

let cursor = 0;
// forno is a load-balanced pool and some nodes hold incomplete archive data:
// on historical ranges they silently return [] instead of erroring (measured
// ~27% false-empty on a known-1-log chunk). A single pass therefore undercounts
// at random. We read each chunk REPEATS times and union the logs by identity.
// The failure mode is only ever a MISSING log, never a fabricated one, so the
// union converges upward to the true set.
const REPEATS = Number(process.env.REPEATS ?? 4);
let unstableChunks = 0;

async function readChunk(from, to) {
  const seen = new Map(); // `${blockNumber}:${logIndex}` -> log
  const sizes = [];
  for (let rep = 0; rep < REPEATS; rep++) {
    let logs = null;
    for (let attempt = 0; attempt < 6 && logs === null; attempt++) {
      try {
        logs = await clients[(rep + attempt) % clients.length].getLogs({ address: ADDRESS, fromBlock: from, toBlock: to });
      } catch (err) {
        if (attempt === 5) failures.push({ from: from.toString(), to: to.toString(), err: err.shortMessage || err.message });
        else await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
    if (logs === null) continue;
    sizes.push(logs.length);
    for (const l of logs) seen.set(`${l.blockNumber}:${l.logIndex}`, l);
  }
  if (new Set(sizes).size > 1) unstableChunks++;
  return [...seen.values()];
}

async function worker() {
  while (cursor < chunks.length) {
    const [from, to] = chunks[cursor++];
    const logs = await readChunk(from, to);

    totalLogs += logs.length;
    for (const log of logs) {
      const t0 = log.topics[0];
      topicHist.set(t0, (topicHist.get(t0) ?? 0) + 1);

      for (const t of log.topics.slice(1)) {
        if (ADDR_TOPIC.test(t)) anyAddress.add(getAddress(`0x${t.slice(26)}`));
      }

      const meta = label.get(t0);
      if (!meta?.player) continue;
      const t1 = log.topics[1];
      if (!t1 || !ADDR_TOPIC.test(t1)) continue;
      const addr = getAddress(`0x${t1.slice(26)}`);
      if (!perEvent.has(meta.name)) perEvent.set(meta.name, new Set());
      perEvent.get(meta.name).add(addr);
      knownPlayers.add(addr);
    }
    if (++done % 200 === 0 || done === chunks.length) {
      process.stdout.write(`\r  scanned ${done}/${chunks.length} chunks, ${totalLogs} logs, ${unstableChunks} unstable`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("\n");

if (failures.length) {
  console.log(`!! ${failures.length} chunks FAILED after retries — result is INCOMPLETE`);
  for (const f of failures.slice(0, 5)) console.log(`   ${f.from}-${f.to}: ${f.err}`);
  console.log();
}

const rows = [...perEvent.entries()].sort((a, b) => b[1].size - a[1].size);
console.log("unique addresses per event");
console.log("-".repeat(56));
for (const [name, set] of rows) console.log(`  ${name.padEnd(22)} ${String(set.size).padStart(6)}`);
console.log("-".repeat(56));
console.log(`  ${"UNION (player events)".padEnd(22)} ${String(knownPlayers.size).padStart(6)}`);
console.log(`  ${"ANY indexed address".padEnd(22)} ${String(anyAddress.size).padStart(6)}   <- superset`);
console.log(`\nchunks whose repeated reads disagreed: ${unstableChunks} of ${chunks.length}`);

console.log(`\ntopic0 histogram (${topicHist.size} distinct, ${totalLogs} logs)`);
console.log("-".repeat(56));
for (const [t, n] of [...topicHist.entries()].sort((a, b) => b[1] - a[1])) {
  const meta = label.get(t);
  console.log(`  ${String(n).padStart(5)}  ${meta ? meta.name + (meta.player ? " (player)" : "") : `UNKNOWN ${t}`}`);
}

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/user-count.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  contract: ADDRESS,
  fromBlock: DEPLOY_BLOCK.toString(),
  toBlock: head.toString(),
  chunksFailed: failures.length,
  unstableChunks,
  repeats: REPEATS,
  totalLogs,
  counts: Object.fromEntries(rows.map(([n, s]) => [n, s.size])),
  unionPlayerEvents: knownPlayers.size,
  anyIndexedAddress: anyAddress.size,
  topicHistogram: Object.fromEntries([...topicHist].map(([t, n]) => [label.get(t)?.name ?? t, n])),
  addressesByEvent: Object.fromEntries(rows.map(([n, s]) => [n, [...s]])),
  unionAddresses: [...knownPlayers],
  anyIndexedAddresses: [...anyAddress],
}, null, 2));
console.log("\nraw output -> scripts/out/user-count.json");
