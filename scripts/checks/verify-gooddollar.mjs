/**
 * Cross-references wallets against the GoodDollar Identity contract.
 *
 * The subgraph's `isVerified` flag is NOT this — it is set by handleXpEarned and
 * only means "has earned XP". This reads the identity contract directly:
 *   isWhitelisted(address)     -> currently verified (GoodDollar whitelist expires)
 *   lastAuthenticated(address) -> unix ts of last face verification, 0 if never
 *
 * Individual eth_calls, not multicall3 (multicall reverts against this contract).
 * Reads at `latest` deliberately: pinning blockNumber forces an archive state
 * read, which forno's pruned nodes fail ~99% of the time (518/519 measured).
 *
 * Usage: node scripts/verify-gooddollar.mjs [addressesFile.json]
 */
import { createPublicClient, http, getAddress } from "viem";
import { celo } from "viem/chains";
import { readFileSync, writeFileSync } from "node:fs";

const IDENTITY = getAddress("0xc361a6e67822a0edc17d899227dd9fc50bd62f42");
const GDOLLAR = getAddress("0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a");
const GAME = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
const CONCURRENCY = 20;

const c = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org", { timeout: 30_000 }),
  batch: { multicall: false },
});

const boolAbi = (n) => [{ name: n, type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] }];
const uintAbi = (n) => [{ name: n, type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const erc20 = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];

const src = process.argv[2] ?? "scripts/out/combined-users.json";
const parsed = JSON.parse(readFileSync(src, "utf8"));
// Keep addresses lowercase. Mixed-case triggers EIP-55 validation, and the
// root and frontend node_modules ship different viem versions whose checksums
// disagree — which silently failed 518/519 calls before this.
const addrs = (parsed.addresses ?? parsed.unionAddresses ?? Object.keys(parsed.activity ?? {})).map((a) => a.toLowerCase());
const block = await c.getBlockNumber();
console.log(`checking ${addrs.length} wallets against GoodDollar Identity at block ${block}\n`);

const rows = new Array(addrs.length);
let i = 0, failed = 0, done = 0;
async function worker() {
  while (i < addrs.length) {
    const idx = i++;
    const a = addrs[idx];
    let wl = null, la = null, err = null;
    for (let t = 0; t < 4 && wl === null; t++) {
      try { wl = await c.readContract({ address: IDENTITY, abi: boolAbi("isWhitelisted"), functionName: "isWhitelisted", args: [a] }); }
      catch (e) { err = String(e.shortMessage || e.message).slice(0, 80); await new Promise((r) => setTimeout(r, 200 * 2 ** t)); }
    }
    try { la = await c.readContract({ address: IDENTITY, abi: uintAbi("lastAuthenticated"), functionName: "lastAuthenticated", args: [a] }); } catch {}
    if (wl === null) failed++;
    rows[idx] = { address: a, whitelisted: wl, lastAuthenticated: la === null ? null : Number(la), err: wl === null ? err : null };
    if (++done % 100 === 0 || done === addrs.length) process.stdout.write(`\r  ${done}/${addrs.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("\n");

const whitelisted = rows.filter((r) => r.whitelisted === true);
const everAuth = rows.filter((r) => r.lastAuthenticated > 0);
console.log(`failed calls                    : ${failed}  ${failed ? "<-- RESULT INCOMPLETE" : ""}`);
console.log(`currently whitelisted           : ${whitelisted.length} of ${addrs.length}`);
console.log(`ever face-verified (lastAuth>0) : ${everAuth.length} of ${addrs.length}`);

const dec = await c.readContract({ address: GDOLLAR, abi: erc20, functionName: "decimals" });
const bal = await c.readContract({ address: GDOLLAR, abi: erc20, functionName: "balanceOf", args: [GAME] });
console.log(`\nGame2048 G$ treasury balance    : ${(Number(bal) / 10 ** dec).toFixed(2)} G$`);

writeFileSync("scripts/out/gooddollar-verified.json", JSON.stringify({
  generatedAt: new Date().toISOString(), block: block.toString(), checked: addrs.length, failedCalls: failed,
  currentlyWhitelisted: whitelisted.length, everAuthenticated: everAuth.length,
  gameContractBalanceRaw: bal.toString(), gDollarDecimals: dec,
  whitelistedAddresses: whitelisted.map((r) => r.address),
  everAuthenticatedAddresses: everAuth.map((r) => r.address),
}, null, 2));
console.log("raw -> scripts/out/gooddollar-verified.json");
