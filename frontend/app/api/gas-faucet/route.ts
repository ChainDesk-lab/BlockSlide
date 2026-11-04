import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { defaultRequiredWei, parseMinWei } from "../../../src/lib/gasPlan";

/**
 * Server-side Gas Balance Checker
 *
 * GET: Check CELO balance (no faucet trigger)
 * POST: Disabled — faucet service removed due to reliability issues
 *
 * Bypasses client-side CORS restrictions by checking balance server-side.
 *
 * "Sufficient" means the balance covers the transaction about to be sent:
 *   - `minWei` (query param or body field): the caller's own requirement,
 *     gas limit × fee cap from src/lib/gasPlan.ts — the app always sends it;
 *   - otherwise DEFAULT_GAS_BUDGET (250k gas) at the live gas price + 20%.
 * It used to be a fixed 0.001 CELO, which at Celo's ~200 gwei base fee pays
 * for about 5,000 gas — less than any BlockSlide transaction.
 */

/** The balance to require: the caller's, or the default budget at live fees. */
async function requiredWeiFor(
  publicClient: { getGasPrice(): Promise<bigint> },
  minWeiRaw: string | null | undefined
): Promise<bigint> {
  const fromCaller = parseMinWei(minWeiRaw);
  if (fromCaller !== null) return fromCaller;
  return defaultRequiredWei(await publicClient.getGasPrice());
}

interface GasCheckRequest {
  address: string;
  minWei?: string;
}

interface GasCheckResponse {
  address: string;
  balance: string;
  balanceSufficient: boolean;
  /** The requirement the balance was compared against, in wei. */
  requiredWei: string;
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
    let requiredWei: bigint;
    try {
      [balance, requiredWei] = await Promise.all([
        publicClient.getBalance({ address: address as `0x${string}` }),
        requiredWeiFor(publicClient, body.minWei),
      ]);
    } catch (err) {
      console.error(`[Gas Check] Failed to fetch balance or fees:`, err);
      return NextResponse.json(
        { error: "Could not fetch balance. Please try again." } as any,
        { status: 500 }
      );
    }

    const balanceSufficient = balance >= requiredWei;

    // If balance is sufficient, user can proceed with transaction
    if (balanceSufficient) {
      console.log(`[Gas Check] Sufficient balance for ${address.slice(0, 6)}...: ${balance.toLocaleString()} wei`);
      return NextResponse.json({
        address: address.toLowerCase(),
        balance: balance.toString(),
        balanceSufficient: true,
        requiredWei: requiredWei.toString(),
      });
    }

    // Balance is insufficient — user must manually top up
    console.log(`[Gas Check] Insufficient balance for ${address.slice(0, 6)}...: ${balance.toLocaleString()} wei (need ${requiredWei.toLocaleString()})`);
    return NextResponse.json({
      address: address.toLowerCase(),
      balance: balance.toString(),
      balanceSufficient: false,
      requiredWei: requiredWei.toString(),
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
    let requiredWei: bigint;
    try {
      [balance, requiredWei] = await Promise.all([
        publicClient.getBalance({ address: address as `0x${string}` }),
        requiredWeiFor(publicClient, searchParams.get("minWei")),
      ]);
      console.log(`[Gas Check] Balance for ${address.slice(0, 6)}...: ${balance.toLocaleString()} wei (need ${requiredWei.toLocaleString()})`);
    } catch (err) {
      console.error(`[Gas Check] Failed to fetch balance or fees:`, err);
      return NextResponse.json(
        { error: "Could not fetch balance. Please try again." } as any,
        { status: 500 }
      );
    }

    const balanceSufficient = balance >= requiredWei;
    return NextResponse.json(
      {
        address: address.toLowerCase(),
        balance: balance.toString(),
        balanceSufficient,
        requiredWei: requiredWei.toString(),
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
