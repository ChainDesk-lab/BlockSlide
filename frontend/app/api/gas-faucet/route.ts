import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

/**
 * Server-side Gas Balance Checker
 *
 * GET: Check CELO balance (no faucet trigger)
 * POST: Disabled — faucet service removed due to reliability issues
 *
 * Bypasses client-side CORS restrictions by checking balance server-side.
 */

const LOW_GAS_THRESHOLD = 1_000_000_000_000_000n; // 0.001 CELO

interface GasCheckRequest {
  address: string;
}

interface GasCheckResponse {
  address: string;
  balance: string;
  balanceSufficient: boolean;
  error?: string;
}

/**
 * POST /api/gas-faucet
 * DEPRECATED: Gas faucet service has been disabled due to reliability issues.
 * Use GET endpoint instead to check balance only.
 */
export async function POST(request: NextRequest): Promise<NextResponse<GasCheckResponse>> {
  try {
    const body = (await request.json()) as GasCheckRequest;
    const { address } = body;

    if (!address || !address.startsWith("0x") || address.length !== 42) {
      return NextResponse.json(
        { error: "Invalid address format" } as any,
        { status: 400 }
      );
    }

    console.log(`[Gas Check] POST deprecated — faucet disabled, use GET for balance check`);

    // For backwards compatibility, check balance and return it
    const publicClient = createPublicClient({
      chain: celo,
      transport: http("https://forno.celo.org"),
    });

    let balance = 0n;
    try {
      balance = await publicClient.getBalance({ address: address as `0x${string}` });
    } catch (err) {
      console.error(`[Gas Check] Failed to fetch balance:`, err);
      return NextResponse.json(
        { error: "Could not fetch balance. Please try again." } as any,
        { status: 500 }
      );
    }

    const balanceSufficient = balance >= LOW_GAS_THRESHOLD;

    // If balance is sufficient, user can proceed with transaction
    if (balanceSufficient) {
      console.log(`[Gas Check] Sufficient balance for ${address.slice(0, 6)}...: ${balance.toLocaleString()} wei`);
      return NextResponse.json({
        address: address.toLowerCase(),
        balance: balance.toString(),
        balanceSufficient: true,
      });
    }

    // Balance is insufficient — user must manually top up
    console.log(`[Gas Check] Insufficient balance for ${address.slice(0, 6)}...: ${balance.toLocaleString()} wei (need ${LOW_GAS_THRESHOLD.toLocaleString()})`);
    return NextResponse.json({
      address: address.toLowerCase(),
      balance: balance.toString(),
      balanceSufficient: false,
      error: "Insufficient CELO balance for gas. Please top up your wallet.",
    });
  } catch (error) {
    console.error("[Gas Check] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" } as any,
      { status: 500 }
    );
  }
}

/**
 * GET /api/gas-faucet?address=0x...
 * Check CELO balance (no faucet trigger)
 */
export async function GET(request: NextRequest): Promise<NextResponse<GasCheckResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");

    if (!address || !address.startsWith("0x") || address.length !== 42) {
      return NextResponse.json(
        { error: "Invalid address parameter" } as any,
        { status: 400 }
      );
    }

    const publicClient = createPublicClient({
      chain: celo,
      transport: http("https://forno.celo.org"),
    });

    let balance = 0n;
    try {
      balance = await publicClient.getBalance({ address: address as `0x${string}` });
      console.log(`[Gas Check] Balance for ${address.slice(0, 6)}...: ${balance.toLocaleString()} wei`);
    } catch (err) {
      console.error(`[Gas Check] Failed to fetch balance:`, err);
      return NextResponse.json(
        { error: "Could not fetch balance. Please try again." } as any,
        { status: 500 }
      );
    }

    const balanceSufficient = balance >= LOW_GAS_THRESHOLD;
    return NextResponse.json(
      {
        address: address.toLowerCase(),
        balance: balance.toString(),
        balanceSufficient,
      },
      {
        headers: {
          "Cache-Control": "no-cache", // Balance changes frequently
        },
      }
    );
  } catch (error) {
    console.error("[Gas Check] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" } as any,
      { status: 500 }
    );
  }
}
