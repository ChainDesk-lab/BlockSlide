import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  SessionStarted,
  XpEarned,
  UsernameSet,
  ScoreSubmitted,
  RewardPaid,
  ShieldPurchased,
  XpBoostPurchased,
  ReferrerSet,
  UndoPurchased,
  UndoConsumed,
  CosmeticPurchased,
  UbiContribution as UbiContributionEvent,
} from "../generated/Game2048/Game2048";
import { Player, UbiContribution } from "../generated/schema";

// G$ (SuperGoodDollar) on Celo: the token the game contract pays UBI in.
// The contract's token is owner-settable (setTokens); if it ever changes, this
// constant must change with it or new contributions stop verifying (they are
// then recorded as unverified, never counted).
export const G_DOLLAR = Address.fromString("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
// keccak256("Transfer(address,address,uint256)")
export const TRANSFER_TOPIC = Bytes.fromHexString("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");

function loadPlayer(addr: Address, ts: BigInt): Player {
  let p = Player.load(addr);
  if (p == null) {
    p = new Player(addr);
    p.xp = BigInt.zero();
    p.bestScore = BigInt.zero();
    p.gamesStarted = 0;
    p.gamesPlayed = 0;
    p.isVerified = false;
    p.firstSeen = ts;
    p.lastUpdated = ts;
    p.totalGEarned = BigInt.zero();
    p.totalGSpent = BigInt.zero();
    p.lastShieldCount = BigInt.zero();
    p.referralCount = BigInt.zero();
    p.undoCreditsPurchased = BigInt.zero();
    p.cosmeticsOwned = [];
    p.totalUbiContributed = BigInt.zero();
    p.ubiContributionCount = 0;
    p.totalUbiUnverified = BigInt.zero();
    p.ubiUnverifiedCount = 0;
  }
  return p as Player;
}

// Starting a game is the earliest on-chain signal that a wallet exists as a
// player. Indexing it means someone who begins a game but never submits a score
// (or never sets a username) still shows up in the Player count, instead of
// being invisible until they complete something.
export function handleSessionStarted(event: SessionStarted): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  p.gamesStarted = p.gamesStarted + 1;
  p.lastUpdated = event.block.timestamp;
  p.save();
}

// XpEarned carries the running cumulative total, so we set it directly.
export function handleXpEarned(event: XpEarned): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  p.xp = event.params.total;
  p.isVerified = true;
  p.lastUpdated = event.block.timestamp;
  p.save();
}

export function handleUsernameSet(event: UsernameSet): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  p.username = event.params.name;
  p.lastUpdated = event.block.timestamp;
  p.save();
}

export function handleScoreSubmitted(event: ScoreSubmitted): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  if (event.params.score.gt(p.bestScore)) {
    p.bestScore = event.params.score;
  }
  p.gamesPlayed = p.gamesPlayed + 1;
  p.lastUpdated = event.block.timestamp;
  p.save();
}

export function handleRewardPaid(event: RewardPaid): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  p.totalGEarned = p.totalGEarned.plus(event.params.amount);
  p.lastUpdated = event.block.timestamp;
  p.save();
}

export function handleShieldPurchased(event: ShieldPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // In V6+, pricePaid is emitted directly in the event
  let pricePaid = event.params.pricePaid;

  // Add total price paid to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(pricePaid);

  // Update last seen count
  p.lastShieldCount = event.params.count;
  p.lastUpdated = event.block.timestamp;
  p.save();
}

export function handleXpBoostPurchased(event: XpBoostPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // In V6+, pricePaid is emitted directly in the event
  let pricePaid = event.params.pricePaid;

  // Add price to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(pricePaid);
  p.lastUpdated = event.block.timestamp;
  p.save();
}

export function handleReferrerSet(event: ReferrerSet): void {
  // Update the player who was referred
  let player = loadPlayer(event.params.player, event.block.timestamp);
  player.referredBy = event.params.referrer;
  player.lastUpdated = event.block.timestamp;
  player.save();

  // Increment the referrer's count
  let referrer = loadPlayer(event.params.referrer, event.block.timestamp);
  referrer.referralCount = referrer.referralCount.plus(BigInt.fromI32(1));
  referrer.lastUpdated = event.block.timestamp;
  referrer.save();
}

export function handleUndoPurchased(event: UndoPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // Add quantity to total undo credits purchased
  p.undoCreditsPurchased = p.undoCreditsPurchased.plus(event.params.quantity);

  // Add total amount paid to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(event.params.pricePaid);
  p.lastUpdated = event.block.timestamp;
  p.save();
}

export function handleUndoConsumed(event: UndoConsumed): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);
  p.lastUpdated = event.block.timestamp;
  p.save();
}

export function handleCosmeticPurchased(event: CosmeticPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // Track cosmetic ownership
  let cosmetics = p.cosmeticsOwned;
  let itemId = event.params.itemId.toI32();

  // Add itemId if not already owned
  if (!cosmetics.includes(itemId)) {
    cosmetics.push(itemId);
  }
  p.cosmeticsOwned = cosmetics;

  // Add amount paid to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(event.params.pricePaid);
  p.lastUpdated = event.block.timestamp;
  p.save();
}

/**
 * Index into the receipt's logs of the G$ Transfer that paid this
 * contribution, or -1 if there is none (or no receipt).
 *
 * Evidence is the token's own log, not ours: in the same transaction, a G$
 * Transfer from the game contract to the event's recipient for exactly the
 * event's contribution. _collectPayment emits that Transfer just before
 * UbiContribution, so the closest preceding match is taken; with two
 * contributions in one transaction, each pairs with its own Transfer.
 */
export function findUbiTransfer(event: UbiContributionEvent): i32 {
  let receipt = event.receipt;
  if (receipt === null) return -1;
  let logs = receipt.logs;
  let best = -1;
  for (let i = 0; i < logs.length; i++) {
    let log = logs[i];
    if (!log.logIndex.lt(event.logIndex)) continue;
    if (!log.address.equals(G_DOLLAR)) continue;
    if (log.topics.length != 3) continue;
    if (!log.topics[0].equals(TRANSFER_TOPIC)) continue;
    if (!topicAddress(log.topics[1]).equals(event.address)) continue;
    if (!topicAddress(log.topics[2]).equals(event.params.recipient)) continue;
    if (log.data.length != 32) continue;
    if (!uint256Of(log.data).equals(event.params.contribution)) continue;
    if (best == -1 || log.logIndex.gt(logs[best].logIndex)) best = i;
  }
  return best;
}

/** A 32-byte big-endian word as a BigInt, without modifying `word` (reverse() is in place). */
function uint256Of(word: Bytes): BigInt {
  let le = Bytes.fromUint8Array(word.slice(0));
  le.reverse();
  return BigInt.fromUnsignedBytes(le);
}

/** The address in an indexed address topic (its last 20 of 32 bytes). */
function topicAddress(topic: Bytes): Address {
  return changetype<Address>(Bytes.fromUint8Array(topic.subarray(12, 32)));
}

// One record per event (id = transactionHash-logIndex), stored as emitted. The
// player's total only grows when the G$ Transfer is found; otherwise the event
// is kept and counted as unverified, so nothing is lost and nothing is assumed.
export function handleUbiContribution(event: UbiContributionEvent): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  // Already recorded: processing the same event again must not count it twice.
  if (UbiContribution.load(id) != null) return;

  let transferAt = findUbiTransfer(event);
  let verified = transferAt >= 0;
  let amount = event.params.contribution;

  let c = new UbiContribution(id);
  c.buyer = event.params.buyer;
  c.item = event.params.item;
  c.itemId = event.params.itemId;
  c.quantity = event.params.quantity;
  c.amountPaid = event.params.amountPaid;
  c.contribution = amount;
  c.recipient = event.params.recipient;
  c.transactionHash = event.transaction.hash;
  c.logIndex = event.logIndex;
  c.blockNumber = event.block.number;
  c.timestamp = event.block.timestamp;
  c.transferVerified = verified;
  if (verified) c.transferLogIndex = (event.receipt as ethereum.TransactionReceipt).logs[transferAt].logIndex;
  c.save();

  let p = loadPlayer(event.params.buyer, event.block.timestamp);
  // The contract emits nothing for a contribution that rounds to zero; a zero
  // here would add nothing, so it isn't counted as a contribution either.
  if (amount.gt(BigInt.zero())) {
    if (verified) {
      p.totalUbiContributed = p.totalUbiContributed.plus(amount);
      p.ubiContributionCount = p.ubiContributionCount + 1;
    } else {
      p.totalUbiUnverified = p.totalUbiUnverified.plus(amount);
      p.ubiUnverifiedCount = p.ubiUnverifiedCount + 1;
    }
  }
  p.lastUpdated = event.block.timestamp;
  p.save();
}
