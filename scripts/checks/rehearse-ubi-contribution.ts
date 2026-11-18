/**
 * Rehearse the UBI-contribution upgrade on a LOCAL FORK of Celo mainnet.
 * Nothing is broadcast: the fork runs in Hardhat's simulator, the owner and
 * the treasury are impersonated, and all state disappears on exit.
 *
 *   CELO_FORK_URL=<rpc> [FORK_BLOCK=<n>] [REHEARSAL_OUT=<file.json>] \
 *     npx hardhat run --build-profile production scripts/checks/rehearse-ubi-contribution.ts
 *
 * Uses the real G$ (SuperGoodDollar) and the real UBIScheme proxy. Checks:
 * state read through the proxy is unchanged by the upgrade; a purchase on
 * EVERY paid path moves exactly floor(5%) to the UBIScheme and the rest to the
 * treasury, the buyer pays exactly the price, and UbiContribution is emitted
 * with the right fields; a failed purchase moves nothing; the reentrancy guard
 * (transient storage) and SafeERC20 work on Celo's EVM; and the independent
 * reconciliation (scripts/lib/ubiReconcile.ts) agrees with all of it from the
 * fork's logs alone.
 */
import { network } from "hardhat";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { decodeEventLog, formatUnits, getAddress, parseAbi, type Address, type Hex } from "viem";
import { GAME_EVENTS_ABI, TRANSFER_ABI, reconcileUbiContributions, type ChainLog } from "../lib/ubiReconcile.js";

const PROXY: Address = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";
const G_DOLLAR: Address = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const UBI_SCHEME: Address = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1"; // GoodDollar production UBI (Celo)
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const WATCH: Address[] = [
  "0xcb6f72152DB12546b21ef0dD5F614Ca532531838",
  "0x2ecf459a960ed653197fec27ed55086a7ec92c4e",
  "0x8271622d3a93e46ea5b4b69ae28a9e4c4fd1ce2b",
].map((a) => getAddress(a));

if (!process.env.CELO_FORK_URL) throw new Error("Set CELO_FORK_URL to an archive RPC (forno is too slow to fork)");
const { viem, networkHelpers } = await network.create({
  network: "hardhatOp",
  override: {
    chainId: 42220,
    forking: { url: process.env.CELO_FORK_URL, ...(process.env.FORK_BLOCK ? { blockNumber: BigInt(process.env.FORK_BLOCK) } : {}) },
  },
});
const pc = await viem.getPublicClient();
const game = await viem.getContractAt("Game2048", PROXY);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
]);
const bal = (a: Address) => pc.readContract({ address: G_DOLLAR, abi: erc20, functionName: "balanceOf", args: [a] });
const ser = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

async function snapshot() {
  return {
    owner: await game.read.owner(),
    gDollar: await game.read.gDollar(),
    identity: await game.read.identity(),
    prices: [await game.read.shieldPrice(), await game.read.boost2xPrice(), await game.read.boost5xPrice(), await game.read.undoPrice()],
    cosmetics: await Promise.all([1n, 2n, 3n, 4n, 5n].map((i) => game.read.getCosmeticItem([i]))),
    leaderboard: await game.read.getLeaderboard(),
    players: await Promise.all(
      WATCH.map(async (a) => [
        await game.read.xp([a]), await game.read.streakCount([a]), await game.read.shieldCount([a]),
        await game.read.getXpBoost([a]), await game.read.bestScore([a]), await game.read.bestTile([a]),
        await game.read.claimedMilestones([a]), await game.read.usernames([a]), await game.read.undoCredits([a]),
        await game.read.referralCount([a]), await game.read.getSession([a]),
      ]),
    ),
  };
}

console.log(`fork at block ${await pc.getBlockNumber()}; live impl 0x${(await pc.getStorageAt({ address: PROXY, slot: IMPL_SLOT }))!.slice(26)}`);

// Gas of one purchase on the LIVE implementation, to compare with the candidate.
// Done before the snapshot by a wallet the snapshot doesn't watch, so it can't affect it.
const [, , , baselineClient] = await viem.getWalletClients();
await networkHelpers.impersonateAccount(PROXY);
await networkHelpers.setBalance(PROXY, 10n ** 18n);
const liveShieldPrice = (await game.read.shieldPrice()) as bigint;
let liveShieldGas = 0n;
if (liveShieldPrice > 0n) {
  await (await viem.getWalletClient(PROXY)).writeContract({ address: G_DOLLAR, abi: erc20, functionName: "transfer", args: [baselineClient.account.address, liveShieldPrice] });
  await baselineClient.writeContract({ address: G_DOLLAR, abi: erc20, functionName: "approve", args: [PROXY, liveShieldPrice] });
  liveShieldGas = (await pc.waitForTransactionReceipt({ hash: await game.write.buyStreakShield({ account: baselineClient.account }) })).gasUsed;
  console.log(`live implementation: a Streak Shield purchase uses ${liveShieldGas} gas (no UBI transfer)`);
}
const before = await snapshot();

const candidate = await viem.deployContract("Game2048", [UBI_SCHEME]);
const owner = before.owner as Address;
await networkHelpers.impersonateAccount(owner);
await networkHelpers.setBalance(owner, 10n ** 18n);
await game.write.upgradeToAndCall([candidate.address, "0x"], { account: owner });
assert.equal(getAddress("0x" + (await pc.getStorageAt({ address: PROXY, slot: IMPL_SLOT }))!.slice(26)), getAddress(candidate.address));
console.log(`upgraded to candidate ${candidate.address}`);

assert.equal(ser(await snapshot()), ser(before), "state unchanged by the upgrade");
console.log("✓ every value read before the upgrade is identical after it");
assert.equal(getAddress(await game.read.ubiRecipient()), getAddress(UBI_SCHEME));
assert.equal(await game.read.UBI_CONTRIBUTION_BPS(), 500n);
console.log("✓ ubiRecipient = GoodDollar UBIScheme, rate = 500 bps");

const candidateBytes = ((await pc.getCode({ address: candidate.address })) ?? "0x").length / 2 - 1;
console.log(`candidate runtime code: ${candidateBytes} bytes`);

// ── Every paid path, on the real G$ and the real UBIScheme ─────────────────
const E = 10n ** 18n;
const firstBlock = (await pc.getBlockNumber()) + 1n;
// Prices are owner settings. Only on this throwaway fork: a path the live
// contract has switched off (price 0) gets a price, so it can be exercised.
let [shieldP, boost2P, boost5P, undoP] = before.prices as bigint[];
const priced: string[] = [];
if (shieldP === 0n) { shieldP = 500n * E; priced.push("Streak Shield"); }
if (boost2P === 0n) { boost2P = 1500n * E; priced.push("XP Boost 2x"); }
if (boost5P === 0n) { boost5P = 4000n * E; priced.push("XP Boost 5x"); }
if (undoP === 0n) { undoP = 100n * E; priced.push("Undo"); }
if (priced.length) {
  await game.write.setShopPrices([shieldP, boost2P, boost5P, undoP], { account: owner });
  console.log(`(fork only) priced paths switched off on the live contract: ${priced.join(", ")}`);
}
let cosmeticId = 0n;
let cosmeticP = 0n;
for (const [i, c] of before.cosmetics.entries()) {
  const item = c as unknown as { price: bigint; exists: boolean };
  if (!cosmeticId && item.exists && item.price > 0n) { cosmeticId = BigInt(i + 1); cosmeticP = item.price; }
}
if (!cosmeticId) {
  cosmeticId = 99n;
  cosmeticP = 150n * E;
  await game.write.setCosmeticPrice([cosmeticId, cosmeticP], { account: owner });
  console.log("(fork only) listed cosmetic #99 at 150 G$: none of #1 to #5 is listed on the live contract");
}

// A buyer funded with real G$ from the game treasury (impersonated).
const [, buyerClient, strangerClient] = await viem.getWalletClients();
const buyer = buyerClient.account.address;
const as = { account: buyerClient.account };
type Path = { name: string; item: number; itemId: bigint; quantity: bigint; price: bigint; buy: () => Promise<Hex> };
const paths: Path[] = [
  { name: "Streak Shield", item: 0, itemId: 0n, quantity: 1n, price: shieldP, buy: () => game.write.buyStreakShield(as) },
  { name: "XP Boost 2x", item: 1, itemId: 2n, quantity: 1n, price: boost2P, buy: () => game.write.buyXpBoost([2], as) },
  { name: "XP Boost 5x", item: 1, itemId: 5n, quantity: 1n, price: boost5P, buy: () => game.write.buyXpBoost([5], as) },
  { name: "Undo x1", item: 2, itemId: 0n, quantity: 1n, price: undoP, buy: () => game.write.buyUndoMove([1n], as) },
  { name: "Undo x3", item: 2, itemId: 0n, quantity: 3n, price: undoP * 3n, buy: () => game.write.buyUndoMove([3n], as) },
  { name: `Cosmetic #${cosmeticId}`, item: 3, itemId: cosmeticId, quantity: 1n, price: cosmeticP, buy: () => game.write.buyCosmetic([cosmeticId], as) },
];
const budget = paths.reduce((s, p) => s + p.price, 0n) + shieldP;
await networkHelpers.impersonateAccount(PROXY);
await networkHelpers.setBalance(PROXY, 10n ** 18n);
await (await viem.getWalletClient(PROXY)).writeContract({ address: G_DOLLAR, abi: erc20, functionName: "transfer", args: [buyer, budget + shieldP] });
await buyerClient.writeContract({ address: G_DOLLAR, abi: erc20, functionName: "approve", args: [PROXY, budget] });

// The UBIScheme's balance can't be diffed: it receives continuous Superfluid
// fee streams (GoodCollective), so it grows every second. The evidence is the
// token's own Transfer events in each receipt.
const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const rows: { path: string; paid: bigint; contribution: bigint; treasury: bigint; gas: bigint; tx: Hex }[] = [];
for (const p of paths) {
  const [b0, t0] = await Promise.all([bal(buyer), bal(PROXY)]);
  const hash = await p.buy();
  const receipt = await pc.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${p.name}: purchase succeeded`);
  const [b1, t1] = await Promise.all([bal(buyer), bal(PROXY)]);
  const contribution = (p.price * 500n) / 10_000n;
  assert.equal(b0 - b1, p.price, `${p.name}: buyer paid exactly the price`);
  assert.equal(t1 - t0, p.price - contribution, `${p.name}: treasury kept the rest`);
  const transfers = receipt.logs
    .filter((l) => getAddress(l.address) === getAddress(G_DOLLAR))
    .map((l) => { try { return decodeEventLog({ abi: transferAbi, data: l.data, topics: l.topics }).args; } catch { return null; } })
    .filter((x): x is { from: Address; to: Address; value: bigint } => !!x);
  const paid = transfers.filter((t) => getAddress(t.from) === getAddress(buyer) && getAddress(t.to) === getAddress(PROXY));
  const toUbi = transfers.filter((t) => getAddress(t.from) === getAddress(PROXY) && getAddress(t.to) === getAddress(UBI_SCHEME));
  assert.deepEqual(paid.map((t) => t.value), [p.price], `${p.name}: one G$ Transfer buyer → treasury of exactly the price`);
  assert.deepEqual(toUbi.map((t) => t.value), [contribution], `${p.name}: one G$ Transfer treasury → UBIScheme of exactly floor(5%)`);
  const evs = receipt.logs
    .filter((l) => getAddress(l.address) === getAddress(PROXY))
    .map((l) => { try { return decodeEventLog({ abi: game.abi, data: l.data, topics: l.topics }); } catch { return null; } })
    .filter((e) => e?.eventName === "UbiContribution");
  assert.equal(evs.length, 1, `${p.name}: exactly one UbiContribution`);
  const a = evs[0]!.args as unknown as { buyer: Address; item: number; itemId: bigint; quantity: bigint; amountPaid: bigint; contribution: bigint; recipient: Address };
  assert.equal(getAddress(a.buyer), getAddress(buyer));
  assert.equal(Number(a.item), p.item, `${p.name}: item`);
  assert.equal(a.itemId, p.itemId, `${p.name}: itemId`);
  assert.equal(a.quantity, p.quantity, `${p.name}: quantity`);
  assert.equal(a.amountPaid, p.price, `${p.name}: amountPaid`);
  assert.equal(a.contribution, contribution, `${p.name}: contribution`);
  assert.equal(getAddress(a.recipient), getAddress(UBI_SCHEME), `${p.name}: recipient`);
  rows.push({ path: p.name, paid: p.price, contribution, treasury: p.price - contribution, gas: receipt.gasUsed, tx: hash });
  console.log(`✓ ${p.name}: paid ${formatUnits(p.price, 18)} G$, ${formatUnits(contribution, 18)} G$ to the UBIScheme in the same tx, treasury +${formatUnits(p.price - contribution, 18)} G$ (gas ${receipt.gasUsed}${p.name === "Streak Shield" && liveShieldGas ? `, +${receipt.gasUsed - liveShieldGas} vs the live implementation` : ""})`);
}

// The reentrancy guard uses transient storage (EIP-1153): a second purchase in
// a new transaction must still work, i.e. the guard was cleared.
await pc.waitForTransactionReceipt({ hash: await game.write.buyStreakShield(as) });
console.log("✓ a second purchase works (transient reentrancy guard cleared between transactions on Celo's EVM)");

// A failed purchase moves nothing: a holder who never approved the game.
const stranger = strangerClient.account.address;
await (await viem.getWalletClient(PROXY)).writeContract({ address: G_DOLLAR, abi: erc20, functionName: "transfer", args: [stranger, shieldP] });
const [s0, tr0] = await Promise.all([bal(stranger), bal(PROXY)]);
await assert.rejects(game.write.buyStreakShield({ account: strangerClient.account }), "a purchase without an allowance reverts");
assert.deepEqual([await bal(stranger), await bal(PROXY)], [s0, tr0], "the failed purchase moved no G$");
console.log("✓ a purchase without an allowance reverts and moves no G$");

// Independent reconciliation, from the fork's logs alone.
const lastBlock = await pc.getBlockNumber();
const raw = [
  ...(await pc.getLogs({ address: PROXY, events: GAME_EVENTS_ABI, fromBlock: firstBlock, toBlock: lastBlock })),
  ...(await pc.getLogs({ address: G_DOLLAR, event: TRANSFER_ABI[0], args: { from: PROXY, to: UBI_SCHEME }, fromBlock: firstBlock, toBlock: lastBlock })),
];
const logs: ChainLog[] = raw.map((l) => ({ transactionHash: l.transactionHash!, logIndex: l.logIndex!, blockNumber: l.blockNumber!, address: l.address, topics: l.topics, data: l.data }));
const report = reconcileUbiContributions(logs, { game: PROXY, token: G_DOLLAR, recipient: UBI_SCHEME });
const wantTotal = rows.reduce((s, r) => s + r.contribution, 0n) + (shieldP * 500n) / 10_000n;
assert.deepEqual(report.discrepancies, [], "the reconciliation finds nothing out of line");
assert.equal(report.purchases, paths.length + 1);
assert.equal(report.verified, wantTotal);
assert.equal(report.transferredToRecipient, wantTotal);
console.log(`✓ reconciliation from logs: ${report.purchases} purchases, ${formatUnits(report.paid, 18)} G$ paid, ${formatUnits(report.verified, 18)} G$ verified to the UBIScheme, 0 discrepancies`);

if (process.env.REHEARSAL_OUT) {
  const forkBlock = process.env.FORK_BLOCK ?? String(firstBlock - 1n);
  writeFileSync(
    process.env.REHEARSAL_OUT,
    JSON.stringify({ forkBlock, candidateBytes, liveShieldGas, pricedOnForkOnly: priced, cosmeticId: String(cosmeticId), rows, reconciliation: report }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );
}
console.log("\nREHEARSAL PASSED — nothing was broadcast; the fork is discarded on exit.");
