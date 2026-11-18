/**
 * Rehearse the release packet and the rollback on a LOCAL FORK of Celo mainnet.
 * Nothing is broadcast: the owner and the treasury are impersonated in
 * Hardhat's simulator, and the fork is discarded on exit.
 *
 *   CELO_FORK_URL=<rpc> [FORK_BLOCK=<n>] [REHEARSAL_OUT=<file.json>] \
 *     npx hardhat run --build-profile production scripts/checks/rehearse-ubi-release-packet.ts
 *
 * On the real proxy, G$ token and UBIScheme it:
 * 1. Deploys the candidate and runs the release-packet checks (scripts/lib/ubiReleasePacket.ts)
 *    against the reviewed fingerprints. Every check must pass.
 * 2. Sends the packet's own upgrade calldata as the owner. One Streak Shield purchase must
 *    then contribute floor(5%) to the UBIScheme.
 * 3. Sends the packet's rollback calldata as the owner. The live V6 implementation must be
 *    back, every storage slot read before the upgrade must be unchanged, and a purchase after
 *    the rollback must contribute nothing, as today.
 */
import { artifacts, network } from "hardhat";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { decodeEventLog, getAbiItem, getAddress, parseAbi, toEventSelector, toHex, type Address, type Hex } from "viem";
import { EIP1967_IMPLEMENTATION_SLOT, PRODUCTION, REVIEWED_BUILD, buildReleasePacket, type BuildArtifact } from "../lib/ubiReleasePacket.js";

const G_DOLLAR: Address = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const { proxy: PROXY, ubiScheme: UBI_SCHEME, liveImplementation: LIVE } = PRODUCTION;
// OpenZeppelin 5 namespaced storage (ERC-7201): Ownable and Initializable.
const NAMESPACED: Hex[] = [
  "0x9016d09d72d40fdae2fd8ceac6b6234c7706214fd39c1cd1e609a0528c199300",
  "0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00",
];

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
const implementation = async () => getAddress(`0x${(await pc.getStorageAt({ address: PROXY, slot: EIP1967_IMPLEMENTATION_SLOT }))!.slice(26)}`);

/** Every linear storage slot the layout uses (0..53) and some beyond it, plus OpenZeppelin's namespaced slots. */
async function storage(): Promise<Record<string, Hex>> {
  const slots: Hex[] = [...Array.from({ length: 64 }, (_, i) => toHex(i, { size: 32 })), ...NAMESPACED];
  const out: Record<string, Hex> = {};
  for (const s of slots) out[s] = (await pc.getStorageAt({ address: PROXY, slot: s })) ?? "0x";
  return out;
}

const forkBlock = await pc.getBlockNumber();
assert.equal(await implementation(), LIVE, "the fork's proxy runs the live V6 implementation");
console.log(`fork at block ${forkBlock}; proxy runs ${LIVE}`);
const before = await storage();

// 1. Deploy the candidate as a deployer would, then check it as the owner would before signing.
const [, buyerClient] = await viem.getWalletClients();
const candidate = await viem.deployContract("Game2048", [UBI_SCHEME]);
const artifact = (await artifacts.readArtifact("Game2048")) as unknown as BuildArtifact;
const packet = await buildReleasePacket(pc, {
  implementation: candidate.address, proxy: PROXY, recipient: UBI_SCHEME, rollbackTo: LIVE, artifact, reviewed: REVIEWED_BUILD,
});
for (const c of packet.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.check}: ${c.detail}`);
assert.equal(packet.ok, true, "every release-packet check passes for the reviewed candidate on real chain state");
const signer = packet.signer!;
console.log(`✓ release packet ready; signer ${signer}`);

// 2. The owner sends the packet's upgrade transaction, byte for byte.
await networkHelpers.impersonateAccount(signer);
await networkHelpers.setBalance(signer, 10n ** 18n);
const ownerWallet = await viem.getWalletClient(signer);
const upgradeReceipt = await pc.waitForTransactionReceipt({ hash: await ownerWallet.sendTransaction({ to: packet.upgrade.to, data: packet.upgrade.data, value: 0n }) });
assert.equal(upgradeReceipt.status, "success");
assert.equal(await implementation(), getAddress(candidate.address));
assert.deepEqual(await storage(), before, "the upgrade changes no storage slot");
console.log(`✓ upgrade sent as the owner (gas ${upgradeReceipt.gasUsed}); proxy runs the candidate; storage unchanged`);

// One purchase on the upgraded proxy contributes floor(5%).
const price = (await game.read.shieldPrice()) as bigint;
assert.ok(price > 0n, "the live Streak Shield price is set");
const buyer = buyerClient.account.address;
await networkHelpers.impersonateAccount(PROXY);
await networkHelpers.setBalance(PROXY, 10n ** 18n);
await (await viem.getWalletClient(PROXY)).writeContract({ address: G_DOLLAR, abi: erc20, functionName: "transfer", args: [buyer, 2n * price] });
await buyerClient.writeContract({ address: G_DOLLAR, abi: erc20, functionName: "approve", args: [PROXY, 2n * price] });
// The UBIScheme's balanceOf includes Superfluid streams that accrue every block,
// so what the purchase sent it is read from the receipt's G$ Transfer logs; the
// buyer's and the treasury's balances don't stream and are compared exactly.
const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const transfersIn = (logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[]) => logs
  .filter((l) => getAddress(l.address) === getAddress(G_DOLLAR))
  .flatMap((l) => { try { return [decodeEventLog({ abi: transferAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] }).args]; } catch { return []; } });
const toUbi = (logs: Parameters<typeof transfersIn>[0]) =>
  transfersIn(logs).filter((t) => getAddress(t.from) === PROXY && getAddress(t.to) === UBI_SCHEME).map((t) => t.value);
const contribution = (price * 500n) / 10_000n;

const [b0, t0] = await Promise.all([bal(buyer), bal(PROXY)]);
const r1 = await pc.waitForTransactionReceipt({ hash: await game.write.buyStreakShield({ account: buyerClient.account }) });
assert.equal(r1.status, "success");
const [b1, t1] = await Promise.all([bal(buyer), bal(PROXY)]);
const events = r1.logs.filter((l) => getAddress(l.address) === PROXY).flatMap((l) => {
  try { return [decodeEventLog({ abi: game.abi, data: l.data, topics: l.topics })]; } catch { return []; }
});
const ubiEvents = events.filter((e) => e.eventName === "UbiContribution");
assert.equal(b0 - b1, price, "the buyer pays exactly the price");
assert.equal(t1 - t0, price - contribution, "the treasury keeps the price minus the contribution");
assert.deepEqual(toUbi(r1.logs), [contribution], "one G$ Transfer game → UBIScheme of exactly floor(5%)");
assert.equal(ubiEvents.length, 1, "one UbiContribution event");
const contributed = contribution;
console.log(`✓ after the upgrade, a Streak Shield purchase sends ${contributed} wei of G$ to the UBIScheme in the same transaction and emits UbiContribution`);

// 3. The owner sends the packet's rollback transaction: V6 is back, state intact, no contribution.
const rollbackReceipt = await pc.waitForTransactionReceipt({ hash: await ownerWallet.sendTransaction({ to: packet.rollback.to, data: packet.rollback.data, value: 0n }) });
assert.equal(rollbackReceipt.status, "success");
assert.equal(await implementation(), LIVE);
assert.deepEqual(await storage(), before, "the upgrade and the rollback together change no storage slot");
console.log(`✓ rollback sent as the owner (gas ${rollbackReceipt.gasUsed}); proxy runs ${LIVE} again; storage identical to before the upgrade`);

const [b2, t2] = await Promise.all([bal(buyer), bal(PROXY)]);
const r2 = await pc.waitForTransactionReceipt({ hash: await game.write.buyStreakShield({ account: buyerClient.account }) });
assert.equal(r2.status, "success");
const [b3, t3] = await Promise.all([bal(buyer), bal(PROXY)]);
assert.equal(b2 - b3, price, "after the rollback the buyer still pays exactly the price");
assert.equal(t3 - t2, price, "after the rollback the treasury keeps the whole price, as today");
assert.deepEqual(toUbi(r2.logs), [], "after the rollback no G$ goes to the UBIScheme");
const ubiTopic = toEventSelector(getAbiItem({ abi: game.abi, name: "UbiContribution" }));
assert.ok(r1.logs.some((l) => l.topics[0] === ubiTopic), "the topic matches the event seen before the rollback");
assert.ok(!r2.logs.some((l) => l.topics[0] === ubiTopic), "no UbiContribution event after the rollback");
console.log("✓ after the rollback, a purchase pays the treasury in full and emits no UbiContribution (today's behaviour)");

if (process.env.REHEARSAL_OUT) {
  writeFileSync(process.env.REHEARSAL_OUT, JSON.stringify({
    forkBlock, candidate: candidate.address, checks: packet.checks, signer, upgrade: packet.upgrade, rollback: packet.rollback,
    upgradeGas: upgradeReceipt.gasUsed, rollbackGas: rollbackReceipt.gasUsed, shieldPrice: price, contributed,
  }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}
console.log("\nRELEASE-PACKET REHEARSAL PASSED: nothing was broadcast; the fork is discarded on exit.");
