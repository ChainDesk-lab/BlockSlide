import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
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
} from "../generated/Game2048/Game2048";
import { Player } from "../generated/schema";

function loadPlayer(addr: Address, ts: BigInt): Player {
  let p = Player.load(addr);
  if (p == null) {
    p = new Player(addr);
    p.xp = BigInt.zero();
    p.bestScore = BigInt.zero();
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
  }
  return p as Player;
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
