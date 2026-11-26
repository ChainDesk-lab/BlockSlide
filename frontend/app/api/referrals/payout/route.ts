import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getRedis } from "../../_lib/redis";
import {
  MIN_PAYOUT_REFERRALS, REFERRAL_REWARD_G, claimableInvitees, countByInviter, issuedAtIsFresh, normalizeAddress,
  payoutAmountG, payoutNotification, payoutRequestMessage, type PayoutRequest,
} from "../../../../src/lib/referrals";
import {
  allReferrals, claimedInvitees, payoutRequests, playedFn, registryUsernames, releaseInvitees, reserveInvitees, savePayout,
  verificationOf, verifyWalletSignature, walletActivity, withInviterLock,
} from "../../../../src/lib/referralStore";
import { notifyOwner } from "../../../../src/lib/notify";

/**
 * POST /api/referrals/payout  { address, payTo, issuedAt, signature }
 *
 * A player asks to be paid for their referrals (rules in src/lib/referrals.ts): every referral that
 * has played, is GoodDollar-verified and isn't in a pending or paid request, at REFERRAL_REWARD_G
 * each, from MIN_PAYOUT_REFERRALS of them. The player signs payoutRequestMessage, which names the
 * wallet to be paid, so nobody can request a payment for someone else's referrals or redirect it.
 *
 * The request is saved before the owner is told (Telegram), then reviewed and paid by hand.
 * One pending request per player at a time.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://blockslide.app").replace(/\/+$/, "");
const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, message, ...extra }, { status, headers: NO_STORE });

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { address?: string; payTo?: string; issuedAt?: string; signature?: string };
  const address = normalizeAddress(body.address);
  const payTo = normalizeAddress(body.payTo);
  if (!address || typeof body.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    return fail(400, "invalid request", "Something was missing from the request. Please try again.");
  }
  if (!payTo || /^0x0{40}$/.test(payTo)) return fail(400, "invalid payout wallet", "That payout wallet address isn't valid.");
  if (!issuedAtIsFresh(body.issuedAt, Date.now())) return fail(401, "expired", "That signature has expired. Please sign again.");

  let valid = false;
  try {
    valid = await verifyWalletSignature(address, payoutRequestMessage(address, payTo, body.issuedAt as string), body.signature as `0x${string}`);
  } catch (e) {
    console.warn("[payout] signature check failed:", e instanceof Error ? e.message : e);
    return fail(503, "unavailable", "Couldn't check your signature right now. Please try again shortly.");
  }
  if (!valid) return fail(401, "bad signature", "The signature didn't match your wallet.");

  const client = await getRedis();
  if (!client) return fail(503, "unavailable", "Payments can't be requested right now. Please try again shortly.");

  const outcome = await withInviterLock(client, address, async () => {
    const requests = await payoutRequests(client);
    if (requests.some((r) => r.inviter === address && r.status === "pending")) {
      return fail(409, "pending", "You already have a payment request waiting for review.");
    }

    const records = await allReferrals(client);
    const played = playedFn(await walletActivity());
    if (!played) return fail(503, "unavailable", "Your referrals can't be checked right now. Please try again shortly.");
    const invitees = Object.keys(records).filter((i) => records[i].referrer === address);
    const [v, claimed] = await Promise.all([verificationOf(invitees), claimedInvitees(client)]);
    const isVerified = (i: string) => v[i] === true;
    const claimable = claimableInvitees(invitees, played, isVerified, claimed);
    if (claimable.length < MIN_PAYOUT_REFERRALS) {
      return fail(409, "not_enough",
        `You need at least ${MIN_PAYOUT_REFERRALS} referrals who have played and are verified before you can request a payment. You have ${claimable.length}.`,
        { eligible: claimable.length, needed: MIN_PAYOUT_REFERRALS });
    }

    const c = countByInviter(Object.fromEntries(invitees.map((i) => [i, records[i]])), played, isVerified).get(address);
    const req: PayoutRequest = {
      id: randomUUID(),
      inviter: address,
      payTo,
      invitees: claimable,
      count: claimable.length,
      amountG: payoutAmountG(claimable.length),
      rewardPerReferralG: REFERRAL_REWARD_G,
      status: "pending",
      createdAt: Date.now(),
      snapshot: { joined: c?.joined ?? 0, played: c?.played ?? 0, verified: c?.verified ?? 0, eligible: c?.eligible ?? 0 },
    };
    // Reserve the referrals before the request exists, so a request can never be saved (and later
    // paid) while its referrals still look unrequested; undo the reservation if the save fails.
    if (!(await reserveInvitees(client, claimable, req.id))) {
      return fail(409, "busy", "Some of these referrals were just included in another request. Please refresh and try again.");
    }
    try {
      await savePayout(client, req);
    } catch (e) {
      await releaseInvitees(client, claimable).catch(() => {});
      throw e;
    }
    return req;
  });

  if (outcome === "busy") return fail(409, "busy", "Your request is already being processed.");
  if (outcome instanceof NextResponse) return outcome;

  const name = (await registryUsernames(client, [address]))[address] ?? null;
  const notified = await notifyOwner(payoutNotification(outcome, name, SITE_URL));
  if (notified !== "sent") console.warn(`[payout] request ${outcome.id} saved; owner notification ${notified}`);

  return NextResponse.json({
    request: { id: outcome.id, count: outcome.count, amountG: outcome.amountG, payTo: outcome.payTo, createdAt: outcome.createdAt, status: outcome.status },
  }, { headers: NO_STORE });
}
