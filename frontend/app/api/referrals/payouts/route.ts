import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "../../_lib/redis";
import { normalizeAddress, type PayoutRequest } from "../../../../src/lib/referrals";
import {
  claimInvitees, getPayout, payoutRequests, registryUsernames, releaseInvitees, savePayout, withLock,
} from "../../../../src/lib/referralStore";
import { adminFromRequest, adminLabel } from "../../../../src/lib/adminSession";
import { checkPayment, paymentProblem } from "../../../../src/lib/payoutVerify";

/**
 * The admins' review of referral payment requests (the /admin/payouts page uses this).
 *
 * GET  /api/referrals/payouts                    every request, pending first, newest first
 * POST /api/referrals/payouts { id, status, txHash?, note? }
 *      status "paid": needs the payment transaction. It is checked on Celo (lib/payoutVerify.ts):
 *        it must have succeeded and sent at least the requested G$ to the payout wallet, and it
 *        can't already be the proof for another request. Its referrals stay used.
 *      status "rejected": not paid; its referrals are released and can be requested again.
 *      Only a pending request can be decided. Each decision records which admin made it.
 *
 * Callers are admins signed in through /api/admin/session, or hold the owner key
 * (REFERRALS_EXPORT_SECRET), as `Authorization: Bearer …`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** Redis hash: payment transaction hash -> the request it paid. */
const TX_KEY = "payouts:v1:txs";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(request: NextRequest) {
  const client = await getRedis();
  if (!(await adminFromRequest(client, request.headers.get("authorization")))) return json({ error: "unauthorized" }, 401);
  if (!client) return json({ error: "unavailable" }, 503);

  const requests = (await payoutRequests(client)).sort(
    (a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt - a.createdAt,
  );
  const names = await registryUsernames(client, [...new Set(requests.flatMap((r) => [r.inviter, ...r.invitees]))]);
  return json({
    requests: requests.map((r) => ({
      ...r,
      inviterUsername: names[r.inviter] ?? null,
      invitees: r.invitees.map((i) => ({ address: i, username: names[i] ?? null })),
    })),
    pending: requests.filter((r) => r.status === "pending").length,
    serverTime: Date.now(),
  });
}

export async function POST(request: NextRequest) {
  const client = await getRedis();
  const admin = await adminFromRequest(client, request.headers.get("authorization"));
  if (!admin) return json({ error: "unauthorized" }, 401);
  if (!client) return json({ error: "unavailable" }, 503);

  const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string; txHash?: string; note?: string };
  if (typeof body.id !== "string" || (body.status !== "paid" && body.status !== "rejected")) {
    return json({ error: "id and a status of \"paid\" or \"rejected\" are required" }, 400);
  }
  const txHash = typeof body.txHash === "string" ? body.txHash.trim().toLowerCase() : "";
  if (body.status === "paid" && !/^0x[0-9a-f]{64}$/.test(txHash)) {
    return json({ error: "A paid request needs its payment transaction (0x followed by 64 characters)." }, 400);
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : undefined;

  // One decision at a time per request, so two admins acting at once can't overwrite each other;
  // the status is read inside the lock.
  const outcome = await withLock(client, `decide:${body.id}`, async () => {
    const req = await getPayout(client, body.id as string);
    if (!req || !normalizeAddress(req.inviter)) return json({ error: "Request not found." }, 404);
    if (req.status !== "pending") return json({ error: `This request is already ${req.status}.` }, 409);

    const decided: PayoutRequest = { ...req, status: body.status as "paid" | "rejected", decidedAt: Date.now(), decidedBy: adminLabel(admin), ...(note ? { note } : {}) };

    if (decided.status === "paid") {
      let check;
      try {
        check = await checkPayment(txHash as `0x${string}`, req.payTo, req.amountG);
      } catch (e) {
        console.warn("[payouts] payment check failed:", e instanceof Error ? e.message : e);
        return json({ error: "Couldn't reach Celo to check the payment. Try again in a moment." }, 503);
      }
      if (!check.ok) return json({ error: paymentProblem(check, req.amountG, req.payTo), reason: check.reason }, 422);
      const used = await client.hSetNX(TX_KEY, txHash, req.id);
      if (!used && (await client.hGet(TX_KEY, txHash)) !== req.id) {
        return json({ error: "That transaction is already the proof of payment for another request." }, 409);
      }
      decided.txHash = txHash;
      decided.paidWei = check.paidWei.toString();
      // A paid request's referrals are (re)marked as used, so they can never be paid twice.
      await claimInvitees(client, req.invitees, req.id);
    }

    await savePayout(client, decided);
    if (decided.status === "rejected") await releaseInvitees(client, req.invitees);
    return json({ request: decided });
  });
  return outcome === "busy" ? json({ error: "Another admin is deciding this request right now. Refresh in a moment." }, 409) : outcome;
}
