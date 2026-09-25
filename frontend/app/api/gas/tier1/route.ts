import { NextRequest, NextResponse } from "next/server";
import { canUseFaucet, markFaucetUsed } from "../../../../src/lib/faucet";

/**
 * TIER 1: GoodDollar Bootstrap Faucet (Tracking Only)
 *
 * Server tracks whether a wallet has used the faucet (one-time per wallet).
 * The actual faucet call happens on the frontend via triggerFaucet() from SDK.
 * This endpoint just reports faucet status for the frontend.
 *
 * The Redis helpers live in src/lib/faucet.ts: a route module may only export
 * route handlers and Next's config values, so exporting them from here breaks
 * the production build.
 */

/**
 * GET /api/gas/tier1?address=0x...
 * Check if wallet can use faucet
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");

    if (!address || !address.startsWith("0x") || address.length !== 42) {
      return NextResponse.json(
        { error: "Invalid address" },
        { status: 400 }
      );
    }

    const addressLower = address.toLowerCase();
    const canUse = await canUseFaucet(addressLower);

    return NextResponse.json({
      address: addressLower,
      canUseFaucet: canUse,
      message: canUse
        ? "Wallet can use GoodDollar faucet (Tier 1)"
        : "Wallet already used faucet today. Proceeding to Tier 2 (manual Telegram request).",
    });
  } catch (error) {
    console.error("[Gas Tier1] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gas/tier1
 * Mark wallet as having used the faucet (called after successful faucet)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { address?: string };
    const { address } = body;

    if (!address || !address.startsWith("0x") || address.length !== 42) {
      return NextResponse.json(
        { error: "Invalid address" },
        { status: 400 }
      );
    }

    await markFaucetUsed(address);
    return NextResponse.json({
      success: true,
      message: "Faucet marked as used for this wallet",
    });
  } catch (error) {
    console.error("[Gas Tier1] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
