import { NextRequest, NextResponse } from "next/server";
import { getVerifications } from "../_lib/verification";

/**
 * Player verification endpoint.
 *
 * Thin HTTP wrapper around the shared `getVerifications` helper (GoodDollar
 * identity registry `isWhitelisted`, Redis-cached, Multicall3-batched with RPC
 * fallback). The leaderboard route uses the same helper, so a badge here and a
 * player's rank tier there are always derived from one source.
 *
 * Value semantics: isVerified true / false / null, where null means "could not
 * be determined right now" — never treat null as unverified.
 */

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * GET /api/player-verification?address=0x...
 * Returns { isVerified: boolean } for a single wallet, or 503 if undeterminable.
 */
export async function GET(request: NextRequest) {
  try {
    const address =
      new URL(request.url).searchParams.get("address") ?? undefined;

    if (!address || !ADDR_RE.test(address)) {
      return NextResponse.json(
        { error: "Invalid or missing address" },
        { status: 400 }
      );
    }

    const map = await getVerifications([address]);
    const isVerified = map[address.toLowerCase()] ?? null;

    if (isVerified === null) {
      return NextResponse.json(
        { error: "Verification service temporarily unavailable", unavailable: true },
        { status: 503, headers: { "Cache-Control": "no-cache" } }
      );
    }

    return NextResponse.json(
      { isVerified },
      { status: 200, headers: { "Cache-Control": "public, max-age=300" } }
    );
  } catch (error) {
    console.error("[Player Verification GET] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/player-verification
 * body: { addresses: string[] }  (max 100)
 * Returns { results: { <lowercaseAddr>: { isVerified: boolean | null } } }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      addresses?: unknown;
    };

    if (!Array.isArray(body.addresses)) {
      return NextResponse.json(
        { error: "Missing addresses array" },
        { status: 400 }
      );
    }
    if (body.addresses.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 addresses per request" },
        { status: 400 }
      );
    }

    const addresses = body.addresses.filter(
      (a): a is string => typeof a === "string" && ADDR_RE.test(a)
    );

    const map = await getVerifications(addresses);

    const results: Record<string, { isVerified: boolean | null }> = {};
    for (const addr of addresses) {
      results[addr.toLowerCase()] = {
        isVerified: map[addr.toLowerCase()] ?? null,
      };
    }

    const unavailable = Object.values(results).filter(
      (r) => r.isVerified === null
    ).length;
    if (unavailable > 0) {
      console.warn(
        `[Player Verification POST] ${unavailable}/${addresses.length} addresses undeterminable`
      );
    }

    return NextResponse.json(
      { results },
      { status: 200, headers: { "Cache-Control": "public, max-age=120" } }
    );
  } catch (error) {
    console.error("[Player Verification POST] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
