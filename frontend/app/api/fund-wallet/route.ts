import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getRedis } from "../_lib/redis";
import { GAME2048_ADDRESS } from "../../../src/lib/constants";

/**
 * POST /api/fund-wallet — sends a small amount of CELO to a brand-new email
 * (Magic) wallet so its first transaction can pay for gas.
 *
 * DISABLED BY DEFAULT. It answers 503 unless FUND_WALLET_ENABLED=true.
 *
 * Why: until October 2026 this route signed with FUNDING_WALLET_PRIVATE_KEY,
 * which was the contract OWNER key (the key that can upgrade the game
 * contract and withdraw its treasury), and it accepted any address from any
 * caller with only an in-memory duplicate check that reset on every
 * serverless instance. Anyone could drain it, and the owner key sat in a web
 * server's environment.
 *
 * When re-enabled, it is bounded:
 *  - it signs only with GAS_FUNDER_PRIVATE_KEY (FUNDING_WALLET_PRIVATE_KEY is
 *    never read) and refuses to send if that key is the contract's owner();
 *  - each address is funded at most once, recorded durably in Redis; with
 *    Redis unavailable it refuses (fails closed);
 *  - at most FUND_WALLET_DAILY_CAP payouts per UTC day (default 20) and 3
 *    requests per IP per day;
 *  - only wallets that have never sent a transaction and hold < 0.02 CELO.
 * It still has no proof that the caller owns the address (that needs Magic
 * DID-token verification, a follow-up), so the daily cap is the hard bound on
 * loss: 20 × 0.05 = 1 CELO per day.
 */

export const runtime = "nodejs";

const FUNDING_AMOUNT = "0.05"; // CELO
const FRESH_BALANCE_MAX = parseEther("0.02");
const DEFAULT_DAILY_CAP = 20;
const PER_IP_DAILY_LIMIT = 3;
const FUNDED_TTL_SECONDS = 365 * 24 * 60 * 60;
const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const OWNER_ABI = parseAbi(["function owner() view returns (address)"]);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isEnabled(): boolean {
  return process.env.FUND_WALLET_ENABLED === "true";
}

function dailyCap(): number {
  const n = Number(process.env.FUND_WALLET_DAILY_CAP);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

function clientIp(request: NextRequest): string {
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Increment a per-day counter; returns the new count. */
async function bump(redis: NonNullable<Awaited<ReturnType<typeof getRedis>>>, key: string): Promise<number> {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, DAY_TTL_SECONDS);
  return n;
}

export async function POST(request: NextRequest) {
  if (!isEnabled()) {
    return json({ success: false, disabled: true, error: "Automatic wallet funding is paused." }, 503);
  }

  let address: string | undefined;
  try {
    ({ address } = (await request.json()) as { address?: string });
  } catch {
    return json({ success: false, error: "Invalid request body" }, 400);
  }
  if (!address || !ADDR_RE.test(address)) {
    return json({ success: false, error: "Invalid address" }, 400);
  }
  const to = address.toLowerCase() as `0x${string}`;

  const rawKey = process.env.GAS_FUNDER_PRIVATE_KEY;
  if (!rawKey) {
    return json({ success: false, error: "Funding is not configured." }, 503);
  }
  const redis = await getRedis();
  if (!redis) {
    // Without durable records there is no duplicate protection: refuse.
    return json({ success: false, error: "Funding is temporarily unavailable." }, 503);
  }

  try {
    if ((await bump(redis, `fundwallet:ip:${clientIp(request)}:${utcDay()}`)) > PER_IP_DAILY_LIMIT) {
      return json({ success: false, error: "Too many funding requests. Try again tomorrow." }, 429);
    }
    if (await redis.get(`fundwallet:funded:${to}`)) {
      return json({ success: true, alreadyFunded: true, txHash: null, message: "Wallet was already funded" });
    }

    const publicClient = createPublicClient({ chain: celo, transport: http("https://forno.celo.org", { timeout: 10_000 }) });
    const [nonce, balance, owner] = await Promise.all([
      publicClient.getTransactionCount({ address: to }),
      publicClient.getBalance({ address: to }),
      publicClient.readContract({ address: GAME2048_ADDRESS, abi: OWNER_ABI, functionName: "owner" }),
    ]);
    if (nonce > 0 || balance >= FRESH_BALANCE_MAX) {
      return json({ success: true, txHash: null, message: "Wallet is not new or already has gas" });
    }

    const account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`);
    if (account.address.toLowerCase() === (owner as string).toLowerCase()) {
      console.error("[fund-wallet] REFUSING: GAS_FUNDER_PRIVATE_KEY is the contract owner key");
      return json({ success: false, error: "Funding is misconfigured." }, 503);
    }

    // Claim the address first so concurrent requests can't both pay it, then
    // count against the daily cap.
    const claimed = await redis.set(`fundwallet:funded:${to}`, "pending", { NX: true, EX: FUNDED_TTL_SECONDS });
    if (claimed !== "OK") {
      return json({ success: true, alreadyFunded: true, txHash: null, message: "Wallet was already funded" });
    }
    if ((await bump(redis, `fundwallet:day:${utcDay()}`)) > dailyCap()) {
      await redis.del(`fundwallet:funded:${to}`);
      return json({ success: false, error: "Daily funding limit reached. Try again tomorrow." }, 429);
    }

    try {
      const wallet = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org", { timeout: 15_000 }) });
      const txHash = await wallet.sendTransaction({ to, value: parseEther(FUNDING_AMOUNT) });
      await redis.set(`fundwallet:funded:${to}`, txHash, { EX: FUNDED_TTL_SECONDS });
      console.log(`[fund-wallet] funded ${to.slice(0, 8)}… with ${FUNDING_AMOUNT} CELO`);
      return json({ success: true, txHash, amount: FUNDING_AMOUNT });
    } catch (sendErr) {
      // Not paid: release the claim so a later request can retry.
      await redis.del(`fundwallet:funded:${to}`);
      console.error("[fund-wallet] send failed:", sendErr instanceof Error ? sendErr.message : sendErr);
      return json({ success: false, error: "Funding failed. Please try again later." }, 502);
    }
  } catch (err) {
    console.error("[fund-wallet] error:", err instanceof Error ? err.message : err);
    return json({ success: false, error: "Funding is temporarily unavailable." }, 503);
  }
}

export async function GET() {
  return json({ enabled: isEnabled() });
}
