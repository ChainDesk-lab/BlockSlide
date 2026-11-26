import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "../../_lib/redis";
import { isAdminWallet } from "../../../../src/config/admins";
import { adminLoginMessage, issuedAtIsFresh, normalizeAddress } from "../../../../src/lib/referrals";
import { verifyWalletSignature } from "../../../../src/lib/referralStore";
import { createAdminSession } from "../../../../src/lib/adminSession";

/**
 * POST /api/admin/session  { address, issuedAt, signature }
 *
 * Signs an admin in (rules in src/lib/adminSession.ts): the wallet must be on the admin list
 * (config/admins.ts) and must have signed adminLoginMessage in the last few minutes. Answers with a
 * session token for the admin API. Anyone else gets the same 403, whatever the reason.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const denied = () => NextResponse.json({ error: "not allowed" }, { status: 403, headers: NO_STORE });

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { address?: string; issuedAt?: string; signature?: string };
  const address = normalizeAddress(body.address);
  if (!address || !isAdminWallet(address) || typeof body.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) return denied();
  if (!issuedAtIsFresh(body.issuedAt, Date.now())) {
    return NextResponse.json({ error: "expired", message: "That signature has expired. Please sign in again." }, { status: 401, headers: NO_STORE });
  }
  let valid = false;
  try {
    valid = await verifyWalletSignature(address, adminLoginMessage(address, body.issuedAt as string), body.signature as `0x${string}`);
  } catch {
    return NextResponse.json({ error: "unavailable", message: "Couldn't check the signature right now." }, { status: 503, headers: NO_STORE });
  }
  if (!valid) return denied();

  const client = await getRedis();
  if (!client) return NextResponse.json({ error: "unavailable", message: "Storage is unavailable right now." }, { status: 503, headers: NO_STORE });
  const session = await createAdminSession(client, address);
  return NextResponse.json({ ...session, address }, { headers: NO_STORE });
}
