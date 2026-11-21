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
import type { Bounty, BountyRules, EligibilityItem, PrizePlace } from "../config/bounties";
import { UNKNOWN_ELIGIBILITY, eligibleWinners, prizeFor, type EntryEligibility } from "./bountyEligibility";

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

export interface LiveEntry { rank: number; id: string; username: string | null; xp: string; eligibility?: EntryEligibility }
/**
 * A winner carries no address: `profile` is the username (the profile route resolves it), or null.
 * For a bounty with rules, `rank` is the prize place among eligible players, `leaderboardRank` the
 * player's position on the race leaderboard, and `prizeUsd` the dollar-equivalent prize in G$.
 */
export interface Winner {
  rank: number;
  displayName: string | null;
  profile: string | null;
  xp: string;
  leaderboardRank?: number;
  prizeUsd?: number | null;
  eligibility?: EntryEligibility;
}

/** For a bounty with rules: how far the automated checks got, and what is left to the team. */
export interface ChecksStatus {
  /** Every block of the window has been read for purchases. */
  purchasesComplete: boolean;
  /** GoodDollar verification was read for every player it was needed for. */
  verificationAvailable: boolean;
  /** Requirements only the team can confirm. */
  manualChecks: string[];
  /** How many ranked players had their eligibility evaluated. */
  evaluatedPlayers: number;
  /** The prize places are settled: no player ranked above the last place is still unknown. */
  selectionComplete: boolean;
}

/** A live prize position: an entry (possibly ranked below the displayed list) and its place. */
export interface PrizePosition extends LiveEntry { place: number }

export type PublicStandings =
  | { phase: "upcoming" }
  | {
      phase: "live"; entries: LiveEntry[]; participants: number; checks?: ChecksStatus;
      /** Rule bounties: the highest-ranked players that currently pass every automated check. */
      prizePositions?: PrizePosition[];
    }
  | {
      phase: "final"; winners: Winner[]; participants: number; checks?: ChecksStatus;
      /** Rule bounties: winners stay provisional until the team makes the manual checks. */
      provisional?: boolean;
      /** Rule bounties: false while some data needed to pick the winners is still missing. */
      complete?: boolean;
    }
  | { phase: "unavailable" };

/** What the API knows about eligibility for a bounty with rules. */
export interface EligibilityInput {
  rules: BountyRules;
  prizeTable?: PrizePlace[];
  eligibility: Map<string, EntryEligibility>; // by lowercase player id; players not evaluated are unknown
  checks: Omit<ChecksStatus, "selectionComplete">;
}

export function publicStandings(status: "upcoming" | "live" | "ended", rows: StandingRow[] | null, elig?: EligibilityInput): PublicStandings {
  if (status === "upcoming") return { phase: "upcoming" };
  if (!rows) return { phase: "unavailable" };
  const eligibilityOf = (r: StandingRow) => elig?.eligibility.get(r.id) ?? UNKNOWN_ELIGIBILITY;
  // Rule bounties: walk the whole ranking, not a fixed top N. A player who wasn't evaluated, or
  // whose checks couldn't be read, is unknown, and an unknown above the last pick leaves the
  // selection incomplete rather than skipping that player.
  const pick = elig ? eligibleWinners(rows, eligibilityOf, WINNER_COUNT) : null;
  const checks: ChecksStatus | undefined = elig && pick ? { ...elig.checks, selectionComplete: pick.complete } : undefined;
  const entryOf = (r: StandingRow, index: number): LiveEntry => ({
    rank: index + 1, id: r.id, username: r.username, xp: r.bountyXp.toString(),
    ...(elig ? { eligibility: eligibilityOf(r) } : {}),
  });
  if (status === "live") {
    return {
      phase: "live",
      participants: rows.length,
      entries: rows.slice(0, LIVE_LIMIT).map(entryOf),
      ...(checks && pick ? { checks, prizePositions: pick.winners.map(({ row, index }, i) => ({ ...entryOf(row, index), place: i + 1 })) } : {}),
    };
  }
  if (elig && pick && checks) {
    return {
      phase: "final",
      participants: rows.length,
      winners: pick.winners.map(({ row, index }, i) => {
        const name = row.username?.trim() || null;
        return {
          rank: i + 1, displayName: name, profile: name, xp: row.bountyXp.toString(),
          leaderboardRank: index + 1, prizeUsd: prizeFor(elig.prizeTable, i + 1), eligibility: eligibilityOf(row),
        };
      }),
      checks,
      provisional: true,
      complete: pick.complete,
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
  prizeTable?: PrizePlace[];
  eligibility?: EligibilityItem[];
  rules?: BountyRules;
  timeZone?: { iana: string; label: string };
  status: "upcoming" | "live" | "ended";
  standings: PublicStandings;
}

export function toPublicBounty(b: Bounty, index: number, status: PublicBounty["status"], standings: PublicStandings): PublicBounty {
  return {
    id: b.id, number: index + 1, title: b.title, description: b.description, startTime: b.startTime, endTime: b.endTime,
    prizes: b.prizes, howToParticipate: b.howToParticipate, winnerCriteria: b.winnerCriteria,
    ...(b.prizeTable ? { prizeTable: b.prizeTable } : {}),
    ...(b.eligibility ? { eligibility: b.eligibility } : {}),
    ...(b.rules ? { rules: b.rules } : {}),
    ...(b.timeZone ? { timeZone: b.timeZone } : {}),
    status, standings,
  };
}
