import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  XpEarned,
  UsernameSet,
  ScoreSubmitted,
  RewardPaid,
  ShieldPurchased,
  XpBoostPurchased,
  ReferrerSet,
  Game2048,
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

  // Calculate delta: the quantity purchased is the difference from last seen count
  let delta = event.params.count.minus(p.lastShieldCount);

  // Read shield price from contract at the event block
  let contract = Game2048.bind(event.address);
  let shieldPrice: BigInt;
  let priceCall = contract.try_shieldPrice();
  if (priceCall.reverted) {
    shieldPrice = BigInt.zero();
  } else {
    shieldPrice = priceCall.value;
  }

  // Add delta * price to totalGSpent
  let spend = delta.times(shieldPrice);
  p.totalGSpent = p.totalGSpent.plus(spend);

  // Update last seen count
  p.lastShieldCount = event.params.count;
  p.lastUpdated = event.block.timestamp;
  p.save();
}

export function handleXpBoostPurchased(event: XpBoostPurchased): void {
  let p = loadPlayer(event.params.player, event.block.timestamp);

  // Read boost price from contract, selected by multiplier
  let contract = Game2048.bind(event.address);
  let boostPrice: BigInt;

  let multiplier = event.params.multiplier;
  if (multiplier == 2) {
    let priceCall = contract.try_boost2xPrice();
    if (priceCall.reverted) {
      boostPrice = BigInt.zero();
    } else {
      boostPrice = priceCall.value;
    }
  } else if (multiplier == 5) {
    let priceCall = contract.try_boost5xPrice();
    if (priceCall.reverted) {
      boostPrice = BigInt.zero();
    } else {
      boostPrice = priceCall.value;
    }
  } else {
    boostPrice = BigInt.zero();
  }

  // Add price to totalGSpent
  p.totalGSpent = p.totalGSpent.plus(boostPrice);
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
