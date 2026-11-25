/**
 * Rehearse the UBI-contribution upgrade on a LOCAL FORK of Celo mainnet.
 * Nothing is broadcast: the fork runs in Hardhat's simulator, the owner and
 * the treasury are impersonated, and all state disappears on exit.
 *
 *   CELO_FORK_URL=<archive rpc> [UBI_REHEARSAL_PLAYERS=players.json] [UBI_REHEARSAL_OUT=out.json] \
 *     npx hardhat run --build-profile production scripts/checks/rehearse-ubi-contribution.ts
 *
 * UBI_REHEARSAL_PLAYERS is an optional JSON array of player addresses to check, on top of the
 * built-in sample, every leaderboard player and the owner.
 *
 * Uses the real G$ (SuperGoodDollar) and the real UBIScheme proxy. Checks:
 * every value read through the proxy (global and per player) is unchanged by
 * the upgrade; a shop purchase moves exactly 5% to the UBIScheme and 95% to
 * the treasury, the buyer pays exactly the price, and UbiContribution is
 * emitted; the reentrancy guard (transient storage) and SafeERC20 work on
 * Celo's EVM.
 */
import { network } from "hardhat";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, getAddress, http, keccak256, parseAbi, toBytes, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PROXY: Address = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";
const G_DOLLAR: Address = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const UBI_SCHEME: Address = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1"; // GoodDollar production UBI (Celo)
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const WATCH: Address[] = [
  "0xcb6f72152DB12546b21ef0dD5F614Ca532531838",
  "0x2ecf459a960ed653197fec27ed55086a7ec92c4e",
  "0x8271622d3a93e46ea5b4b69ae28a9e4c4fd1ce2b",
].map((a) => getAddress(a));
const COSMETIC_IDS = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];

const forkUrl = process.env.CELO_FORK_URL;
if (!forkUrl) throw new Error("Set CELO_FORK_URL to an archive RPC (forno is too slow to fork)");
// Pin the fork to the chain's current block, so the run is reproducible and on record.
const forkBlock = Number(await createPublicClient({ transport: http(forkUrl) }).getBlockNumber());
const { viem, networkHelpers } = await network.create({
  network: "hardhatOp",
  override: { chainId: 42220, forking: { url: forkUrl, blockNumber: forkBlock } },
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
const implementation = async () => getAddress("0x" + (await pc.getStorageAt({ address: PROXY, slot: IMPL_SLOT }))!.slice(26));

// Values used in comparisons are typed explicitly: the generated contract types don't resolve under
// this repo's TypeScript setup (master's own scripts and tests show the same tsc errors).
type LeaderboardEntry = { player: Address; score: bigint; highestTile: number };

// Players to check: the built-in sample, every leaderboard player, the owner, and any extra list.
const owner = getAddress((await game.read.owner()) as Address);
const leaderboard = (await game.read.getLeaderboard()) as readonly LeaderboardEntry[];
const extra: string[] = process.env.UBI_REHEARSAL_PLAYERS ? JSON.parse(readFileSync(process.env.UBI_REHEARSAL_PLAYERS, "utf8")) : [];
const ZERO = "0x0000000000000000000000000000000000000000";
const players = [...new Set([...WATCH, ...leaderboard.map((e) => e.player), owner, ...extra].map((a) => getAddress(a)))].filter((a) => a !== ZERO);

async function playerState(a: Address) {
  const username = (await game.read.usernames([a])) as string;
  return {
    session: await game.read.getSession([a]),
    bestScore: (await game.read.bestScore([a])) as bigint,
    bestTile: await game.read.bestTile([a]),
    claimedMilestones: await game.read.claimedMilestones([a]),
    xp: (await game.read.xp([a])) as bigint,
    streakCount: await game.read.streakCount([a]),
    lastPlayTimestamp: await game.read.lastPlayTimestamp([a]),
    shieldCount: (await game.read.shieldCount([a])) as bigint,
    xpBoost: await game.read.getXpBoost([a]),
    username,
    nameOwner: username ? await game.read.nameOwner([keccak256(toBytes(username.toLowerCase()))]) : null,
    referrerOf: await game.read.referrerOf([a]),
    referralCount: await game.read.referralCount([a]),
    undoCredits: (await game.read.undoCredits([a])) as bigint,
    cosmeticsOwned: await Promise.all(COSMETIC_IDS.map((i) => game.read.cosmeticsOwned([a, i]))),
  };
}

async function snapshot() {
  return {
    owner: await game.read.owner(),
    gDollar: await game.read.gDollar(),
    identity: await game.read.identity(),
    prices: [await game.read.shieldPrice(), await game.read.boost2xPrice(), await game.read.boost5xPrice(), await game.read.undoPrice()],
    cosmetics: await Promise.all(COSMETIC_IDS.map((i) => game.read.getCosmeticItem([i]))),
    leaderboard: await game.read.getLeaderboard(),
    leaderboardSeeded: await game.read.leaderboardSeeded(),
    treasury: await bal(PROXY),
    players: Object.fromEntries(await Promise.all(players.map(async (a) => [a, await playerState(a)] as const))),
  };
}

const liveImpl = await implementation();
console.log(`fork of Celo at block ${forkBlock}; live implementation ${liveImpl}; owner ${owner}`);
console.log(`checking ${players.length} players (sample ${WATCH.length}, leaderboard ${leaderboard.filter((e) => e.player !== ZERO).length}, owner, extra ${extra.length}; duplicates merged)`);
const before = await snapshot();
const nonEmpty = Object.values(before.players).filter((p) => p.xp > 0n || p.bestScore > 0n || p.shieldCount > 0n || p.undoCredits > 0n || p.username).length;

const candidate = await viem.deployContract("Game2048", [UBI_SCHEME]);
await networkHelpers.impersonateAccount(owner);
await networkHelpers.setBalance(owner, 10n ** 18n);
const upgradeHash = await game.write.upgradeToAndCall([candidate.address, "0x"], { account: owner });
assert.equal((await pc.waitForTransactionReceipt({ hash: upgradeHash })).status, "success");
assert.equal(await implementation(), getAddress(candidate.address));
console.log(`owner upgraded the proxy to candidate ${candidate.address}`);

const after = await snapshot();
for (const a of players) assert.equal(ser(after.players[a]), ser(before.players[a]), `player ${a} unchanged by the upgrade`);
assert.equal(ser(after), ser(before), "state unchanged by the upgrade");
console.log(`✓ every value read before the upgrade is identical after it: globals, treasury, and ${players.length} players (${nonEmpty} with game state)`);
assert.equal(getAddress((await game.read.ubiRecipient()) as Address), getAddress(UBI_SCHEME));
assert.equal(await game.read.UBI_CONTRIBUTION_BPS(), 500n);
console.log("✓ ubiRecipient = GoodDollar UBIScheme, rate = 500 bps");

// A fresh buyer (a random key, so no real-chain state), funded with real G$ from the game treasury (impersonated).
const buyer = privateKeyToAccount(generatePrivateKey()).address;
await networkHelpers.impersonateAccount(buyer);
await networkHelpers.setBalance(buyer, 10n ** 18n);
const buyerClient = await viem.getWalletClient(buyer);
await networkHelpers.impersonateAccount(PROXY);
await networkHelpers.setBalance(PROXY, 10n ** 18n);
const price = before.prices[0] as bigint;
await (await viem.getWalletClient(PROXY)).writeContract({ address: G_DOLLAR, abi: erc20, functionName: "transfer", args: [buyer, price * 3n] });
await buyerClient.writeContract({ address: G_DOLLAR, abi: erc20, functionName: "approve", args: [PROXY, price * 3n] });

const shields = async (a: Address) => (await game.read.shieldCount([a])) as bigint;
const [b0, t0, s0] = await Promise.all([bal(buyer), bal(PROXY), shields(buyer)]);
const hash = await game.write.buyStreakShield([], { account: buyer });
const receipt = await pc.waitForTransactionReceipt({ hash });
assert.equal(receipt.status, "success");
const [b1, t1, s1] = await Promise.all([bal(buyer), bal(PROXY), shields(buyer)]);
const contribution = (price * 500n) / 10_000n;
assert.equal(b0 - b1, price, "buyer paid exactly the price");
assert.equal(t1 - t0, price - contribution, "treasury kept 95%");
assert.equal(s1 - s0, 1n, "buyer received one shield");

// The UBIScheme's balance can't be diffed: it receives continuous Superfluid
// fee streams (GoodCollective), so it grows every second. The evidence is the
// token's own Transfer events in this receipt.
const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const transfers = receipt.logs
  .filter((l) => getAddress(l.address) === getAddress(G_DOLLAR))
  .map((l) => { try { return decodeEventLog({ abi: transferAbi, data: l.data, topics: l.topics }).args; } catch { return null; } })
  .filter((x): x is { from: Address; to: Address; value: bigint } => !!x);
const paid = transfers.filter((t) => getAddress(t.from) === getAddress(buyer) && getAddress(t.to) === getAddress(PROXY));
const toUbi = transfers.filter((t) => getAddress(t.from) === getAddress(PROXY) && getAddress(t.to) === getAddress(UBI_SCHEME));
assert.deepEqual(paid.map((t) => t.value), [price], "one G$ Transfer buyer → treasury of exactly the price");
assert.deepEqual(toUbi.map((t) => t.value), [contribution], "one G$ Transfer treasury → UBIScheme of exactly 5%");

const ev = receipt.logs
  .filter((l) => getAddress(l.address) === getAddress(PROXY))
  .map((l) => { try { return decodeEventLog({ abi: game.abi, data: l.data, topics: l.topics }); } catch { return null; } })
  .find((e) => e?.eventName === "UbiContribution");
assert.ok(ev, "UbiContribution emitted");
const args = ev!.args as unknown as { buyer: Address; item: number; itemId: bigint; quantity: bigint; amountPaid: bigint; contribution: bigint; recipient: Address };
assert.equal(getAddress(args.buyer), getAddress(buyer));
assert.equal(args.item, 0, "item = StreakShield");
assert.equal(args.quantity, 1n);
assert.equal(args.amountPaid, price);
assert.equal(args.contribution, contribution);
assert.equal(getAddress(args.recipient), getAddress(UBI_SCHEME));
console.log(`✓ shield bought for ${Number(price) / 1e18} G$: G$ Transfer → UBIScheme of ${Number(contribution) / 1e18} G$ in the same tx, treasury +${Number(price - contribution) / 1e18} G$, UbiContribution emitted (gas ${receipt.gasUsed})`);

// The reentrancy guard uses transient storage (EIP-1153): a second purchase in
// a new transaction must still work, i.e. the guard was cleared.
const second = await pc.waitForTransactionReceipt({ hash: await game.write.buyStreakShield([], { account: buyer }) });
assert.equal(second.status, "success");
console.log("✓ a second purchase works (transient reentrancy guard cleared between transactions on Celo's EVM)");

if (process.env.UBI_REHEARSAL_OUT) {
  writeFileSync(process.env.UBI_REHEARSAL_OUT, ser({
    forkBlock, liveImplementation: liveImpl, candidate: candidate.address, owner, upgradeTx: upgradeHash,
    playersChecked: players.length, playersWithGameState: nonEmpty, players,
    purchase: { tx: hash, buyer, item: "StreakShield", price, contribution, toTreasury: price - contribution, gasUsed: receipt.gasUsed, ubiContributionEvent: args },
    result: "PASSED",
  }));
}
console.log("\nREHEARSAL PASSED — nothing was broadcast; the fork is discarded on exit.");
