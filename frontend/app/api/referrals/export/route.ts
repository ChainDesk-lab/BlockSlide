import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "../../_lib/redis";
import { referralsCsv, secretMatches, type ExportRow } from "../../../../src/lib/referrals";
import { allReferrals, playedFn, registryUsernames, walletActivity } from "../../../../src/lib/referralStore";

/**
 * GET /api/referrals/export — every invite: who invited whom, when, and whether the invited
 * player has started a game. For the project owner only.
 *
 *   curl -H "Authorization: Bearer $REFERRALS_EXPORT_SECRET" "https://blockslide.app/api/referrals/export?format=csv"
 *
 * Off (503) until REFERRALS_EXPORT_SECRET is set; any other key gets 401. JSON by default.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const expected = process.env.REFERRALS_EXPORT_SECRET;
  if (!expected) return NextResponse.json({ error: "export disabled" }, { status: 503, headers: NO_STORE });
  const auth = request.headers.get("authorization");
  const given = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secretMatches(given, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });

  const client = await getRedis();
  if (!client) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  const records = await allReferrals(client);
  const played = playedFn(await walletActivity());
  const entries = Object.entries(records).sort(([, a], [, b]) => a.referrer.localeCompare(b.referrer) || a.at - b.at);
  const names = await registryUsernames(client, [...new Set(entries.flatMap(([invitee, r]) => [invitee, r.referrer]))]);

  const rows: ExportRow[] = entries.map(([invitee, r]) => ({
    inviter: r.referrer,
    inviterUsername: names[r.referrer] ?? null,
    invitee,
    inviteeUsername: names[invitee] ?? null,
    joinedAt: new Date(r.at).toISOString(),
    played: played ? played(invitee) : null,
  }));

  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new NextResponse(referralsCsv(rows), {
      headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="blockslide-invites.csv"' },
    });
  }
  return NextResponse.json({ generatedAt: new Date().toISOString(), count: rows.length, playedKnown: !!played, invites: rows }, { headers: NO_STORE });
}
