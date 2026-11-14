import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, fallback, http, recoverMessageAddress } from "viem";
import { celo } from "viem/chains";
import { getRedis } from "../_lib/redis";
import {
  countByInviter, inviteListMessage, issuedAtIsFresh, normalizeAddress, rankInviters,
} from "../../../src/lib/referrals";
import { allReferrals, playedFn, registryUsernames, walletActivity } from "../../../src/lib/referralStore";

/**
 * Invite link counts (rules in src/lib/referrals.ts).
 *
 * GET  /api/referrals?address=0x…  one player's counts: { joined, played }
 * GET  /api/referrals              top inviters (by played, then joined) and totals
 * POST /api/referrals              { address, issuedAt, signature }: the players this wallet invited.
 *                                  Shown only to the inviter, who signs inviteListMessage to prove it.
 *
 * `played` is null when wallet activity can't be read right now, never a guessed 0.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOP_LIMIT = 10;
const CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };

const RPC_URLS = (process.env.CELO_RPC_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);
const rpc = () => createPublicClient({
  chain: celo,
  transport: fallback((RPC_URLS.length ? RPC_URLS : ["https://forno.celo.org"]).map((u) => http(u, { timeout: 8_000 }))),
});

export async function GET(request: NextRequest) {
  const client = await getRedis();
  if (!client) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const records = await allReferrals(client);
  const played = playedFn(await walletActivity());
  const counts = countByInviter(records, played ?? (() => false));

  const param = request.nextUrl.searchParams.get("address");
  if (param !== null) {
    const address = normalizeAddress(param);
    if (!address) return NextResponse.json({ error: "invalid address" }, { status: 400 });
    const c = counts.get(address);
    return NextResponse.json({ address, joined: c?.joined ?? 0, played: played ? (c?.played ?? 0) : null }, { headers: CACHE });
  }

  const top = rankInviters(counts.values(), TOP_LIMIT);
  const names = await registryUsernames(client, top.map((t) => t.address));
  let joined = 0, playedTotal = 0;
  for (const c of counts.values()) { joined += c.joined; playedTotal += c.played; }
  return NextResponse.json({
    top: top.map((t) => ({ address: t.address, username: names[t.address] ?? null, joined: t.joined, played: played ? t.played : null })),
    totals: { inviters: counts.size, joined, played: played ? playedTotal : null },
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

  const message = inviteListMessage(address, body.issuedAt as string);
  const signature = body.signature as `0x${string}`;
  let valid = false;
  try {
    // An ordinary wallet's signature is checked locally; anything else (a smart-contract wallet)
    // is checked on chain, which covers ERC-1271 and ERC-6492 signatures.
    const recovered = await recoverMessageAddress({ message, signature }).catch(() => null);
    valid = recovered?.toLowerCase() === address
      || await rpc().verifyMessage({ address: address as `0x${string}`, message, signature });
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
  const names = await registryUsernames(client, mine.map(([invitee]) => invitee));
  return NextResponse.json({
    invitees: mine.map(([invitee, r]) => ({
      address: invitee,
      username: names[invitee] ?? null,
      joinedAt: new Date(r.at).toISOString(),
      played: played ? played(invitee) : null,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
