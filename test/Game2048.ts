import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, encodePacked, parseEther, encodeFunctionData } from "viem";

import { network } from "hardhat";

describe("Game2048 — integration", async function () {
  const { viem, networkHelpers } = await network.create();

  // ── Fixture ─────────────────────────────────────────────────────────────────

  async function deploy() {
    const [owner, alice, bob, ubi] = await viem.getWalletClients();

    const token    = await viem.deployContract("MockERC20");
    const identity = await viem.deployContract("MockIdentity");
    // Same layout as production (ignition/modules/Game2048.ts): the
    // implementation, then Game2048Proxy initialized in its constructor.
    // The implementation takes the UBI recipient as a constructor immutable.
    const impl     = await viem.deployContract("Game2048", [ubi.account.address]);
    const initData = encodeFunctionData({
      abi: impl.abi,
      functionName: "initialize",
      args: [token.address, identity.address],
    });
    const proxy    = await viem.deployContract("Game2048Proxy", [impl.address, initData]);
    const game     = await viem.getContractAt("Game2048", proxy.address);

    // Fund treasury with 10 000 G$
    await token.write.mint([owner.account.address, parseEther("10000")]);
    await token.write.approve([game.address, parseEther("10000")]);
    await game.write.fundTreasury([parseEther("10000")]);

    // Whitelist alice
    await identity.write.whitelist([alice.account.address]);

    return { game, token, identity, owner, alice, bob };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const SEED: `0x${string}` = "0x00000000000000000000000000000000000000000000000000000000deadbeef";
  const SEED_HASH = keccak256(encodePacked(["bytes32"], [SEED]));

  async function startSession(game: Awaited<ReturnType<typeof deploy>>["game"], account: Awaited<ReturnType<typeof viem.getWalletClients>>[number]) {
    await game.write.startSession([SEED_HASH], { account: account.account });
  }

  async function submitScore(
    game: Awaited<ReturnType<typeof deploy>>["game"],
    account: Awaited<ReturnType<typeof viem.getWalletClients>>[number],
    score: bigint,
    highestTile: number,
    moveCount: bigint,
    comboMoves = 0n,
  ) {
    await game.write.submitScore(
      [score, highestTile, moveCount, SEED, comboMoves],
      { account: account.account },
    );
  }

  // ── Tests ────────────────────────────────────────────────────────────────────

  it("full happy-path session: start → play → submit → reward", async function () {
    const { game, token, alice } = await networkHelpers.loadFixture(deploy);

    const balanceBefore = await token.read.balanceOf([alice.account.address]);

    await startSession(game, alice);
    const session = await game.read.getSession([alice.account.address]);
    assert.equal(session.active, true);

    await submitScore(game, alice, 8000n, 512, 200n);

    const sessionAfter = await game.read.getSession([alice.account.address]);
    assert.equal(sessionAfter.active, false);

    const balanceAfter = await token.read.balanceOf([alice.account.address]);
    const REWARD_512 = await game.read.REWARD_512();
    const REWARD_256 = await game.read.REWARD_256();

    // Reaching 512 pays both the 512 and 256 tiers (first time)
    assert.equal(balanceAfter - balanceBefore, REWARD_512 + REWARD_256);
  });

  it("unverified player can play and score but receives no G$", async function () {
    const { game, token, identity, bob } = await networkHelpers.loadFixture(deploy);
    assert.equal(await identity.read.isWhitelisted([bob.account.address]), false);

    // Since V6 anyone can start a session; only rewards need verification.
    const balanceBefore  = await token.read.balanceOf([bob.account.address]);
    const treasuryBefore = await token.read.balanceOf([game.address]);
    await startSession(game, bob);
    assert.equal((await game.read.getSession([bob.account.address])).active, true);

    await submitScore(game, bob, 8000n, 512, 200n);

    assert.equal((await game.read.getSession([bob.account.address])).active, false);
    assert.equal(await game.read.bestScore([bob.account.address]), 8000n);
    assert.equal(await token.read.balanceOf([bob.account.address]), balanceBefore, "unverified player paid");
    assert.equal(await token.read.balanceOf([game.address]), treasuryBefore, "treasury moved");
    assert.equal(await game.read.claimedMilestones([bob.account.address]), 0);
  });

  it("rejects wrong seed on submitScore", async function () {
    const { game, alice } = await networkHelpers.loadFixture(deploy);

    await startSession(game, alice);

    const badSeed: `0x${string}` = "0x0000000000000000000000000000000000000000000000000000000000000001";
    await viem.assertions.revertWithCustomError(
      game.write.submitScore([1000n, 256, 100n, badSeed, 0n], { account: alice.account }),
      game,
      "InvalidSeed",
    );
  });

  it("session expires after timeout — submitScore reverts", async function () {
    const { game, alice } = await networkHelpers.loadFixture(deploy);

    await startSession(game, alice);

    const timeout = await game.read.SESSION_TIMEOUT();
    await networkHelpers.time.increase(Number(timeout) + 1);

    await viem.assertions.revertWithCustomError(
      game.write.submitScore([1000n, 256, 100n, SEED, 0n], { account: alice.account }),
      game,
      "SessionExpired",
    );
  });

  it("milestone rewards are paid only once per address", async function () {
    const { game, token, alice } = await networkHelpers.loadFixture(deploy);

    const before = await token.read.balanceOf([alice.account.address]);

    // First game — 256 tile, earns REWARD_256
    await startSession(game, alice);
    await submitScore(game, alice, 1000n, 256, 50n);
    const afterFirst = await token.read.balanceOf([alice.account.address]);
    assert.equal(afterFirst - before, await game.read.REWARD_256(), "first 256 not paid");

    // Second game — 256 tile again, no additional reward
    await startSession(game, alice);
    await submitScore(game, alice, 1200n, 256, 60n);
    const afterSecond = await token.read.balanceOf([alice.account.address]);

    assert.equal(afterSecond, afterFirst, "Reward claimed twice");
  });

  it("bestScore and bestTile are updated correctly", async function () {
    const { game, alice } = await networkHelpers.loadFixture(deploy);

    await startSession(game, alice);
    await submitScore(game, alice, 3000n, 512, 150n);

    assert.equal(await game.read.bestScore([alice.account.address]), 3000n);
    assert.equal(await game.read.bestTile([alice.account.address]), 512);

    // Second game with lower score — best values unchanged
    await startSession(game, alice);
    await submitScore(game, alice, 100n, 256, 20n);

    assert.equal(await game.read.bestScore([alice.account.address]), 3000n);
    assert.equal(await game.read.bestTile([alice.account.address]), 512);
  });

  it("third party can expire a timed-out session", async function () {
    const { game, alice, bob } = await networkHelpers.loadFixture(deploy);

    await startSession(game, alice);

    const timeout = await game.read.SESSION_TIMEOUT();
    await networkHelpers.time.increase(Number(timeout) + 1);

    // Bob (or anyone) cleans up alice's stuck session
    await game.write.expireSession([alice.account.address], { account: bob.account });

    const session = await game.read.getSession([alice.account.address]);
    assert.equal(session.active, false);
  });

  it("leaderboard stores submitted scores", async function () {
    const { game, alice } = await networkHelpers.loadFixture(deploy);

    await startSession(game, alice);
    await submitScore(game, alice, 9999n, 1024, 400n);

    const board = await game.read.getLeaderboard();
    const entry = board.find((e) => e.player.toLowerCase() === alice.account.address.toLowerCase());
    assert.ok(entry, "Alice not found on leaderboard");
    assert.equal(entry!.score, 9999n);
  });
});
