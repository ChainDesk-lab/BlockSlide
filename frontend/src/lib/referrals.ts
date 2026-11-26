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
  /** Invitees verified with GoodDollar (one person, one wallet) right now. */
  verified: number;
  /** Invitees who have played AND are verified: the ones that count toward payment. */
  eligible: number;
}

/**
 * Counts per inviter. `played(invitee)` says whether that invitee has started a game;
 * `verified(invitee)` whether they are GoodDollar-verified (false when unknown).
 */
export function countByInviter(
  records: Record<string, ReferralRecord>,
  played: (invitee: string) => boolean,
  verified: (invitee: string) => boolean = () => false,
): Map<string, InviterCounts> {
  const out = new Map<string, InviterCounts>();
  for (const [invitee, rec] of Object.entries(records)) {
    const row = out.get(rec.referrer) ?? { address: rec.referrer, joined: 0, played: 0, verified: 0, eligible: 0 };
    const p = played(invitee), v = verified(invitee);
    row.joined += 1;
    if (p) row.played += 1;
    if (v) row.verified += 1;
    if (p && v) row.eligible += 1;
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

// ── Referral payments ─────────────────────────────────────────────────────────
// A referral earns REFERRAL_REWARD_G once the invited player has played AND is GoodDollar-verified.
// A player requests payment for all such referrals not yet in a request, and only from
// MIN_PAYOUT_REFERRALS of them (26,350 G$). Requests are reviewed and paid by the owner by hand;
// a referral in a pending or paid request can't be requested again, and a rejected request
// releases its referrals.

export const REFERRAL_REWARD_G = 2_635;
export const MIN_PAYOUT_REFERRALS = 10;
export const MIN_PAYOUT_G = REFERRAL_REWARD_G * MIN_PAYOUT_REFERRALS;

/** Redis hash: request id -> JSON PayoutRequest. */
export const PAYOUTS_KEY = "payouts:v1:requests";
/** Redis hash: invitee address -> id of the pending or paid request that includes them. */
export const CLAIMED_KEY = "payouts:v1:claimed";

export type PayoutStatus = "pending" | "paid" | "rejected";

export interface PayoutRequest {
  id: string;
  /** Inviter, lowercase. */
  inviter: string;
  /** Wallet the inviter asked to be paid in, lowercase. */
  payTo: string;
  /** The referrals this request pays for. */
  invitees: string[];
  count: number;
  /** Whole G$. */
  amountG: number;
  rewardPerReferralG: number;
  status: PayoutStatus;
  createdAt: number;
  decidedAt?: number;
  /** Payment transaction, checked on chain before the request was marked paid. */
  txHash?: string;
  /** G$ (in wei) that the payment transaction sent to `payTo`. */
  paidWei?: string;
  /** Admin wallet that marked it paid or rejected it ("owner key" when done with the export key). */
  decidedBy?: string;
  /** Owner's note, e.g. why a request was rejected. */
  note?: string;
  /** The inviter's counts when they asked. */
  snapshot: { joined: number; played: number; verified: number; eligible: number };
}

export const payoutAmountG = (count: number) => count * REFERRAL_REWARD_G;

/** Referrals that may go into a new request: played, verified, and not in a pending or paid request. */
export function claimableInvitees(
  invitees: string[],
  played: (invitee: string) => boolean,
  verified: (invitee: string) => boolean,
  claimed: Record<string, string>,
): string[] {
  return invitees.filter((i) => !claimed[i] && played(i) && verified(i));
}

/** What an admin signs to open the admin pages (lib/adminSession.ts). */
export function adminLoginMessage(address: string, issuedAt: string): string {
  return `BlockSlide: admin sign-in\nWallet: ${address.toLowerCase()}\nIssued: ${issuedAt}`;
}

export function payoutRequestMessage(address: string, payTo: string, issuedAt: string): string {
  return `BlockSlide: request my referral payment\nWallet: ${address.toLowerCase()}\nPay to: ${payTo.toLowerCase()}\nIssued: ${issuedAt}`;
}

export function parsePayout(json: string): PayoutRequest | null {
  try {
    const r = JSON.parse(json) as PayoutRequest;
    return r && typeof r.id === "string" && normalizeAddress(r.inviter) && Array.isArray(r.invitees) ? r : null;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const gFmt = (n: number) => n.toLocaleString("en-US");

/** The Telegram message (HTML parse mode) the owner receives for a new request. */
export function payoutNotification(req: PayoutRequest, username: string | null, siteUrl: string): string {
  const who = username ? `${esc(username)} (<code>${req.inviter}</code>)` : `<code>${req.inviter}</code>`;
  const s = req.snapshot;
  return [
    "💸 <b>Referral payment request</b>",
    "",
    `<b>Player:</b> ${who}`,
    `<b>Amount:</b> ${gFmt(req.amountG)} G$ (${req.count} × ${gFmt(req.rewardPerReferralG)} G$)`,
    `<b>Pay to:</b> <code>${req.payTo}</code>${req.payTo === req.inviter ? " (their own wallet)" : " (a different wallet)"}`,
    "",
    `<b>Referrals:</b> ${s.joined} joined · ${s.played} played · ${s.verified} verified · ${s.eligible} played and verified`,
    `<b>In this request:</b> ${req.count}`,
    "",
    `Request <code>${req.id}</code> · ${new Date(req.createdAt).toISOString().replace("T", " ").slice(0, 16)} UTC`,
    `<a href="${siteUrl}/profile/${req.inviter}">Profile</a> · <a href="${siteUrl}/admin/payouts">Review requests</a>`,
  ].join("\n");
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
  /** null when verification couldn't be read. */
  verified: boolean | null;
  /** Status of the payment request that includes this referral, if any. */
  payout: PayoutStatus | null;
}

const csvCell = (v: string | boolean | null): string => {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function referralsCsv(rows: ExportRow[]): string {
  const header = ["inviter", "inviter_username", "invitee", "invitee_username", "joined_at", "played", "verified", "payout"];
  const lines = rows.map((r) => [r.inviter, r.inviterUsername, r.invitee, r.inviteeUsername, r.joinedAt, r.played, r.verified, r.payout].map(csvCell).join(","));
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
