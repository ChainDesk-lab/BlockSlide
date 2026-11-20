/**
 * Rehearse the UBI-contribution upgrade on a LOCAL FORK of Celo mainnet.
 * Nothing is broadcast: the fork runs in Hardhat's simulator, the owner and
 * the treasury are impersonated, and all state disappears on exit.
 *
 *   CELO_FORK_URL=<archive rpc> npx hardhat run --build-profile production \
 *     scripts/checks/rehearse-ubi-contribution.ts
 *
 * Uses the real G$ (SuperGoodDollar) and the real UBIScheme proxy. Checks:
 * state read through the proxy is unchanged by the upgrade; a shop purchase
 * moves exactly 5% to the UBIScheme and 95% to the treasury, the buyer pays
 * exactly the price, and UbiContribution is emitted; the reentrancy guard
 * (transient storage) and SafeERC20 work on Celo's EVM.
 */
import { network } from "hardhat";
import assert from "node:assert/strict";
import { decodeEventLog, getAddress, parseAbi, type Address } from "viem";

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
  override: { chainId: 42220, forking: { url: process.env.CELO_FORK_URL } },
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

// A buyer funded with real G$ from the game treasury (impersonated).
const [, buyerClient] = await viem.getWalletClients();
const buyer = buyerClient.account.address;
await networkHelpers.impersonateAccount(PROXY);
await networkHelpers.setBalance(PROXY, 10n ** 18n);
const price = before.prices[0];
await (await viem.getWalletClient(PROXY)).writeContract({ address: G_DOLLAR, abi: erc20, functionName: "transfer", args: [buyer, price * 3n] });
await buyerClient.writeContract({ address: G_DOLLAR, abi: erc20, functionName: "approve", args: [PROXY, price * 3n] });

const [b0, t0] = await Promise.all([bal(buyer), bal(PROXY)]);
const hash = await game.write.buyStreakShield({ account: buyerClient.account });
const receipt = await pc.waitForTransactionReceipt({ hash });
assert.equal(receipt.status, "success");
const [b1, t1] = await Promise.all([bal(buyer), bal(PROXY)]);
const contribution = (price * 500n) / 10_000n;
assert.equal(b0 - b1, price, "buyer paid exactly the price");
assert.equal(t1 - t0, price - contribution, "treasury kept 95%");

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
assert.equal((ev!.args as any).contribution, contribution);
assert.equal(getAddress((ev!.args as any).recipient), getAddress(UBI_SCHEME));
console.log(`✓ shield bought for ${price / 10n ** 18n} G$: G$ Transfer → UBIScheme of ${Number(contribution) / 1e18} G$ in the same tx, treasury +${Number(price - contribution) / 1e18} G$, UbiContribution emitted (gas ${receipt.gasUsed})`);

// The reentrancy guard uses transient storage (EIP-1153): a second purchase in
// a new transaction must still work, i.e. the guard was cleared.
await game.write.buyStreakShield({ account: buyerClient.account });
console.log("✓ a second purchase works (transient reentrancy guard cleared between transactions on Celo's EVM)");
console.log("\nREHEARSAL PASSED — nothing was broadcast; the fork is discarded on exit.");
