/**
 * Bounty standings: who earned the most XP inside a bounty's window, and what the public may see.
 *
 * XP is never computed here, only compared: each player's cumulative XP is read from the subgraph
 * (XpEarned.total) at the bounty's start block and at its end block (or the latest block while it
 * is live), and the bounty XP is the difference. Only players the subgraph marks verified at the
 * later block count, as the page has always done.
 *
 * Ranking: bounty XP, highest first; ties go to the earliest player (firstSeen), then the lower
 * address. That is the same deterministic tie-break the main leaderboard uses.
 *
 * Public view: a live bounty shows its current standings (top 50, as before). A completed bounty
 * shows only its five winners, by name and XP, with no wallet addresses; the full standings stay
 * in the subgraph's history and are never sent to the page.
 */
import type { Bounty } from "../config/bounties";

export const LIVE_LIMIT = 50;
export const WINNER_COUNT = 5;

export interface PlayerSnapshot {
  id: string; // lowercase address
  xp: bigint; // cumulative XP at the snapshot block
  username: string | null;
  firstSeen: number; // seconds epoch
}

export interface StandingRow {
  id: string;
  username: string | null;
  firstSeen: number;
  bountyXp: bigint;
}

export function rankStandings(start: Map<string, PlayerSnapshot>, end: Map<string, PlayerSnapshot>): StandingRow[] {
  const rows: StandingRow[] = [];
  end.forEach((p, id) => {
    const before = start.get(id)?.xp ?? 0n;
    const gained = p.xp > before ? p.xp - before : 0n;
    if (gained > 0n) rows.push({ id, username: p.username, firstSeen: p.firstSeen, bountyXp: gained });
  });
  return rows.sort(compareStandings);
}

export function compareStandings(a: StandingRow, b: StandingRow): number {
  if (a.bountyXp !== b.bountyXp) return a.bountyXp > b.bountyXp ? -1 : 1;
  if (a.firstSeen !== b.firstSeen) return a.firstSeen - b.firstSeen;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ── What the public API returns ──────────────────────────────────────────

export interface LiveEntry { rank: number; id: string; username: string | null; xp: string }
/** A winner carries no address: `profile` is the username (the profile route resolves it), or null. */
export interface Winner { rank: number; displayName: string | null; profile: string | null; xp: string }

export type PublicStandings =
  | { phase: "upcoming" }
  | { phase: "live"; entries: LiveEntry[]; participants: number }
  | { phase: "final"; winners: Winner[]; participants: number }
  | { phase: "unavailable" };

export function publicStandings(status: "upcoming" | "live" | "ended", rows: StandingRow[] | null): PublicStandings {
  if (status === "upcoming") return { phase: "upcoming" };
  if (!rows) return { phase: "unavailable" };
  if (status === "live") {
    return {
      phase: "live",
      participants: rows.length,
      entries: rows.slice(0, LIVE_LIMIT).map((r, i) => ({ rank: i + 1, id: r.id, username: r.username, xp: r.bountyXp.toString() })),
    };
  }
  return {
    phase: "final",
    participants: rows.length,
    winners: rows.slice(0, WINNER_COUNT).map((r, i) => {
      const name = r.username?.trim() || null;
      return { rank: i + 1, displayName: name, profile: name, xp: r.bountyXp.toString() };
    }),
  };
}

export interface PublicBounty {
  id: string;
  number: number; // 1-based, in configured (chronological) order
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  prizes: string;
  howToParticipate: string[];
  winnerCriteria: string;
  status: "upcoming" | "live" | "ended";
  standings: PublicStandings;
}

export function toPublicBounty(b: Bounty, index: number, status: PublicBounty["status"], standings: PublicStandings): PublicBounty {
  return {
    id: b.id, number: index + 1, title: b.title, description: b.description, startTime: b.startTime, endTime: b.endTime,
    prizes: b.prizes, howToParticipate: b.howToParticipate, winnerCriteria: b.winnerCriteria, status, standings,
  };
}
