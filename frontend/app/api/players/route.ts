import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, fallback, http, parseAbi } from "viem";
import { celo } from "viem/chains";
import { getRedis } from "../_lib/redis";
import { GAME2048_ADDRESS } from "../../../src/lib/constants";

/**
 * Player registry API.
 *
 * Captures every wallet the moment it authenticates so it shows on the
 * leaderboard immediately — even before the wallet has any on-chain activity
 * (no username transaction, no submitted score). The subgraph stays the source
 * of truth for XP and on-chain usernames; this registry only fills the gap for
 * wallets the subgraph has never seen, and mirrors a freshly-set username
 * during the short window before the subgraph indexes the UsernameSet event.
 *
 * Storage: a single Redis hash `players:registry`, field = lowercase address,
 * value = JSON PlayerProfile.
 *
 * Usernames are verified, not trusted: a submitted name is stored only if it
 * matches the contract's `usernames(address)`. Anyone can POST any address, so
 * an unverified name would let one wallet label another on the leaderboard.
 * The app only ever sends the name it just read from the contract, so this
 * doesn't change legitimate registrations. Address registration itself is
 * still open (no signature), by design: it must work before any wallet prompt.
 */

export const runtime = "nodejs";

interface PlayerProfile {
  address: string; // lowercase
  username: string | null;
  createdAt: number; // ms epoch — first time this wallet was seen
  updatedAt: number; // ms epoch
}

const REGISTRY_KEY = "players:registry";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const RPC_URLS = (process.env.CELO_RPC_URLS ?? "https://forno.celo.org")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const USERNAMES_ABI = parseAbi(["function usernames(address) view returns (string)"]);

/**
 * The wallet's on-chain username ("" when unset), or undefined when it
 * couldn't be read — in which case no submitted name is accepted.
 */
async function readOnChainUsername(address: `0x${string}`): Promise<string | undefined> {
  try {
    const client = createPublicClient({
      chain: celo,
      transport: fallback(
        RPC_URLS.map((u) => http(u, { timeout: 5_000, fetchOptions: { cache: "no-store" } }))
      ),
    });
    const name = await client.readContract({
      address: GAME2048_ADDRESS,
      abi: USERNAMES_ABI,
      functionName: "usernames",
      args: [address],
    });
    return (name as string).trim();
  } catch (e) {
    console.warn("[Players API] on-chain username read failed:", e instanceof Error ? e.message : e);
    return undefined;
  }
}

function isValidAddress(a: unknown): a is string {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}

function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed && USERNAME_RE.test(trimmed) ? trimmed : null;
}

/**
 * POST /api/players
 * body: { address: string, username?: string }
 * Upsert a wallet into the registry. Idempotent — safe to call on every connect.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      address?: string;
      username?: string | null;
    };

    if (!isValidAddress(body.address)) {
      return NextResponse.json(
        { ok: false, error: "Invalid address" },
        { status: 400 }
      );
    }

    const address = body.address.toLowerCase();
    const claimed = normalizeUsername(body.username);

    const client = await getRedis();
    if (!client) {
      // Non-fatal: the leaderboard still renders from the subgraph without this.
      return NextResponse.json(
        { ok: false, error: "Registry unavailable" },
        { status: 503 }
      );
    }

    const now = Date.now();
    const existingRaw = await client.hGet(REGISTRY_KEY, address);
    const existing = existingRaw
      ? (JSON.parse(existingRaw) as PlayerProfile)
      : null;

    // A submitted name counts only if the contract agrees. When it was checked,
    // the contract's value wins (a stale or spoofed registry name is replaced);
    // when the check couldn't run, nothing submitted is accepted.
    let username: string | null = existing?.username ?? null;
    if (claimed) {
      const onChain = await readOnChainUsername(address as `0x${string}`);
      if (onChain !== undefined) {
        username = onChain || null;
        if (onChain !== claimed) {
          console.warn(`[Players API] ignored username for ${address.slice(0, 8)}…: does not match on-chain name`);
        }
      }
    }

    const profile: PlayerProfile = {
      address,
      username,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    // Nothing meaningful changed — skip the write so reconnects stay quiet.
    if (existing && existing.username === profile.username) {
      return NextResponse.json({ ok: true, profile: existing, unchanged: true });
    }

    await client.hSet(REGISTRY_KEY, address, JSON.stringify(profile));
    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    console.error("[Players API POST] error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/players
 * Full registry snapshot. Internal use — the leaderboard route merges this with
 * the subgraph.
 */
export async function GET() {
  try {
    const client = await getRedis();
    if (!client) {
      return NextResponse.json({ players: [], count: 0, unavailable: true });
    }

    const all = await client.hGetAll(REGISTRY_KEY);
    const players: PlayerProfile[] = Object.values(all).map(
      (v) => JSON.parse(v) as PlayerProfile
    );
    return NextResponse.json({ players, count: players.length });
  } catch (err) {
    console.error("[Players API GET] error:", err);
    return NextResponse.json(
      { players: [], count: 0, error: "Internal error" },
      { status: 500 }
    );
  }
}
