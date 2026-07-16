import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  XpEarned,
  UsernameSet,
  ScoreSubmitted,
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
