/**
 * The release packet's pre-signing checks. The packet must accept exactly the
 * reviewed implementation with the right recipient, and refuse anything else.
 * Its upgrade and rollback transactions must do what they say on a proxy.
 * This local proxy stands in for production: its "live" implementation plays
 * V6, the rollback target.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { artifacts, network } from "hardhat";
import { decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi, type Hex } from "viem";

import {
  EIP1967_IMPLEMENTATION_SLOT, REVIEWED_BUILD, buildReleasePacket, immutableValues, zeroImmutables, type BuildArtifact,
} from "../scripts/lib/ubiReleasePacket.js";

const UPGRADE_ABI = parseAbi(["function upgradeToAndCall(address newImplementation, bytes data) payable"]);

describe("UBI release packet: checks before the owner signs", async () => {
  const { viem, networkHelpers } = await network.create();
  const pc = await viem.getPublicClient();
  const [owner, stranger, , ubi, other] = await viem.getWalletClients();
  const artifact = (await artifacts.readArtifact("Game2048")) as unknown as BuildArtifact;
  const localBuild = {
    creationKeccak: keccak256(artifact.bytecode),
    runtimeZeroedKeccak: keccak256(zeroImmutables(artifact.deployedBytecode, artifact.immutableReferences)),
  };

  async function deployProxyOnLiveImplementation() {
    const token = await viem.deployContract("MockERC20");
    const identity = await viem.deployContract("MockIdentity");
    const live = await viem.deployContract("Game2048", [ubi.account.address]);
    const initData = encodeFunctionData({ abi: live.abi, functionName: "initialize", args: [token.address, identity.address] });
    const proxy = await viem.deployContract("Game2048Proxy", [live.address, initData]);
    const game = await viem.getContractAt("Game2048", proxy.address);
    const candidate = await viem.deployContract("Game2048", [ubi.account.address]);
    const input = {
      implementation: candidate.address, proxy: proxy.address, recipient: ubi.account.address,
      rollbackTo: live.address, artifact, reviewed: localBuild,
    };
    return { token, live, proxy, game, candidate, input };
  }
  const implementationOf = async (proxy: Hex) => getAddress(`0x${(await pc.getStorageAt({ address: proxy, slot: EIP1967_IMPLEMENTATION_SLOT }))!.slice(26)}`);
  const failed = (p: { checks: { check: string; ok: boolean }[] }) => p.checks.filter((c) => !c.ok).map((c) => c.check);

  it("the build under test is the reviewed build (the suite runs with --build-profile production)", () => {
    assert.equal(localBuild.creationKeccak, REVIEWED_BUILD.creationKeccak, "Game2048's creation code differs from the reviewed build: wrong build profile, or the contract changed after review");
    assert.equal(localBuild.runtimeZeroedKeccak, REVIEWED_BUILD.runtimeZeroedKeccak, "Game2048's runtime code differs from the reviewed build");
  });

  it("the build has exactly two immutables: UUPS's own address and the UBI recipient", async () => {
    const { candidate } = await networkHelpers.loadFixture(deployProxyOnLiveImplementation);
    const values = Object.values(immutableValues((await pc.getCode({ address: candidate.address }))!, artifact.immutableReferences))
      .map((w) => getAddress(`0x${w.slice(26)}`)).sort();
    assert.deepEqual(values, [getAddress(candidate.address), getAddress(ubi.account.address)].sort());
  });

  it("every check passes for the right implementation, and the signer is the proxy's owner", async () => {
    const { input } = await networkHelpers.loadFixture(deployProxyOnLiveImplementation);
    const packet = await buildReleasePacket(pc, input);
    assert.deepEqual(failed(packet), []);
    assert.equal(packet.ok, true);
    assert.equal(packet.signer, getAddress(owner.account.address));
  });

  it("the transactions are exactly upgradeToAndCall(new, 0x) and upgradeToAndCall(live, 0x) on the proxy, with no value", async () => {
    const { input, proxy, candidate, live } = await networkHelpers.loadFixture(deployProxyOnLiveImplementation);
    const { upgrade, rollback } = await buildReleasePacket(pc, input);
    for (const [tx, target] of [[upgrade, candidate.address], [rollback, live.address]] as const) {
      assert.equal(tx.to, getAddress(proxy.address));
      assert.equal(tx.value, 0n);
      const call = decodeFunctionData({ abi: UPGRADE_ABI, data: tx.data });
      assert.equal(call.functionName, "upgradeToAndCall");
      assert.deepEqual(call.args, [getAddress(target), "0x"]);
    }
  });

  it("sent by the owner, the upgrade switches the implementation and the rollback switches it back, keeping state", async () => {
    const { input, proxy, game, candidate, live } = await networkHelpers.loadFixture(deployProxyOnLiveImplementation);
    const { upgrade, rollback } = await buildReleasePacket(pc, input);
    const state = async () => [await game.read.owner(), await game.read.gDollar(), await game.read.identity(), await game.read.shieldPrice(), await game.read.boost2xPrice()];
    const before = await state();

    await pc.waitForTransactionReceipt({ hash: await owner.sendTransaction({ to: upgrade.to, data: upgrade.data, value: 0n }) });
    assert.equal(await implementationOf(proxy.address), getAddress(candidate.address));
    assert.deepEqual(await state(), before);

    await pc.waitForTransactionReceipt({ hash: await owner.sendTransaction({ to: rollback.to, data: rollback.data, value: 0n }) });
    assert.equal(await implementationOf(proxy.address), getAddress(live.address));
    assert.deepEqual(await state(), before);
  });

  it("only the owner can send either transaction", async () => {
    const { input } = await networkHelpers.loadFixture(deployProxyOnLiveImplementation);
    const { upgrade } = await buildReleasePacket(pc, input);
    await assert.rejects(stranger.sendTransaction({ to: upgrade.to, data: upgrade.data, value: 0n }));
  });

  it("refuses an implementation built with a different recipient", async () => {
    const { input } = await networkHelpers.loadFixture(deployProxyOnLiveImplementation);
    const wrong = await viem.deployContract("Game2048", [other.account.address]);
    const packet = await buildReleasePacket(pc, { ...input, implementation: wrong.address });
    assert.equal(packet.ok, false);
    assert.deepEqual(failed(packet), ["immutables are the implementation's own address and the UBI recipient", "ubiRecipient() is the expected recipient"]);
  });

  it("refuses other code at the address, and an address with no code", async () => {
    const { input, token } = await networkHelpers.loadFixture(deployProxyOnLiveImplementation);
    const notGame = await buildReleasePacket(pc, { ...input, implementation: token.address });
    assert.equal(notGame.ok, false);
    for (const check of ["deployed runtime equals the local build, immutables aside", "deployed runtime has the reviewed fingerprint", "ubiRecipient() is the expected recipient", "the owner's upgrade succeeds in simulation (eth_call; nothing sent)"]) {
      assert.ok(failed(notGame).includes(check), check);
    }
    const empty = await buildReleasePacket(pc, { ...input, implementation: other.account.address });
    assert.equal(empty.ok, false);
    assert.ok(failed(empty).includes("implementation has code"));
  });

  it("refuses a local build that isn't the reviewed one", async () => {
    const { input } = await networkHelpers.loadFixture(deployProxyOnLiveImplementation);
    const packet = await buildReleasePacket(pc, { ...input, reviewed: { ...localBuild, creationKeccak: `0x${"00".repeat(32)}` } });
    assert.deepEqual(failed(packet), ["local build is the reviewed build"]);
  });

  it("refuses when the proxy no longer runs the rollback target", async () => {
    const { input, candidate } = await networkHelpers.loadFixture(deployProxyOnLiveImplementation);
    const packet = await buildReleasePacket(pc, { ...input, rollbackTo: candidate.address });
    assert.deepEqual(failed(packet), ["proxy runs the rollback target now"]);
  });
});
