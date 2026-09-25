/**
 * Shared constants for the public stats page.
 *
 * Every number the page shows is derived from Celo mainnet event logs for the
 * game contract, NOT from the leaderboard subgraph. The subgraph only creates a
 * Player entity for some event types, so it undercounts real players (609 vs
 * 676 as of 24 Sep 2026). Chain logs are the only defensible source.
 */
import { getAddress, toEventSelector } from "viem";

export const GAME_ADDRESS = getAddress("0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6");
export const GDOLLAR_ADDRESS = getAddress("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
export const IDENTITY_ADDRESS = getAddress("0xc361a6e67822a0edc17d899227dd9fc50bd62f42");

/** Deployment block, verified by binary search on getBytecode. */
export const GENESIS_BLOCK = 69_294_066;

/** forno rejects ranges wider than this. */
export const MAX_RANGE = 5_000;

/**
 * Celo produces one block per second, so block number converts to wall time by
 * linear offset from a measured anchor. Verified against block timestamps to
 * the second; any drift is minutes over months, never days.
 */
export const ANCHOR_BLOCK = 78_384_272;
export const ANCHOR_TIME = Date.parse("2026-09-24T21:23:50Z") / 1000;

export function blockToUnix(block: number): number {
  return ANCHOR_TIME + (block - ANCHOR_BLOCK);
}

/** 1970-01-05 was a Monday; ISO weeks start Monday 00:00 UTC. */
const MONDAY_EPOCH = 345_600;
const WEEK = 604_800;

export function weekIndexOf(unix: number): number {
  return Math.floor((unix - MONDAY_EPOCH) / WEEK);
}
export function weekIndexToISO(index: number): string {
  return new Date((MONDAY_EPOCH + index * WEEK) * 1000).toISOString().slice(0, 10);
}
export const BASE_WEEK = weekIndexOf(blockToUnix(GENESIS_BLOCK));

/**
 * Player-bearing events, in mask-bit order. Both the legacy and the V6 shapes
 * of the shop events appear on chain because the proxy was upgraded in place,
 * so both must be counted.
 *
 * Only topic1 of THESE events is read as a wallet. That matters: the indexed
 * itemId on CosmeticCatalogUpdated is a small uint256 that pattern-matches an
 * address, and counting it inflates the wallet total. Keeping the allowlist
 * explicit makes that class of error impossible.
 */
const PLAYER_EVENT_SIGS: Array<[string, string[]]> = [
  ["UsernameSet", ["UsernameSet(address,string)"]],
  ["SessionStarted", ["SessionStarted(address)"]],
  ["ScoreSubmitted", ["ScoreSubmitted(address,uint256,uint32)"]],
  ["XpEarned", ["XpEarned(address,uint256,uint256)"]],
  ["StreakUpdated", ["StreakUpdated(address,uint256)"]],
  ["RewardPaid", ["RewardPaid(address,uint32,uint256)"]],
  ["XpBoostPurchased", ["XpBoostPurchased(address,uint8,uint64)", "XpBoostPurchased(address,uint8,uint64,uint256)"]],
  ["ShieldPurchased", ["ShieldPurchased(address,uint256)", "ShieldPurchased(address,uint256,uint256)"]],
  ["UndoPurchased", ["UndoPurchased(address,uint256,uint256)"]],
  ["UndoConsumed", ["UndoConsumed(address)"]],
  ["CosmeticPurchased", ["CosmeticPurchased(address,uint256,uint256)"]],
  ["ReferrerSet", ["ReferrerSet(address,address)"]],
];

export const PLAYER_EVENT_NAMES = PLAYER_EVENT_SIGS.map(([name]) => name);

/** topic0 -> { name, bit } for every player event shape. */
export const TOPIC_TO_EVENT: Record<string, { name: string; bit: number }> = {};
PLAYER_EVENT_SIGS.forEach(([name, sigs], bit) => {
  for (const sig of sigs) {
    TOPIC_TO_EVENT[toEventSelector(`event ${sig}`)] = { name, bit };
  }
});

export const EVENT_BIT: Record<string, number> = {};
PLAYER_EVENT_NAMES.forEach((name, bit) => { EVENT_BIT[name] = bit; });

export const ADDRESS_TOPIC = /^0x0{24}[0-9a-fA-F]{40}$/;
