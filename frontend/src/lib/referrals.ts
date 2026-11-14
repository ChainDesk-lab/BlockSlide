/**
 * Invite links: the rules, as pure functions (the Redis and chain reads live in referralStore.ts).
 *
 * A player's invite link is https://blockslide.app/?ref=<their wallet address>. The visitor's
 * device keeps the first ref it sees (hooks/useRefCapture.ts) and sends it with its first sign-in
 * (hooks/usePlayerRegistration.ts). The server records the invite only when:
 *  - the signing-in wallet is brand new: not in the sign-in registry and with no event on the game
 *    contract, so an existing player can never be claimed by someone else's link;
 *  - it is not the inviter's own wallet;
 *  - the inviter is a real player (signed in before, or active on chain);
 *  - the wallet has no invite recorded yet: the first one is permanent.
 *
 * Each inviter has two counts. Joined: wallets recorded through their link. Played: of those, the
 * wallets that have started a game on the contract. Played can't be inflated by scripted sign-ins,
 * because every wallet it counts paid gas for a transaction, so rankings use it.
 */
import { EVENT_BIT } from "./stats/config";
import type { AddrRow } from "./stats/state";

/** Redis hash: invitee address (lowercase) -> JSON ReferralRecord. Written with HSETNX: first wins. */
export const REFERRALS_KEY = "referrals:v1:by-invitee";

export interface ReferralRecord {
  /** Inviter's address, lowercase. */
  referrer: string;
  /** When the invitee first signed in, ms since epoch. */
  at: number;
}

export type ReferralOutcome =
  | "recorded"
  /** This wallet already has an inviter. */
  | "already_referred"
  /** Not a brand-new wallet: it signed in before or has activity on chain. */
  | "not_new"
  | "self"
  /** The ref isn't a wallet address. */
  | "invalid"
  /** The inviter has never signed in or played. */
  | "unknown_referrer";

/** Lowercase address, or null when `v` isn't one. */
export function normalizeAddress(v: unknown): string | null {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null;
}

/** Everything but the final write: "ok" means the invite may be recorded. */
export function decideReferral(input: {
  invitee: string;
  referrer: string | null;
  inviteeInRegistry: boolean;
  inviteeOnChain: boolean;
  referrerKnown: boolean;
}): Exclude<ReferralOutcome, "recorded" | "already_referred"> | "ok" {
  if (!input.referrer) return "invalid";
  if (input.referrer === input.invitee) return "self";
  if (input.inviteeInRegistry || input.inviteeOnChain) return "not_new";
  if (!input.referrerKnown) return "unknown_referrer";
  return "ok";
}

const SESSION_BIT = 1 << EVENT_BIT.SessionStarted;

/** Whether this wallet's activity row includes starting a game. */
export function startedAGame(row: AddrRow | undefined): boolean {
  return !!row && (row[4] & SESSION_BIT) !== 0;
}

export interface InviterCounts {
  address: string;
  joined: number;
  played: number;
}

/** Joined and played per inviter. `played(invitee)` says whether that invitee has started a game. */
export function countByInviter(
  records: Record<string, ReferralRecord>,
  played: (invitee: string) => boolean,
): Map<string, InviterCounts> {
  const out = new Map<string, InviterCounts>();
  for (const [invitee, rec] of Object.entries(records)) {
    const row = out.get(rec.referrer) ?? { address: rec.referrer, joined: 0, played: 0 };
    row.joined += 1;
    if (played(invitee)) row.played += 1;
    out.set(rec.referrer, row);
  }
  return out;
}

/** Ranked by played, then joined, then address, so the order is stable. */
export function rankInviters(counts: Iterable<InviterCounts>, limit: number): InviterCounts[] {
  return [...counts]
    .sort((a, b) => b.played - a.played || b.joined - a.joined || a.address.localeCompare(b.address))
    .slice(0, limit);
}

/** Records come from Redis as JSON strings; anything unreadable is skipped, never guessed. */
export function parseRecords(raw: Record<string, string>): Record<string, ReferralRecord> {
  const out: Record<string, ReferralRecord> = {};
  for (const [invitee, json] of Object.entries(raw)) {
    try {
      const r = JSON.parse(json) as Partial<ReferralRecord>;
      const referrer = normalizeAddress(r.referrer);
      if (referrer && typeof r.at === "number" && normalizeAddress(invitee)) out[invitee.toLowerCase()] = { referrer, at: r.at };
    } catch { /* skip */ }
  }
  return out;
}

// ── Viewing your own invitees ─────────────────────────────────────────────────
// Who a player invited is shown only to that player, so they prove the wallet is theirs by signing
// this message (free, no transaction). A signature is accepted for SIGN_WINDOW_MS after issuedAt.

export const SIGN_WINDOW_MS = 10 * 60 * 1000;
/** Allowance for a device clock running ahead of the server. */
const CLOCK_SKEW_MS = 2 * 60 * 1000;

export function inviteListMessage(address: string, issuedAt: string): string {
  return `BlockSlide: show the players I invited\nWallet: ${address.toLowerCase()}\nIssued: ${issuedAt}`;
}

export function issuedAtIsFresh(issuedAt: unknown, now: number): boolean {
  if (typeof issuedAt !== "string") return false;
  const t = Date.parse(issuedAt);
  return Number.isFinite(t) && t <= now + CLOCK_SKEW_MS && now - t <= SIGN_WINDOW_MS;
}

// ── Export for the owner ──────────────────────────────────────────────────────

export interface ExportRow {
  inviter: string;
  inviterUsername: string | null;
  invitee: string;
  inviteeUsername: string | null;
  joinedAt: string;
  /** null when wallet activity couldn't be read. */
  played: boolean | null;
}

const csvCell = (v: string | boolean | null): string => {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function referralsCsv(rows: ExportRow[]): string {
  const header = ["inviter", "inviter_username", "invitee", "invitee_username", "joined_at", "played"];
  const lines = rows.map((r) => [r.inviter, r.inviterUsername, r.invitee, r.inviteeUsername, r.joinedAt, r.played].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\n") + "\n";
}

/** Constant-time comparison for the export secret. */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
