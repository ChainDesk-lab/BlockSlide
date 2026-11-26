import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "../_lib/redis";
import {
  MIN_PAYOUT_G, MIN_PAYOUT_REFERRALS, REFERRAL_REWARD_G, claimableInvitees, countByInviter, inviteListMessage,
  issuedAtIsFresh, normalizeAddress, payoutAmountG, rankInviters, type PayoutRequest,
} from "../../../src/lib/referrals";
import {
  allReferrals, claimedInvitees, payoutRequests, playedFn, registryUsernames, verificationWithin, verifyWalletSignature, walletActivity,
} from "../../../src/lib/referralStore";

/**
 * Invite link counts (rules in src/lib/referrals.ts).
 *
 * GET  /api/referrals?address=0x…  one player's counts and payment status
 * GET  /api/referrals              top inviters (by played, then joined) and totals
 * POST /api/referrals              { address, issuedAt, signature }: the players this wallet invited.
 *                                  Shown only to the inviter, who signs inviteListMessage to prove it.
 *
 * `played` and `verified` are null when they can't be read right now, never a guessed 0.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOP_LIMIT = 10;
const CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };

/** null when every lookup failed (unknown), otherwise how many are verified. */
function verifiedCount(invitees: string[], v: Record<string, boolean | null>): number | null {
  if (invitees.length && invitees.every((i) => v[i] === null || v[i] === undefined)) return null;
  return invitees.filter((i) => v[i] === true).length;
}

/** The most recently decided of these requests (by decision time), or null. */
function lastDecided(requests: PayoutRequest[]): PayoutRequest | null {
  return requests.filter((r) => r.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))[0] ?? null;
}

/**
 * A player's payment status, public: amounts follow from the public counts. What's private (the
 * payout wallet, the payment transaction and the admins' note) is only in the signed POST.
 */
function payoutSummary(inviter: string, requests: PayoutRequest[], available: number) {
  const mine = requests.filter((r) => r.inviter === inviter).sort((a, b) => b.createdAt - a.createdAt);
  const pending = mine.find((r) => r.status === "pending") ?? null;
  const paid = mine.filter((r) => r.status === "paid");
  const last = lastDecided(mine);
  return {
    rewardPerReferralG: REFERRAL_REWARD_G,
    minReferrals: MIN_PAYOUT_REFERRALS,
    minAmountG: MIN_PAYOUT_G,
    available,
    availableAmountG: payoutAmountG(available),
    pending: pending && { id: pending.id, count: pending.count, amountG: pending.amountG, createdAt: pending.createdAt },
    paid: { count: paid.reduce((n, r) => n + r.count, 0), amountG: paid.reduce((n, r) => n + r.amountG, 0) },
    lastDecision: last && { status: last.status, count: last.count, amountG: last.amountG, decidedAt: last.decidedAt ?? null },
  };
}

export async function GET(request: NextRequest) {
  const client = await getRedis();
  if (!client) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const records = await allReferrals(client);
  const played = playedFn(await walletActivity());

  const param = request.nextUrl.searchParams.get("address");
  if (param !== null) {
    const address = normalizeAddress(param);
    if (!address) return NextResponse.json({ error: "invalid address" }, { status: 400 });
    const invitees = Object.keys(records).filter((i) => records[i].referrer === address);
    const [v, claimed, requests] = await Promise.all([verificationWithin(invitees), claimedInvitees(client), payoutRequests(client)]);
    const isVerified = (i: string) => v[i] === true;
    const c = countByInviter(Object.fromEntries(invitees.map((i) => [i, records[i]])), played ?? (() => false), isVerified).get(address);
    const verified = verifiedCount(invitees, v);
    const available = played ? claimableInvitees(invitees, played, isVerified, claimed).length : 0;
    return NextResponse.json({
      address,
      joined: c?.joined ?? 0,
      played: played ? (c?.played ?? 0) : null,
      verified,
      eligible: played && verified !== null ? (c?.eligible ?? 0) : null,
      payout: payoutSummary(address, requests, available),
    }, { headers: { "Cache-Control": "no-store" } }); // a player's own status must reflect a request at once
  }

  const allInvitees = Object.keys(records);
  const v = await verificationWithin(allInvitees);
  const counts = countByInviter(records, played ?? (() => false), (i) => v[i] === true);
  const verifiedKnown = verifiedCount(allInvitees, v) !== null;
  const top = rankInviters(counts.values(), TOP_LIMIT);
  const names = await registryUsernames(client, top.map((t) => t.address));
  let joined = 0, playedTotal = 0, verifiedTotal = 0;
  for (const c of counts.values()) { joined += c.joined; playedTotal += c.played; verifiedTotal += c.verified; }
  return NextResponse.json({
    top: top.map((t) => ({
      address: t.address, username: names[t.address] ?? null, joined: t.joined,
      played: played ? t.played : null, verified: verifiedKnown ? t.verified : null,
    })),
    totals: { inviters: counts.size, joined, played: played ? playedTotal : null, verified: verifiedKnown ? verifiedTotal : null },
    updatedAt: new Date().toISOString(),
  }, { headers: CACHE });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { address?: string; issuedAt?: string; signature?: string };
  const address = normalizeAddress(body.address);
  if (!address || typeof body.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!issuedAtIsFresh(body.issuedAt, Date.now())) {
    return NextResponse.json({ error: "expired", message: "That signature has expired. Please sign again." }, { status: 401 });
  }

  let valid = false;
  try {
    valid = await verifyWalletSignature(address, inviteListMessage(address, body.issuedAt as string), body.signature as `0x${string}`);
  } catch (e) {
    console.warn("[referrals] signature check failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "unavailable", message: "Couldn't check the signature right now." }, { status: 503 });
  }
  if (!valid) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  const client = await getRedis();
  if (!client) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const records = await allReferrals(client);
  const played = playedFn(await walletActivity());
  const mine = Object.entries(records).filter(([, r]) => r.referrer === address).sort(([, a], [, b]) => b.at - a.at);
  const invitees = mine.map(([invitee]) => invitee);
  const [names, v, claimed, requests] = await Promise.all([
    registryUsernames(client, invitees), verificationWithin(invitees), claimedInvitees(client), payoutRequests(client),
  ]);
  const statusOf = new Map(requests.map((r) => [r.id, r.status]));
  const last = lastDecided(requests.filter((r) => r.inviter === address));
  return NextResponse.json({
    // Private to the inviter: the details of their latest decided payment request.
    lastDecision: last && { status: last.status, payTo: last.payTo, txHash: last.txHash ?? null, note: last.note ?? null, decidedAt: last.decidedAt ?? null },
    invitees: mine.map(([invitee, r]) => ({
      address: invitee,
      username: names[invitee] ?? null,
      joinedAt: new Date(r.at).toISOString(),
      played: played ? played(invitee) : null,
      verified: v[invitee] ?? null,
      payout: claimed[invitee] ? (statusOf.get(claimed[invitee]) ?? null) : null,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
