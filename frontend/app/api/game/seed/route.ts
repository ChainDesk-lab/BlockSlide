import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";

/**
 * Game session seed storage API.
 * Server-side backup for seeds in case client storage (localStorage/IndexedDB) is lost.
 * Non-critical fallback — always returns gracefully, never blocks game submission.
 *
 * CRITICAL FIX (2026-08-26): Changed from in-memory Map to Redis (via Vercel Marketplace)
 * for production-safe persistent storage. File-based approach doesn't work on Vercel's
 * ephemeral filesystem. Redis persists across deployments and instances.
 */

interface SeedRecord {
  address: string;
  seedHash: string;
  seed: string;
  createdAt: number;
  expiresAt: number; // 2 hour TTL (matches SESSION_TIMEOUT on contract)
}

const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours (matches contract)
const SESSION_TIMEOUT_SECONDS = Math.ceil(SESSION_TIMEOUT_MS / 1000);
const REDIS_KEY_PREFIX = "game:seed:";

let redisClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize Redis client (singleton pattern)
 */
async function getRedisClient() {
  if (redisClient) return redisClient;

  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
    });

    redisClient.on("error", (err: Error) => {
      console.error("[Seed API Redis] Client error:", err);
    });

    await redisClient.connect();
    console.log("[Seed API Redis] Connected to Redis");
    return redisClient;
  } catch (err) {
    console.error("[Seed API Redis] Failed to initialize client:", err);
    return null;
  }
}

/**
 * Get a seed from Redis by key
 */
async function getSeedFromRedis(key: string): Promise<SeedRecord | null> {
  try {
    const client = await getRedisClient();
    if (!client) return null;

    const value = await client.get(`${REDIS_KEY_PREFIX}${key}`);
    return value ? (JSON.parse(value) as SeedRecord) : null;
  } catch (err) {
    console.error(`[Seed API Redis] Failed to read seed ${key}:`, err);
    return null;
  }
}

/**
 * Store a seed in Redis with TTL
 */
async function setSeedInRedis(key: string, record: SeedRecord): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) return false;

    // Store with TTL so old seeds auto-expire (Redis handles cleanup)
    await client.setEx(`${REDIS_KEY_PREFIX}${key}`, SESSION_TIMEOUT_SECONDS, JSON.stringify(record));
    return true;
  } catch (err) {
    console.error(`[Seed API Redis] Failed to write seed ${key}:`, err);
    return false;
  }
}

/**
 * POST /api/game/seed
 * Store a game session seed for recovery if client storage is lost.
 *
 * Expected body: { address: string, seedHash: string, seed: string }
 * Returns: { success: boolean, message?: string }
 *
 * CRITICAL FIX (2026-08-26): Now persists to Upstash Redis (via Vercel Marketplace), not in-memory.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, seedHash, seed } = body;

    // Validate inputs
    if (!address || !seedHash || !seed) {
      console.warn("[Seed API POST] Missing required fields:", { address: !!address, seedHash: !!seedHash, seed: !!seed });
      return NextResponse.json(
        { success: false, message: "Missing required fields: address, seedHash, seed" },
        { status: 400 }
      );
    }

    // Validate address format (basic check)
    if (!address.startsWith("0x") || address.length !== 42) {
      console.warn("[Seed API POST] Invalid address format:", { address });
      return NextResponse.json(
        { success: false, message: "Invalid address format" },
        { status: 400 }
      );
    }

    // Validate seed format
    if (!seed.startsWith("0x") || seed.length !== 66) {
      console.warn("[Seed API POST] Invalid seed format:", { seed: seed.slice(0, 20) });
      return NextResponse.json(
        { success: false, message: "Invalid seed format" },
        { status: 400 }
      );
    }

    const key = `${address.toLowerCase()}_${seedHash}`;
    const now = Date.now();

    const record: SeedRecord = {
      address: address.toLowerCase(),
      seedHash,
      seed,
      createdAt: now,
      expiresAt: now + SESSION_TIMEOUT_MS,
    };

    // Store in Upstash Redis with automatic TTL expiration
    const success = await setSeedInRedis(key, record);

    if (success) {
      console.log(
        `[Seed API POST] ✓ Seed persisted for ${address.slice(0, 6)}... (hash: ${seedHash.slice(0, 10)}...)`
      );
      return NextResponse.json({ success: true }, { status: 201 });
    } else {
      console.error("[Seed API POST] Failed to persist seed to Redis");
      // Non-critical endpoint — still return success so client continues
      // (localStorage/IndexedDB fallback will still work)
      return NextResponse.json(
        { success: false, message: "Failed to persist seed" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[Seed API POST] Error:", error);
    // Non-critical endpoint — still return success so client continues
    // (localStorage/IndexedDB fallback will still work)
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/game/seed?address=0x...&seedHash=0x...
 * Recover a stored seed (called from submitScore recovery logic if client storage fails).
 *
 * Returns: { seed: string } on success, or 404 if seed not found/expired.
 *
 * CRITICAL FIX (2026-08-26): Now reads from Upstash Redis (via Vercel Marketplace).
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);

    // Try query params first, then fall back to path params
    let address = url.searchParams.get("address");
    let seedHash = url.searchParams.get("seedHash");

    // If not in query params, try path params (for backward compatibility)
    if (!address || !seedHash) {
      const pathParts = url.pathname.split("/");
      address = address || pathParts[pathParts.length - 2];
      seedHash = seedHash || pathParts[pathParts.length - 1];
    }

    if (!address || !seedHash) {
      console.warn("[Seed API GET] Missing address or seedHash");
      return NextResponse.json(
        { message: "Missing address or seedHash" },
        { status: 400 }
      );
    }

    const key = `${address.toLowerCase()}_${seedHash}`;
    const record = await getSeedFromRedis(key);

    // Check if seed exists
    if (!record) {
      console.log("[Seed API GET] Seed not found", { address: address.slice(0, 6), seedHash: seedHash.slice(0, 10) });
      return NextResponse.json({ message: "Seed not found" }, { status: 404 });
    }

    // Check expiration (Redis TTL should handle this, but verify anyway)
    if (record.expiresAt < Date.now()) {
      console.log("[Seed API GET] Seed expired", { address: address.slice(0, 6), seedHash: seedHash.slice(0, 10) });
      return NextResponse.json({ message: "Seed expired" }, { status: 404 });
    }

    console.log(
      `[Seed API GET] ✓ Seed recovered for ${address.slice(0, 6)}... (hash: ${seedHash.slice(0, 10)}...)`
    );

    return NextResponse.json({ seed: record.seed }, { status: 200 });
  } catch (error) {
    console.error("[Seed API GET] Error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
