import type { PublicClient } from "viem";

interface BlockCache {
  [timestamp: string]: bigint; // ISO timestamp -> block number
}

const blockCache: BlockCache = {};

/**
 * Resolve the block number whose timestamp is closest to the target time.
 * Uses binary search with viem's getBlock. Results are cached in memory.
 */
export async function resolveBlockByTime(
  publicClient: PublicClient,
  targetTime: Date
): Promise<bigint> {
  const isoTime = targetTime.toISOString();

  // Check cache first
  if (blockCache[isoTime]) {
    return blockCache[isoTime];
  }

  const targetTimestamp = Math.floor(targetTime.getTime() / 1000); // Unix timestamp in seconds

  // Binary search bounds: current block and a historical guess
  // Start with a large upper bound (millions of blocks back)
  let left = 0n;
  let right = 100_000_000n; // ~3 years of blocks on Celo (~5s blocks)

  // Find a valid upper bound first (binary search on the right side)
  while (left < right) {
    const mid = (left + right) / 2n;
    try {
      const block = await publicClient.getBlock({ blockNumber: mid });
      if (block.timestamp < BigInt(targetTimestamp)) {
        left = mid + 1n;
      } else {
        right = mid;
      }
    } catch {
      // Block doesn't exist yet, search lower
      right = mid;
    }
  }

  // left is now the closest block >= target time
  // Check if left or left-1 is closer to target
  let resultBlock = left;
  try {
    const blockAtLeft = await publicClient.getBlock({ blockNumber: left });
    if (left > 0n) {
      const blockAtLeftMinus1 = await publicClient.getBlock({ blockNumber: left - 1n });
      const diffLeft = Math.abs(Number(blockAtLeft.timestamp) - targetTimestamp);
      const diffLeftMinus1 = Math.abs(Number(blockAtLeftMinus1.timestamp) - targetTimestamp);
      if (diffLeftMinus1 < diffLeft) {
        resultBlock = left - 1n;
      }
    }
  } catch {
    // Use left as-is
  }

  blockCache[isoTime] = resultBlock;
  return resultBlock;
}

const firstBlockCache = new Map<string, bigint>();

/**
 * The first block whose timestamp is at or after `time`: exact, not the nearest block (compare
 * resolveBlockByTime above, which the original bounties keep using). A window that starts
 * inclusive and ends exclusive, [start, end), covers the blocks from firstBlockAtOrAfter(start)
 * to firstBlockAtOrAfter(end) - 1. Block timestamps are whole seconds, so a time with
 * milliseconds rounds up. Throws if the chain hasn't reached `time` yet. Cached in memory.
 */
export async function firstBlockAtOrAfter(publicClient: PublicClient, time: Date): Promise<bigint> {
  const key = time.toISOString();
  const hit = firstBlockCache.get(key);
  if (hit !== undefined) return hit;
  const target = BigInt(Math.ceil(time.getTime() / 1000));
  const head = await publicClient.getBlock();
  if (head.number === null || head.timestamp < target) throw new Error(`the chain hasn't reached ${key} yet`);
  let lo = 0n;
  let hi = head.number; // the head is at or after the target, so the answer is at or below it
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const block = await publicClient.getBlock({ blockNumber: mid });
    if (block.timestamp < target) lo = mid + 1n;
    else hi = mid;
  }
  firstBlockCache.set(key, lo);
  return lo;
}

/**
 * Clear the in-memory block caches (useful for testing).
 */
export function clearBlockCache() {
  Object.keys(blockCache).forEach((key) => delete blockCache[key]);
  firstBlockCache.clear();
}
