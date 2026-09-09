import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "../_lib/redis";

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
    const username = normalizeUsername(body.username);

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

    const profile: PlayerProfile = {
      address,
      // Never clobber a known username with null; accept a newer valid name.
      username: username ?? existing?.username ?? null,
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
