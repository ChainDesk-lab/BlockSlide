import { NextRequest, NextResponse } from "next/server";

/**
 * Game session seed storage API.
 * Server-side backup for seeds in case client storage (localStorage/IndexedDB) is lost.
 * Non-critical fallback — always returns gracefully, never blocks game submission.
 */

interface SeedRecord {
  address: string;
  seedHash: string;
  seed: string;
  createdAt: number;
  expiresAt: number; // 2 hour TTL (matches SESSION_TIMEOUT on contract)
}

// In-memory seed store (would be database in production)
// Key: `${address}_${seedHash}`
const seedStore = new Map<string, SeedRecord>();

const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours (matches contract)

/**
 * POST /api/game/seed
 * Store a game session seed for recovery if client storage is lost.
 *
 * Expected body: { address: string, seedHash: string, seed: string }
 * Returns: { success: boolean, message?: string }
 *
 * Non-critical endpoint — client calls this fire-and-forget after startSession.
 * If this endpoint fails, game continues normally (localStorage/IndexedDB fallback still works).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, seedHash, seed } = body;

    // Validate inputs
    if (!address || !seedHash || !seed) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: address, seedHash, seed" },
        { status: 400 }
      );
    }

    // Validate address format (basic check)
    if (!address.startsWith("0x") || address.length !== 42) {
      return NextResponse.json(
        { success: false, message: "Invalid address format" },
        { status: 400 }
      );
    }

    // Validate seed format
    if (!seed.startsWith("0x") || seed.length !== 66) {
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

    // Store seed (overwrites any existing record for this address_seedHash)
    seedStore.set(key, record);

    console.log(
      `[Seed API] Stored seed for ${address.slice(0, 6)}... (hash: ${seedHash.slice(0, 10)}...)`
    );

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    // Non-critical endpoint — log the error but don't fail the request
    console.error("[Seed API] POST error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/game/seed/[address]/[seedHash]
 * Recover a stored seed (called from submitScore recovery logic if client storage fails).
 *
 * Returns: { seed: string } on success, or 404 if seed not found/expired.
 *
 * This is a fallback path — only called if both localStorage and IndexedDB recovery fail.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const address = pathParts[pathParts.length - 2]; // Extract address from path
    const seedHash = pathParts[pathParts.length - 1]; // Extract seedHash from path

    if (!address || !seedHash) {
      return NextResponse.json(
        { message: "Missing address or seedHash" },
        { status: 400 }
      );
    }

    const key = `${address.toLowerCase()}_${seedHash}`;
    const record = seedStore.get(key);

    // Check if seed exists and hasn't expired
    if (!record || record.expiresAt < Date.now()) {
      if (record) {
        // Clean up expired record
        seedStore.delete(key);
      }
      return NextResponse.json({ message: "Seed not found or expired" }, { status: 404 });
    }

    console.log(
      `[Seed API] Recovered seed for ${address.slice(0, 6)}... (hash: ${seedHash.slice(0, 10)}...)`
    );

    return NextResponse.json({ seed: record.seed }, { status: 200 });
  } catch (error) {
    console.error("[Seed API] GET error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Cleanup: Remove expired seeds periodically (simple in-memory cleanup)
 * In production, this would be a database cleanup job.
 */
if (typeof global !== "undefined") {
  // Run cleanup every 30 minutes
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, record] of seedStore.entries()) {
      if (record.expiresAt < now) {
        seedStore.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[Seed API] Cleaned up ${cleaned} expired seed records`);
    }
  }, 30 * 60 * 1000);
}
