/**
 * The independent UBI reconciliation (scripts/lib/ubiReconcile.ts): first on
 * hand-built logs for every kind of mismatch, then on the logs a real Game2048
 * produces on Hardhat's simulated network, cross-checked against balances.
 * Needs the optimized build (Game2048 exceeds the simulator's size limit unoptimized):
 *   npx hardhat test nodejs --build-profile production
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, parseEther, type Address, type Hex } from "viem";
import { network } from "hardhat";

import { GAME_EVENTS_ABI, TRANSFER_ABI, expectedContribution, reconcileUbiContributions, type ChainLog } from "../scripts/lib/ubiReconcile.js";

const GAME = getAddress("0x00000000000000000000000000000000000000a1");
const TOKEN = getAddress("0x00000000000000000000000000000000000000b2");
const UBI = getAddress("0x00000000000000000000000000000000000000c3");
const BUYER = getAddress("0x00000000000000000000000000000000000000d4");
const OTHER = getAddress("0x00000000000000000000000000000000000000e5");
const cfg = { game: GAME, token: TOKEN, recipient: UBI };
const TX1 = `0x${"11".repeat(32)}` as Hex;
const TX2 = `0x${"22".repeat(32)}` as Hex;

const shield = (tx: Hex, i: number, price: bigint, buyer = BUYER): ChainLog => ({
  transactionHash: tx, logIndex: i, blockNumber: 1n, address: GAME,
  topics: encodeEventTopics({ abi: GAME_EVENTS_ABI, eventName: "ShieldPurchased", args: { player: buyer } }) as Hex[],
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, price]),
});
const ubiEvent = (tx: Hex, i: number, paid: bigint, contribution: bigint, recipient = UBI, buyer = BUYER): ChainLog => ({
  transactionHash: tx, logIndex: i, blockNumber: 1n, address: GAME,
  topics: encodeEventTopics({ abi: GAME_EVENTS_ABI, eventName: "UbiContribution", args: { buyer, item: 0, recipient } }) as Hex[],
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [0n, 1n, paid, contribution]),
});
const transfer = (tx: Hex, i: number, from: Address, to: Address, value: bigint): ChainLog => ({
  transactionHash: tx, logIndex: i, blockNumber: 1n, address: TOKEN,
  topics: encodeEventTopics({ abi: TRANSFER_ABI, eventName: "Transfer", args: { from, to } }) as Hex[],
  data: encodeAbiParameters([{ type: "uint256" }], [value]),
});
/** The logs one correct purchase leaves, in the order _collectPayment and buyStreakShield emit them. */
const goodPurchase = (tx: Hex, base: number, price: bigint): ChainLog[] => {
  const c = expectedContribution(price);
  return [transfer(tx, base, BUYER, GAME, price), transfer(tx, base + 1, GAME, UBI, c), ubiEvent(tx, base + 2, price, c), shield(tx, base + 3, price)];
};
const kinds = (r: ReturnType<typeof reconcileUbiContributions>) => r.discrepancies.map((d) => d.kind);

describe("UBI reconciliation: hand-built logs", () => {
  it("verifies correct purchases, two of them in one transaction", () => {
    const r = reconcileUbiContributions([...goodPurchase(TX1, 0, parseEther("500")), ...goodPurchase(TX2, 0, parseEther("150")), ...goodPurchase(TX2, 4, parseEther("1500"))], cfg);
    assert.deepEqual(kinds(r), []);
    assert.equal(r.purchases, 3);
    assert.equal(r.expected, parseEther("107.5"));
    assert.equal(r.verified, r.expected);
    assert.equal(r.recordedByEvents, r.expected);
    assert.equal(r.transferredToRecipient, r.expected);
    assert.equal(r.verifiedCount, 3);
  });

  it("rounds down, and expects nothing below 20 wei", () => {
    assert.equal(expectedContribution(39n), 1n);
    assert.equal(expectedContribution(19n), 0n);
    assert.equal(expectedContribution(parseEther("2.5")), parseEther("0.125"));
    const r = reconcileUbiContributions([transfer(TX1, 0, BUYER, GAME, 19n), shield(TX1, 1, 19n)], cfg);
    assert.deepEqual(kinds(r), []);
    assert.equal(r.purchases, 1);
    assert.equal(r.eligiblePurchases, 0);
  });

  it("counts a log read twice only once", () => {
    const logs = goodPurchase(TX1, 0, parseEther("500"));
    const r = reconcileUbiContributions([...logs, ...logs, ...logs], cfg);
    assert.deepEqual(kinds(r), []);
    assert.equal(r.duplicatesDropped, 8);
    assert.equal(r.verified, parseEther("25"));
  });

  it("flags a purchase with no contribution", () => {
    const r = reconcileUbiContributions([transfer(TX1, 0, BUYER, GAME, parseEther("500")), shield(TX1, 1, parseEther("500"))], cfg);
    assert.deepEqual(kinds(r), ["missing_contribution"]);
    assert.equal(r.verified, 0n);
  });

  it("flags an event whose G$ never moved", () => {
    const [pay, , ev, buy] = goodPurchase(TX1, 0, parseEther("500"));
    assert.deepEqual(kinds(reconcileUbiContributions([pay, ev, buy], cfg)), ["missing_transfer"]);
  });

  it("flags a wrong rate, a short transfer, a wrong recipient and a stray transfer", () => {
    const p = parseEther("500");
    assert.deepEqual(kinds(reconcileUbiContributions([transfer(TX1, 1, GAME, UBI, parseEther("20")), ubiEvent(TX1, 2, p, parseEther("20")), shield(TX1, 3, p)], cfg)), ["wrong_amount"]);
    assert.deepEqual(kinds(reconcileUbiContributions([transfer(TX1, 1, GAME, UBI, parseEther("24")), ubiEvent(TX1, 2, p, parseEther("25")), shield(TX1, 3, p)], cfg)), ["transfer_mismatch"]);
    assert.deepEqual(kinds(reconcileUbiContributions([transfer(TX1, 1, GAME, UBI, parseEther("25")), ubiEvent(TX1, 2, p, parseEther("25"), OTHER), shield(TX1, 3, p)], cfg)), ["wrong_recipient"]);
    assert.deepEqual(kinds(reconcileUbiContributions([transfer(TX1, 0, GAME, UBI, parseEther("5"))], cfg)), ["orphan_transfer"]);
    assert.deepEqual(kinds(reconcileUbiContributions([ubiEvent(TX1, 0, p, parseEther("25"))], cfg)), ["orphan_event"]);
  });

  it("flags two different logs claiming the same position", () => {
    const [a] = goodPurchase(TX1, 0, parseEther("500"));
    const forged = { ...a, data: encodeAbiParameters([{ type: "uint256" }], [1n]) };
    assert.ok(kinds(reconcileUbiContributions([...goodPurchase(TX1, 0, parseEther("500")), forged], cfg)).includes("duplicate_log"));
  });
});

describe("UBI reconciliation: logs from a real Game2048", async () => {
  const { viem } = await network.create();
  const pc = await viem.getPublicClient();
  const [owner, alice, bob, carol, ubi] = await viem.getWalletClients();

  const token = await viem.deployContract("MockERC20");
  const identity = await viem.deployContract("MockIdentity");
  const impl = await viem.deployContract("Game2048", [ubi.account.address]);
  const initData = encodeFunctionData({ abi: impl.abi, functionName: "initialize", args: [token.address, identity.address] });
  const proxy = await viem.deployContract("Game2048Proxy", [impl.address, initData]);
  const game = await viem.getContractAt("Game2048", proxy.address);
  // Odd prices on purpose, so rounding is exercised on every path.
  await game.write.setShopPrices([parseEther("500") + 7n, parseEther("1500") + 13n, parseEther("4000") + 1n, parseEther("100") + 3n]);
  await game.write.setCosmeticPrice([7n, parseEther("150") + 19n]);
  for (const w of [alice, bob]) {
    await token.write.mint([w.account.address, parseEther("1000000")]);
    await token.write.approve([game.address, 2n ** 255n], { account: w.account });
  }
  await token.write.mint([carol.account.address, parseEther("1000000")]); // never approves

  const start = await pc.getBlockNumber();
  await game.write.buyStreakShield({ account: alice.account });
  await game.write.buyXpBoost([2], { account: alice.account });
  await game.write.buyXpBoost([5], { account: bob.account });
  await game.write.buyUndoMove([3n], { account: bob.account });
  await game.write.buyCosmetic([7n], { account: alice.account });
  await assert.rejects(game.write.buyStreakShield({ account: carol.account })); // fails: no allowance
  await game.write.setShopPrices([19n, parseEther("1500"), parseEther("4000"), parseEther("100")]);
  await game.write.buyStreakShield({ account: bob.account }); // dust: rounds to 0, contributes nothing
  const end = await pc.getBlockNumber();

  const raw = [
    ...(await pc.getLogs({ address: game.address, events: GAME_EVENTS_ABI, fromBlock: start, toBlock: end })),
    ...(await pc.getLogs({ address: token.address, event: TRANSFER_ABI[0], args: { from: game.address, to: ubi.account.address }, fromBlock: start, toBlock: end })),
  ];
  const logs: ChainLog[] = raw.map((l) => ({
    transactionHash: l.transactionHash!, logIndex: l.logIndex!, blockNumber: l.blockNumber!, address: l.address, topics: l.topics, data: l.data,
  }));
  const config = { game: game.address, token: token.address, recipient: ubi.account.address };
  const prices = [parseEther("500") + 7n, parseEther("1500") + 13n, parseEther("4000") + 1n, (parseEther("100") + 3n) * 3n, parseEther("150") + 19n];
  const want = prices.reduce((s, p) => s + expectedContribution(p), 0n);

  it("reconciles every purchase, and matches the recipient's balance", async () => {
    const r = reconcileUbiContributions(logs, config);
    assert.deepEqual(r.discrepancies, []);
    assert.equal(r.purchases, 6); // five paid paths plus the dust purchase; the failed one left no logs
    assert.equal(r.eligiblePurchases, 5);
    assert.equal(r.expected, want);
    assert.equal(r.verified, want);
    assert.equal(r.recordedByEvents, want);
    assert.equal(await token.read.balanceOf([ubi.account.address]), want);
    assert.equal(r.paid, prices.reduce((s, p) => s + p, 0n) + 19n);
  });

  it("notices when a contribution's transfer is missing from the record", () => {
    const withoutTransfers = logs.filter((l) => getAddress(l.address) !== getAddress(token.address));
    const r = reconcileUbiContributions(withoutTransfers, config);
    assert.equal(r.discrepancies.filter((d) => d.kind === "missing_transfer").length, 5);
    assert.equal(r.verified, 0n);
  });

  it("is unaffected by reading every log twice, as the repeat-and-union scan does", () => {
    const r = reconcileUbiContributions([...logs, ...logs], config);
    assert.deepEqual(r.discrepancies, []);
    assert.equal(r.verified, want);
  });

  it("isn't fooled by the owner's treasury deposit or withdrawal", async () => {
    await token.write.mint([owner.account.address, parseEther("10")]);
    await token.write.approve([game.address, parseEther("10")]);
    const a = await pc.getBlockNumber();
    await game.write.fundTreasury([parseEther("10")]);
    await game.write.withdrawTreasury([parseEther("10")]);
    const b = await pc.getBlockNumber();
    const more = await pc.getLogs({ address: token.address, event: TRANSFER_ABI[0], args: { from: game.address, to: ubi.account.address }, fromBlock: a, toBlock: b });
    assert.equal(more.length, 0);
    assert.equal(await token.read.balanceOf([ubi.account.address]), want);
  });
});
