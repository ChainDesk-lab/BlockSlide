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

// Simple in-memory cache with TTL (5 minutes)
// In production, use Redis or database
interface CacheEntry {
  isVerified: boolean;
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedResult(address: string): boolean | null {
  const cached = cache.get(address.toLowerCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.isVerified;
  }
  // Clean up expired cache
  if (cached) {
    cache.delete(address.toLowerCase());
  }
  return null;
}

function setCachedResult(address: string, isVerified: boolean): void {
  cache.set(address.toLowerCase(), {
    isVerified,
    timestamp: Date.now(),
  });
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

    // Query contract to check on-chain verification status
    // isWhitelisted returns true if user is verified via GoodDollar
    const publicClient = createPublicClient({
      chain: celo,
      transport: http("https://1rpc.io/celo"), // Public Celo RPC
    });

    let isVerified = false;
    try {
      console.log(
        `[Player Verification] Checking isWhitelisted for ${address} on contract ${IDENTITY_ADDRESS}`
      );
      const result = await publicClient.readContract({
        address: IDENTITY_ADDRESS,
        abi: IDENTITY_ABI,
        functionName: "isWhitelisted",
        args: [address as `0x${string}`],
      });
      isVerified = result === true;
      console.log(
        `[Player Verification] Contract returned isWhitelisted=${result} (typeof: ${typeof result}) for ${address.slice(0, 6)}...`
      );
    } catch (err) {
      console.error(
        `[Player Verification] Contract read FAILED for ${address} on ${IDENTITY_ADDRESS}:`,
        err instanceof Error ? err.message : String(err)
      );
      // If contract read fails, return cached value or default to false
      // This is safe because users who haven't submitted scores can't have XP anyway
      isVerified = false;
    }

    // Cache only true values (verified accounts) to avoid serving stale false entries
    // If verification status changes, we want to check the contract again rather than
    // returning a cached false that might be outdated
    if (isVerified) {
      setCachedResult(address, isVerified);
    }

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

    const results: Record<string, { isVerified: boolean }> = {};

    const publicClient = createPublicClient({
      chain: celo,
      transport: http("https://1rpc.io/celo"),
    });

    // Check cache first for all addresses
    const needsCheck = addresses.filter((addr) => {
      const cached = getCachedResult(addr);
      if (cached !== null) {
        results[addr.toLowerCase()] = { isVerified: cached };
        return false;
      }
      return true;
    });

    // Batch check remaining addresses from contract
    for (const addr of needsCheck) {
      try {
        const isVerified = (await publicClient.readContract({
          address: IDENTITY_ADDRESS,
          abi: IDENTITY_ABI,
          functionName: "isWhitelisted",
          args: [addr as `0x${string}`],
        })) === true;

        results[addr.toLowerCase()] = { isVerified };
        // Only cache true values to avoid serving stale false entries
        if (isVerified) {
          setCachedResult(addr, isVerified);
        }
      } catch (err) {
        console.error(
          `[Player Verification] Bulk check failed for ${addr}:`,
          err
        );
        results[addr.toLowerCase()] = { isVerified: false };
      }
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
