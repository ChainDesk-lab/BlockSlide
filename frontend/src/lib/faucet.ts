/**
 * Tier 1 GoodDollar bootstrap faucet tracking.
 *
 * Lives outside app/api because a Next route module may only export route
 * handlers (GET/POST/…) and a fixed set of config values. Exporting a helper
 * such as `markFaucetUsed` from a route file fails the production build with
 * "does not match the required types of a Next.js Route".
 *
 * The server only records THAT a wallet used the faucet; the faucet call itself
 * happens client-side via the GoodDollar SDK.
 */
import { createClient } from "redis";

const REDIS_KEY_PREFIX = "gas:faucet:";
const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedisClient() {
  if (redisClient) return redisClient;

  try {
    redisClient = createClient({ url: process.env.REDIS_URL });

    redisClient.on("error", (err: Error) => {
      console.error("[Gas Tier1] Redis error:", err);
    });

    await redisClient.connect();
    return redisClient;
  } catch (err) {
    console.error("[Gas Tier1] Redis init failed:", err);
    redisClient = null;
    return null;
  }
}

/**
 * Whether `address` may still use the faucet. Fails OPEN: if Redis is
 * unreachable the caller is allowed to attempt the faucet, since the real
 * one-per-wallet constraint is enforced by GoodDollar, not by this cache.
 */
export async function canUseFaucet(address: string): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    if (!redis) {
      console.warn("[Gas Tier1] Redis unavailable, allowing faucet attempt");
      return true;
    }

    const key = `${REDIS_KEY_PREFIX}${address.toLowerCase()}`;
    const value = await redis.get(key);
    return value !== "true";
  } catch (err) {
    console.error("[Gas Tier1] Error checking faucet status:", err);
    return true;
  }
}

export async function markFaucetUsed(address: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    if (!redis) return;

    const key = `${REDIS_KEY_PREFIX}${address.toLowerCase()}`;
    const ttlSeconds = Math.ceil(FAUCET_COOLDOWN_MS / 1000);
    await redis.setEx(key, ttlSeconds, "true");
    console.log(`[Gas Tier1] ✅ Marked faucet as used for ${address.slice(0, 6)}...`);
  } catch (err) {
    console.error("[Gas Tier1] Error marking faucet as used:", err);
  }
}
