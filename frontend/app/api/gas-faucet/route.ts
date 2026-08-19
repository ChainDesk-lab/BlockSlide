import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { triggerFaucet, chainConfigs, type SupportedChains } from "@goodsdks/citizen-sdk";
import { TARGET_CHAIN } from "../../../src/lib/constants";

/**
 * Server-side Gas Faucet Proxy
 *
 * Bypasses client-side CORS restrictions by:
 * 1. Checking CELO balance server-side (no CORS)
 * 2. Triggering faucet server-side when needed
 * 3. Returning balance + faucet status to frontend
 *
 * This eliminates CORS errors that block direct browser RPC calls to Ankr/Celo
 */

const LOW_GAS_THRESHOLD = 1_000_000_000_000_000n; // 0.001 CELO
const FAUCET_ENV = "production" as const;

// Faucet address from SDK's chain registry
const FAUCET_ADDRESS = chainConfigs[TARGET_CHAIN.id as SupportedChains]?.contracts[FAUCET_ENV]
  ?.faucetContract;

interface GasFaucetRequest {
  address: string;
}

interface GasFaucetResponse {
  address: string;
  balance: string; // wei as string (to avoid bigint serialization)
  balanceSufficient: boolean;
  faucetTriggered: boolean;
  faucetResult?: string;
  error?: string;
}

/**
 * POST /api/gas-faucet
 * Check balance and trigger faucet if needed
 */
export async function POST(request: NextRequest): Promise<NextResponse<GasFaucetResponse>> {
  try {
    const body = (await request.json()) as GasFaucetRequest;
    const { address } = body;

    if (!address || !address.startsWith("0x") || address.length !== 42) {
      return NextResponse.json(
        { error: "Invalid address format" } as any,
        { status: 400 }
      );
    }

    // Create server-side public client (no CORS restrictions)
    const publicClient = createPublicClient({
      chain: celo,
      transport: http("https://1rpc.io/celo"),
    });

    // Fetch balance server-side
    let balance = 0n;
    try {
      balance = await publicClient.getBalance({ address: address as `0x${string}` });
      console.log(`[Gas Faucet Proxy] Balance for ${address.slice(0, 6)}...: ${balance.toLocaleString()} wei`);
    } catch (err) {
      console.error(`[Gas Faucet Proxy] Failed to fetch balance:`, err);
      return NextResponse.json(
        { error: "Could not fetch balance. Please try again." } as any,
        { status: 500 }
      );
    }

    const balanceSufficient = balance >= LOW_GAS_THRESHOLD;

    // If balance is sufficient, no need to trigger faucet
    if (balanceSufficient) {
      console.log(
        `[Gas Faucet Proxy] Sufficient balance (${balance.toLocaleString()} wei), skipping faucet`
      );
      return NextResponse.json({
        address: address.toLowerCase(),
        balance: balance.toString(),
        balanceSufficient: true,
        faucetTriggered: false,
      });
    }

    // Balance is low — try to trigger faucet
    if (!FAUCET_ADDRESS) {
      console.error("[Gas Faucet Proxy] Faucet not configured for this network");
      return NextResponse.json(
        { error: "Gas faucet is not available for this network." } as any,
        { status: 503 }
      );
    }

    console.log(`[Gas Faucet Proxy] Low balance detected, triggering faucet for ${address.slice(0, 6)}...`);

    let faucetResult = "error";
    try {
      // Attempt to trigger faucet server-side
      // Note: triggerFaucet with only publicClient (no walletClient) will attempt
      // contract call if user is whitelisted, or return 'skipped' if not eligible
      const result = await triggerFaucet({
        chainId: TARGET_CHAIN.id,
        account: address as `0x${string}`,
        faucetAddress: FAUCET_ADDRESS,
        publicClient: publicClient as any,
        walletClient: undefined as any, // Server-side: no user wallet available
        env: FAUCET_ENV,
      });

      faucetResult = result;
      console.log(`[Gas Faucet Proxy] Faucet result: ${result}`, {
        address: address.slice(0, 6),
        balance: balance.toString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Gas Faucet Proxy] Faucet trigger failed:`, message);
      // Faucet error — but return the balance info we do have
      return NextResponse.json(
        {
          address: address.toLowerCase(),
          balance: balance.toString(),
          balanceSufficient: false,
          faucetTriggered: false,
          error: "Faucet temporary error. Please try again or ensure your account is verified.",
        }
      );
    }

    // Faucet was attempted — return result
    const faucetSuccess = faucetResult !== "error" && faucetResult !== "skipped";
    return NextResponse.json({
      address: address.toLowerCase(),
      balance: balance.toString(),
      balanceSufficient: faucetSuccess ? true : false, // Mark as sufficient if faucet succeeded
      faucetTriggered: faucetSuccess,
      faucetResult,
    });
  } catch (error) {
    console.error("[Gas Faucet Proxy] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" } as any,
      { status: 500 }
    );
  }
}

/**
 * GET /api/gas-faucet?address=0x...
 * Check balance only (no faucet trigger)
 * Useful for periodic balance polling
 */
export async function GET(request: NextRequest): Promise<NextResponse<GasFaucetResponse>> {
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
      transport: http("https://1rpc.io/celo"),
    });

    let balance = 0n;
    try {
      balance = await publicClient.getBalance({ address: address as `0x${string}` });
    } catch (err) {
      console.error(`[Gas Faucet Proxy] GET failed to fetch balance:`, err);
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
        faucetTriggered: false,
      },
      {
        headers: {
          "Cache-Control": "no-cache", // Balance changes frequently
        },
      }
    );
  } catch (error) {
    console.error("[Gas Faucet Proxy] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" } as any,
      { status: 500 }
    );
  }
}
