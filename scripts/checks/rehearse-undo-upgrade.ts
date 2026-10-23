/**
 * Rehearse the undo-at-submit upgrade on a LOCAL FORK of Celo mainnet.
 * Nothing is broadcast: the fork runs in Hardhat's simulator, the owner is
 * impersonated, and all state disappears when the script exits.
 *
 *   npx hardhat run scripts/checks/rehearse-undo-upgrade.ts
 *   CELO_FORK_URL=<archive rpc> npx hardhat run scripts/checks/rehearse-undo-upgrade.ts
 *
 * It (1) reads player, shop and leaderboard state through the live proxy,
 * (2) deploys the candidate implementation and upgrades the proxy as the
 * owner, (3) reads everything again and fails on any difference, then
 * (4) plays a game that uses one undo credit and submits it with
 * submitScoreWithUndos, checking the credit is deducted in that transaction.
 */
import { network } from "hardhat";
import assert from "node:assert/strict";
import { getAddress, keccak256, parseAbi, toHex, type Address } from "viem";

const PROXY: Address = "0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6";
const G_DOLLAR: Address = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
// Wallets with history on mainnet: the owner, an undo buyer, an active player.
const WATCH: Address[] = [
  "0xcb6f72152DB12546b21ef0dD5F614Ca532531838",
  "0x2ecf459a960ed653197fec27ed55086a7ec92c4e",
  "0x8271622d3a93e46ea5b4b69ae28a9e4c4fd1ce2b",
].map((a) => getAddress(a));

const { viem, networkHelpers } = await network.create({
  network: "hardhatOp",
  override: { chainId: 42220, forking: { url: process.env.CELO_FORK_URL ?? "https://forno.celo.org" } },
});
const publicClient = await viem.getPublicClient();
const game = await viem.getContractAt("Game2048", PROXY);
const erc20 = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
]);

async function snapshot() {
  const players = await Promise.all(
    WATCH.map(async (a) => ({
      a,
      xp: await game.read.xp([a]),
      streak: await game.read.streakCount([a]),
      last: await game.read.lastPlayTimestamp([a]),
      shields: await game.read.shieldCount([a]),
      boost: await game.read.getXpBoost([a]),
      best: await game.read.bestScore([a]),
      tile: await game.read.bestTile([a]),
      milestones: await game.read.claimedMilestones([a]),
      name: await game.read.usernames([a]),
      undo: await game.read.undoCredits([a]),
      refBy: await game.read.referrerOf([a]),
      refs: await game.read.referralCount([a]),
      session: await game.read.getSession([a]),
    })),
  );
  const cosmetics = await Promise.all([1n, 2n, 3n, 4n, 5n].map((id) => game.read.getCosmeticItem([id])));
  return {
    owner: await game.read.owner(),
    gDollar: await game.read.gDollar(),
    identity: await game.read.identity(),
    prices: [await game.read.shieldPrice(), await game.read.boost2xPrice(), await game.read.boost5xPrice(), await game.read.undoPrice()],
    cosmetics,
    leaderboard: await game.read.getLeaderboard(),
    leaderboardSeeded: await game.read.leaderboardSeeded(),
    players,
  };
}
const ser = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

const block = await publicClient.getBlockNumber();
const implBefore = getAddress("0x" + (await publicClient.getStorageAt({ address: PROXY, slot: IMPL_SLOT }))!.slice(26));
console.log(`fork at block ${block}; live implementation ${implBefore}`);
const before = await snapshot();
console.log(`read ${WATCH.length} players, 4 prices, 5 cosmetics, leaderboard`);

// ── upgrade as the owner ─────────────────────────────────────────────────────
const candidate = await viem.deployContract("Game2048");
const owner = before.owner as Address;
await networkHelpers.impersonateAccount(owner);
await networkHelpers.setBalance(owner, 10n ** 18n);
await game.write.upgradeToAndCall([candidate.address, "0x"], { account: owner });
const implAfter = getAddress("0x" + (await publicClient.getStorageAt({ address: PROXY, slot: IMPL_SLOT }))!.slice(26));
assert.equal(implAfter, getAddress(candidate.address), "proxy now points at the candidate");
console.log(`upgraded proxy to candidate ${implAfter}`);

const after = await snapshot();
assert.equal(ser(after), ser(before), "state read through the proxy is unchanged by the upgrade");
console.log("✓ every value read before the upgrade is identical after it");

assert.equal(await game.read.supportsUndoAtSubmit(), true);
console.log("✓ supportsUndoAtSubmit() = true");

// ── a game that uses one undo, settled at submit ─────────────────────────────
const [, playerClient] = await viem.getWalletClients();
const player = playerClient.account.address;
// Fund the test player with G$ from the treasury (impersonated) to buy credits.
await networkHelpers.impersonateAccount(PROXY);
await networkHelpers.setBalance(PROXY, 10n ** 18n);
const price = before.prices[3];
await (await viem.getWalletClient(PROXY)).writeContract({ address: G_DOLLAR, abi: erc20, functionName: "transfer", args: [player, price * 2n] });
await playerClient.writeContract({ address: G_DOLLAR, abi: erc20, functionName: "approve", args: [PROXY, price * 2n] });
await game.write.buyUndoMove([2n], { account: playerClient.account });
assert.equal(await game.read.undoCredits([player]), 2n);

// Someone else can no longer burn the player's credits.
const [, , other] = await viem.getWalletClients();
await viem.assertions.revertWithCustomError(game.write.consumeUndo([player], { account: other.account }), game, "NotPlayer");
assert.equal(await game.read.undoCredits([player]), 2n);
console.log("✓ consumeUndo(other player) reverts NotPlayer");

const seed = toHex(123456789n, { size: 32 });
await game.write.startSession([keccak256(seed)], { account: playerClient.account });
const hash = await game.write.submitScoreWithUndos([400n, 128, 50n, seed, 0n, 1n], { account: playerClient.account });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
assert.equal(receipt.status, "success");
assert.equal(await game.read.undoCredits([player]), 1n, "one credit deducted in the submit transaction");
assert.equal(await game.read.bestScore([player]), 400n);
console.log(`✓ submitScoreWithUndos(…, 1): credit 2 → 1 in the same transaction (gas used ${receipt.gasUsed})`);

// The old 5-argument submitScore still works for clients that haven't updated.
await game.write.startSession([keccak256(seed)], { account: playerClient.account });
await game.write.submitScore([500n, 256, 60n, seed, 0n], { account: playerClient.account });
assert.equal(await game.read.undoCredits([player]), 1n);
assert.equal(await game.read.bestScore([player]), 500n);
console.log("✓ old submitScore(5 args) still works and leaves credits alone");

console.log("\nREHEARSAL PASSED — nothing was broadcast; the fork is discarded on exit.");
