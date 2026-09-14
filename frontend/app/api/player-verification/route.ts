import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { IDENTITY_ADDRESS } from "../../../src/lib/constants";

/**
 * Player Verification Reconciliation Endpoint
 *
 * Returns authoritative isVerified status by checking:
 * 1. On-chain verification status via GoodDollar identity registry
 * 2. Score history (players who submitted scores are implicitly verified)
 *
 * This endpoint provides the single source of truth for leaderboard verification badges,
 * alongside a fallback to XP history to ensure we never show all users as unverified
 * if the endpoint becomes unreliable.
 *
 * RPC Strategy:
 * - Primary: https://forno.celo.org (Celo's official endpoint, most reliable)
 * - Fallback: https://rpc.ankr.com/celo (Ankr backup, no aggressive rate limits)
 * - Both are free tiers suitable for public usage without credentials
 *
 * Rate limits:
 * - forno.celo.org: ~300 requests/min per IP (no official docs, observed limit)
 * - ankr.com: Free tier ~1000 req/min (higher than 1rpc.io which was causing failures)
 */
const IDENTITY_ABI = [
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "isWhitelisted",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// RPC endpoints: primary + fallback
const RPC_PRIMARY = "https://forno.celo.org";
const RPC_FALLBACK = "https://rpc.ankr.com/celo";

/**
 * Try to check isWhitelisted on a single RPC endpoint
 * Returns { success: true, result: boolean } or { success: false, error: string }
 */
async function checkWhitelistOnRpc(
  rpcUrl: string,
  address: `0x${string}`
): Promise<{ success: boolean; result?: boolean; error?: string }> {
  try {
    const client = createPublicClient({
      chain: celo,
      transport: http(rpcUrl),
    });
    const result = await client.readContract({
      address: IDENTITY_ADDRESS,
      abi: IDENTITY_ABI,
      functionName: "isWhitelisted",
      args: [address],
    });
    return { success: true, result: result === true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check isWhitelisted with fallback RPC support
 * Tries primary RPC first, falls back to secondary if primary fails
 * Returns { isVerified: boolean } on success, or { isVerified: null } if both fail
 */
async function checkWhitelistWithFallback(
  address: `0x${string}`
): Promise<{ isVerified: boolean | null; rpcUsed?: string; error?: string }> {
  // Try primary RPC
  const primaryResult = await checkWhitelistOnRpc(RPC_PRIMARY, address);
  if (primaryResult.success && primaryResult.result !== undefined) {
    return { isVerified: primaryResult.result, rpcUsed: "primary" };
  }

  console.warn(
    `[Player Verification] Primary RPC failed for ${address.slice(0, 6)}, trying fallback: ${primaryResult.error}`
  );

  // Try fallback RPC
  const fallbackResult = await checkWhitelistOnRpc(RPC_FALLBACK, address);
  if (fallbackResult.success && fallbackResult.result !== undefined) {
    return { isVerified: fallbackResult.result, rpcUsed: "fallback" };
  }

  // Both RPCs failed
  const errorMsg = `Both RPC endpoints failed. Primary: ${primaryResult.error}, Fallback: ${fallbackResult.error}`;
  console.error(
    `[Player Verification] CRITICAL: Both RPCs failed for ${address.slice(0, 6)}: ${errorMsg}`
  );

  return { isVerified: null, error: errorMsg };
}

// Simple in-memory cache with TTL.
// In production, use Redis or database.
interface CacheEntry {
  isVerified: boolean;
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();

// `false` is cached too, just briefly. Caching only `true` meant every
// leaderboard load re-queried every unverified wallet — the large majority of
// the board — which is what made whole-board verification too slow to attempt.
// A short TTL keeps a newly-verified user from waiting long to see their badge.
const CACHE_TTL_TRUE_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_TTL_FALSE_MS = 2 * 60 * 1000; // 2 minutes

function getCachedResult(address: string): boolean | null {
  const cached = cache.get(address.toLowerCase());
  if (!cached) return null;
  const ttl = cached.isVerified ? CACHE_TTL_TRUE_MS : CACHE_TTL_FALSE_MS;
  if (Date.now() - cached.timestamp < ttl) return cached.isVerified;
  cache.delete(address.toLowerCase());
  return null;
}

function setCachedResult(address: string, isVerified: boolean): void {
  cache.set(address.toLowerCase(), {
    isVerified,
    timestamp: Date.now(),
  });
}

/** Resolve tasks with bounded concurrency, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * GET /api/player-verification/:address
 * Returns { isVerified: boolean } for the given wallet address
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { address?: string } }
) {
  try {
    const address = params?.address;

    if (!address) {
      return NextResponse.json(
        { error: "Missing address parameter" },
        { status: 400 }
      );
    }

    // Validate address format
    if (!address.startsWith("0x") || address.length !== 42) {
      return NextResponse.json(
        { error: "Invalid address format" },
        { status: 400 }
      );
    }

    // Check cache first
    const cached = getCachedResult(address);
    if (cached !== null) {
      console.log(
        `[Player Verification] Cache hit for ${address.slice(0, 6)}... = ${cached}`
      );
      return NextResponse.json(
        { isVerified: cached },
        {
          status: 200,
          headers: {
            "Cache-Control": "public, max-age=300", // 5 minutes
          },
        }
      );
    }

    // Query contract with RPC fallback support
    console.log(
      `[Player Verification] Checking isWhitelisted for ${address.slice(0, 6)}...`
    );

    const checkResult = await checkWhitelistWithFallback(
      address as `0x${string}`
    );

    // If both RPCs failed, return 503 error instead of silently defaulting to false
    if (checkResult.isVerified === null) {
      console.error(
        `[Player Verification] ALERT: Both RPC endpoints failed for ${address.slice(0, 6)}... - ${checkResult.error}`
      );
      return NextResponse.json(
        {
          error: "Verification service temporarily unavailable",
          unavailable: true,
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-cache", // Don't cache failures
          },
        }
      );
    }

    const isVerified = checkResult.isVerified;
    console.log(
      `[Player Verification] Result for ${address.slice(0, 6)}... = ${isVerified} (RPC: ${checkResult.rpcUsed})`
    );

    // Both outcomes are cached; `false` carries a shorter TTL so a freshly
    // verified user still sees their badge promptly.
    setCachedResult(address, isVerified);

    console.log(
      `[Player Verification] Checked ${address.slice(0, 6)}... = ${isVerified}${isVerified ? " (cached)" : " (not cached)"}`
    );

    return NextResponse.json(
      { isVerified },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=300", // 5 minutes
        },
      }
    );
  } catch (error) {
    console.error("[Player Verification] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/player-verification (bulk)
 * Accept a list of addresses and return verification status for all
 * Useful for efficiently verifying a full leaderboard page at once
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { addresses?: string[] };
    const { addresses } = body;

    if (!addresses || !Array.isArray(addresses)) {
      return NextResponse.json(
        { error: "Missing addresses array" },
        { status: 400 }
      );
    }

    if (addresses.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 addresses per request" },
        { status: 400 }
      );
    }

    const results: Record<string, { isVerified: boolean | null }> = {};
    const unavailableAddresses: string[] = [];

    // Check cache first for all addresses
    const needsCheck = addresses.filter((addr) => {
      const cached = getCachedResult(addr);
      if (cached !== null) {
        results[addr.toLowerCase()] = { isVerified: cached };
        return false;
      }
      return true;
    });

    // Check remaining addresses concurrently. These were sequential, so a full
    // page of cache misses took one round-trip per address and routinely ran
    // past the function timeout; the board could never verify itself in one go.
    const checked = await mapWithConcurrency(needsCheck, 15, (addr) =>
      checkWhitelistWithFallback(addr as `0x${string}`)
    );

    needsCheck.forEach((addr, i) => {
      const checkResult = checked[i];
      if (checkResult.isVerified === null) {
        // Both RPCs failed for this address
        console.warn(
          `[Player Verification] Verification unavailable for ${addr.slice(0, 6)}... in bulk check`
        );
        unavailableAddresses.push(addr);
        results[addr.toLowerCase()] = { isVerified: null }; // Explicitly null, not false
      } else {
        results[addr.toLowerCase()] = { isVerified: checkResult.isVerified };
        setCachedResult(addr, checkResult.isVerified);
      }
    });

    // If any addresses were unavailable, log it prominently
    if (unavailableAddresses.length > 0) {
      console.error(
        `[Player Verification] ALERT: ${unavailableAddresses.length}/${needsCheck.length} addresses unavailable in bulk check: ${unavailableAddresses.slice(0, 3).map(a => a.slice(0, 6)).join(", ")}...`
      );
    }

    console.log(
      `[Player Verification] Bulk check: ${addresses.length} addresses, ${needsCheck.length} cache misses`
    );

    return NextResponse.json(
      { results },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=300",
        },
      }
    );
  } catch (error) {
    console.error("[Player Verification] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
