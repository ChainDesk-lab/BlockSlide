import { afterEach, assert, describe, newMockEvent, test, clearStore } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { ShieldPurchased, UbiContribution as UbiContributionEvent } from "../generated/Game2048/Game2048";
import { Player } from "../generated/schema";
import { G_DOLLAR, TRANSFER_TOPIC, handleShieldPurchased, handleUbiContribution } from "../src/mapping";

const GAME = Address.fromString("0xd551317265b9c4d1d453d399d8b8fa0b98d8ceb6");
const UBI = Address.fromString("0x43d72ff17701b2da814620735c39c620ce0ea4a1");
const ALICE = Address.fromString("0x000000000000000000000000000000000000a11c");
const BOB = Address.fromString("0x0000000000000000000000000000000000000b0b");
const OTHER = Address.fromString("0x0000000000000000000000000000000000000bad");
const TX1 = "0x1111111111111111111111111111111111111111111111111111111111111111";
const TX2 = "0x2222222222222222222222222222222222222222222222222222222222222222";
const G = BigInt.fromString("1000000000000000000"); // 1 G$ in wei

function g(n: i32): BigInt { return G.times(BigInt.fromI32(n)); }
function addressTopic(a: Address): Bytes {
  return Bytes.fromHexString("0x000000000000000000000000" + a.toHexString().slice(2));
}

/** A G$-style Transfer log. */
function transferLog(token: Address, from: Address, to: Address, value: BigInt, logIndex: i32): ethereum.Log {
  let data = ethereum.encode(ethereum.Value.fromUnsignedBigInt(value))!;
  return new ethereum.Log(token, [TRANSFER_TOPIC, addressTopic(from), addressTopic(to)], data,
    Bytes.fromHexString("0x00"), Bytes.fromHexString("0x01"), Bytes.fromHexString(TX1),
    BigInt.zero(), BigInt.fromI32(logIndex), BigInt.fromI32(logIndex), "", null);
}

function receiptWith(tx: string, logs: ethereum.Log[]): ethereum.TransactionReceipt {
  return new ethereum.TransactionReceipt(Bytes.fromHexString(tx), BigInt.zero(), Bytes.fromHexString("0x00"), BigInt.fromI32(1),
    BigInt.zero(), BigInt.zero(), Address.zero(), logs, BigInt.fromI32(1), Bytes.empty(), Bytes.empty());
}

function ubiEvent(buyer: Address, item: i32, quantity: i32, amountPaid: BigInt, contribution: BigInt,
                  tx: string, logIndex: i32, receipt: ethereum.TransactionReceipt | null): UbiContributionEvent {
  let e = changetype<UbiContributionEvent>(newMockEvent());
  e.address = GAME;
  e.logIndex = BigInt.fromI32(logIndex);
  e.transaction.hash = Bytes.fromHexString(tx);
  e.block.number = BigInt.fromI32(80_000_000);
  e.block.timestamp = BigInt.fromI32(1_790_000_000);
  e.parameters = [
    new ethereum.EventParam("buyer", ethereum.Value.fromAddress(buyer)),
    new ethereum.EventParam("item", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(item))),
    new ethereum.EventParam("itemId", ethereum.Value.fromUnsignedBigInt(BigInt.zero())),
    new ethereum.EventParam("quantity", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(quantity))),
    new ethereum.EventParam("amountPaid", ethereum.Value.fromUnsignedBigInt(amountPaid)),
    new ethereum.EventParam("contribution", ethereum.Value.fromUnsignedBigInt(contribution)),
    new ethereum.EventParam("recipient", ethereum.Value.fromAddress(UBI)),
  ];
  e.receipt = receipt;
  return e;
}

/** A purchase as _collectPayment emits it: buyer → game, game → UBI, then UbiContribution. */
function purchase(buyer: Address, price: BigInt, tx: string, firstLog: i32): UbiContributionEvent {
  let contribution = price.times(BigInt.fromI32(500)).div(BigInt.fromI32(10_000));
  let logs = [
    transferLog(G_DOLLAR, buyer, GAME, price, firstLog),
    transferLog(G_DOLLAR, GAME, UBI, contribution, firstLog + 1),
  ];
  return ubiEvent(buyer, 0, 1, price, contribution, tx, firstLog + 2, receiptWith(tx, logs));
}

function assertPlayer(a: Address, total: string, count: i32, unverified: string, unverifiedCount: i32): void {
  let id = a.toHexString();
  assert.fieldEquals("Player", id, "totalUbiContributed", total);
  assert.fieldEquals("Player", id, "ubiContributionCount", count.toString());
  assert.fieldEquals("Player", id, "totalUbiUnverified", unverified);
  assert.fieldEquals("Player", id, "ubiUnverifiedCount", unverifiedCount.toString());
}

afterEach(() => { clearStore(); });

describe("UbiContribution: verified totals per wallet", () => {
  test("one contribution is stored as emitted and counted", () => {
    handleUbiContribution(purchase(ALICE, g(25), TX1, 0)); // 25 G$ shield → 1.25 G$
    let id = TX1 + "-2";
    assert.entityCount("UbiContribution", 1);
    assert.fieldEquals("UbiContribution", id, "buyer", ALICE.toHexString());
    assert.fieldEquals("UbiContribution", id, "item", "0");
    assert.fieldEquals("UbiContribution", id, "quantity", "1");
    assert.fieldEquals("UbiContribution", id, "amountPaid", g(25).toString());
    assert.fieldEquals("UbiContribution", id, "contribution", "1250000000000000000");
    assert.fieldEquals("UbiContribution", id, "recipient", UBI.toHexString());
    assert.fieldEquals("UbiContribution", id, "transactionHash", TX1);
    assert.fieldEquals("UbiContribution", id, "logIndex", "2");
    assert.fieldEquals("UbiContribution", id, "blockNumber", "80000000");
    assert.fieldEquals("UbiContribution", id, "timestamp", "1790000000");
    assert.fieldEquals("UbiContribution", id, "transferVerified", "true");
    assert.fieldEquals("UbiContribution", id, "transferLogIndex", "1");
    assertPlayer(ALICE, "1250000000000000000", 1, "0", 0);
  });

  test("multiple contributions add up", () => {
    handleUbiContribution(purchase(ALICE, g(25), TX1, 0));  // 1.25
    handleUbiContribution(purchase(ALICE, g(120), TX2, 0)); // 6 (3 Undo credits)
    assertPlayer(ALICE, "7250000000000000000", 2, "0", 0);
  });

  test("two contributions in one transaction, different log indexes, each pairs with its own Transfer", () => {
    let logs = [
      transferLog(G_DOLLAR, ALICE, GAME, g(25), 0),
      transferLog(G_DOLLAR, GAME, UBI, g(25).div(BigInt.fromI32(20)), 1),
      transferLog(G_DOLLAR, ALICE, GAME, g(25), 3),
      transferLog(G_DOLLAR, GAME, UBI, g(25).div(BigInt.fromI32(20)), 4),
    ];
    let r = receiptWith(TX1, logs);
    handleUbiContribution(ubiEvent(ALICE, 0, 1, g(25), g(25).div(BigInt.fromI32(20)), TX1, 2, r));
    handleUbiContribution(ubiEvent(ALICE, 0, 1, g(25), g(25).div(BigInt.fromI32(20)), TX1, 5, r));
    assert.entityCount("UbiContribution", 2);
    assert.fieldEquals("UbiContribution", TX1 + "-2", "transferLogIndex", "1");
    assert.fieldEquals("UbiContribution", TX1 + "-5", "transferLogIndex", "4");
    assertPlayer(ALICE, "2500000000000000000", 2, "0", 0);
  });

  test("processing the same event twice counts it once", () => {
    let e = purchase(ALICE, g(25), TX1, 0);
    handleUbiContribution(e);
    handleUbiContribution(e);
    assert.entityCount("UbiContribution", 1);
    assertPlayer(ALICE, "1250000000000000000", 1, "0", 0);
  });

  test("each wallet only gets its own contributions", () => {
    handleUbiContribution(purchase(ALICE, g(25), TX1, 0));
    handleUbiContribution(purchase(BOB, g(125), TX2, 0)); // 6.25
    assertPlayer(ALICE, "1250000000000000000", 1, "0", 0);
    assertPlayer(BOB, "6250000000000000000", 1, "0", 0);
  });

  test("a zero contribution adds nothing and isn't counted", () => {
    handleUbiContribution(ubiEvent(ALICE, 0, 1, BigInt.fromI32(19), BigInt.zero(), TX1, 0, receiptWith(TX1, [])));
    assertPlayer(ALICE, "0", 0, "0", 0);
  });

  test("a 1-wei contribution is kept exactly (no rounding)", () => {
    let logs = [transferLog(G_DOLLAR, GAME, UBI, BigInt.fromI32(1), 0)];
    handleUbiContribution(ubiEvent(ALICE, 0, 1, BigInt.fromI32(20), BigInt.fromI32(1), TX1, 1, receiptWith(TX1, logs)));
    assertPlayer(ALICE, "1", 1, "0", 0);
  });
});

describe("UbiContribution: never counted without the G$ Transfer", () => {
  test("no receipt: recorded, unverified, not in the total", () => {
    handleUbiContribution(ubiEvent(ALICE, 0, 1, g(25), g(25).div(BigInt.fromI32(20)), TX1, 2, null));
    assert.fieldEquals("UbiContribution", TX1 + "-2", "transferVerified", "false");
    assertPlayer(ALICE, "0", 0, "1250000000000000000", 1);
  });

  test("a Transfer that doesn't match (token, sender, recipient or amount) doesn't verify", () => {
    let c = g(25).div(BigInt.fromI32(20));
    let wrong = [
      transferLog(OTHER, GAME, UBI, c, 0),                   // not G$
      transferLog(G_DOLLAR, ALICE, UBI, c, 1),               // not from the game
      transferLog(G_DOLLAR, GAME, OTHER, c, 2),              // not to the recipient
      transferLog(G_DOLLAR, GAME, UBI, c.plus(BigInt.fromI32(1)), 3), // wrong amount
    ];
    handleUbiContribution(ubiEvent(ALICE, 0, 1, g(25), c, TX1, 4, receiptWith(TX1, wrong)));
    assertPlayer(ALICE, "0", 0, c.toString(), 1);
  });

  test("a matching Transfer AFTER the event isn't evidence for it", () => {
    let c = g(25).div(BigInt.fromI32(20));
    handleUbiContribution(ubiEvent(ALICE, 0, 1, g(25), c, TX1, 1, receiptWith(TX1, [transferLog(G_DOLLAR, GAME, UBI, c, 2)])));
    assertPlayer(ALICE, "0", 0, c.toString(), 1);
  });
});

describe("existing player statistics are unchanged", () => {
  test("a purchase's G$ Spent counts the price once; UBI is tracked separately", () => {
    let s = changetype<ShieldPurchased>(newMockEvent());
    s.address = GAME;
    s.parameters = [
      new ethereum.EventParam("player", ethereum.Value.fromAddress(ALICE)),
      new ethereum.EventParam("count", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))),
      new ethereum.EventParam("pricePaid", ethereum.Value.fromUnsignedBigInt(g(25))),
    ];
    handleShieldPurchased(s);
    handleUbiContribution(purchase(ALICE, g(25), TX1, 0));
    let p = Player.load(ALICE)!;
    assert.bigIntEquals(g(25), p.totalGSpent);
    assert.bigIntEquals(BigInt.fromI32(1), p.lastShieldCount);
    assert.bigIntEquals(BigInt.zero(), p.totalGEarned);
    assert.bigIntEquals(BigInt.zero(), p.xp);
    assert.i32Equals(0, p.gamesPlayed);
    assertPlayer(ALICE, "1250000000000000000", 1, "0", 0);
  });

  test("a new player starts with zero UBI fields", () => {
    let s = changetype<ShieldPurchased>(newMockEvent());
    s.parameters = [
      new ethereum.EventParam("player", ethereum.Value.fromAddress(BOB)),
      new ethereum.EventParam("count", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))),
      new ethereum.EventParam("pricePaid", ethereum.Value.fromUnsignedBigInt(g(25))),
    ];
    handleShieldPurchased(s);
    assertPlayer(BOB, "0", 0, "0", 0);
  });
});
