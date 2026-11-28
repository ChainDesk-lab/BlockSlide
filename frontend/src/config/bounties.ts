/** One prize place: a dollar-equivalent amount, paid in G$ (no token quantity is implied). */
export interface PrizePlace {
  place: number; // 1-based
  usd: number;
}

/**
 * Winner rules a bounty can opt into. Without rules, a bounty keeps the original behaviour (top
 * five by XP earned in the window). With rules, the API checks what it can on-chain and lists
 * the rest as checks the team makes before paying out (see lib/bountyEligibility).
 */
export interface BountyRules {
  /** Winners must pass GoodDollar's Identity.isWhitelisted, read on-chain. */
  goodDollarVerified?: boolean;
  /** Winners need at least this many successful Shop purchases inside the bounty window. */
  minPurchases?: number;
  /** Requirements the app can't check (for example an X follow); the team confirms them. */
  manualChecks?: string[];
}

/** An eligibility requirement and who checks it: the app (on-chain or leaderboard) or the team. */
export interface EligibilityItem {
  text: string;
  check: "on-chain" | "leaderboard" | "team";
}

export interface Bounty {
  id: string;
  title: string;
  description: string;
  startTime: string; // ISO UTC
  endTime: string;   // ISO UTC
  prizes: string;
  howToParticipate: string[];
  winnerCriteria: string;
  /** Optional per-place prizes, shown as a table. */
  prizeTable?: PrizePlace[];
  /** Optional eligibility requirements, shown as their own list with how each one is checked. */
  eligibility?: EligibilityItem[];
  rules?: BountyRules;
  /** Time zone the bounty is announced in, for display (times are stored in UTC). */
  timeZone?: { iana: string; label: string };
  /**
   * Exact window: the start is inclusive and the end exclusive, and both are resolved to exact
   * blocks (the first block at or after each time), so XP and purchases count only in blocks
   * timestamped at or after the start and before the end. Without it a bounty keeps the original
   * rule: the end instant is still live, and each boundary uses the block nearest in time.
   */
  exactWindow?: boolean;
  /**
   * Rule bounties, once the team has finished every check (on-chain and manual): the final
   * winners by place. When set on an ended bounty, the page shows exactly these players as the
   * final winners (not provisional), with their race XP from the standings, and skips the
   * on-chain purchase scan, so the result can't be held back by a slow or incomplete read.
   * `username` is matched (case-insensitively) against the race standings.
   */
  confirmedWinners?: { place: number; username: string }[];
}

// Bounty times: Aug 1 2026 12:00 PM WAT (UTC+1) = 2026-08-01T11:00:00Z
// Bounty times: Aug 3 2026 23:59:59 WAT (UTC+1) = 2026-08-03T22:59:59Z
// Bounty #2 times: Aug 7 2026 12:00 PM WAT (UTC+1) = 2026-08-07T11:00:00Z
// Bounty #2 times: Aug 14 2026 12:00 PM WAT (UTC+1) = 2026-08-14T11:00:00Z
// Bounty #3 times: Aug 17 2026 12:00 PM WAT (UTC+1) = 2026-08-17T11:00:00Z (Sunday) [STARTED TODAY]
// Bounty #3 times: Aug 25 2026 12:00 PM WAT (UTC+1) = 2026-08-25T11:00:00Z
//
// Scheduling: list bounties in start order, with ISO UTC times; they must not overlap.
// src/lib/bountySchedule.test.ts checks this list (scheduleProblems), so a bad entry fails CI.
// For a recurring run, spread recurringBounties({ idPrefix, firstStart, everyDays, durationDays,
// count, details }) from src/lib/bountySchedule.ts into this array. It only computes dates; the
// prize text and rules in `details` must be the team's approved values.
export const bounties: Bounty[] = [
  {
    id: "bounty-1",
    title: "BlockSlide Launch Bounty",
    description: "Join the BlockSlide launch celebration! Compete with verified players worldwide to earn top rankings and prizes.",
    startTime: "2026-08-01T11:00:00Z",
    endTime: "2026-08-03T22:59:59Z",
    prizes: "$30 prize pool",
    howToParticipate: [
      "Follow BlockSlide on X (@BlockSlideGame)",
      "Join our Telegram community for updates and tips",
      "Sign up on blockslide.app via email or wallet",
      "Verify your identity with GoodDollar (one-face-one-wallet)",
      "Play games during the bounty period",
      "Use shop boosts to climb faster on the leaderboard",
    ],
    winnerCriteria: "Top 5 verified players by XP earned during the bounty period",
  },
  {
    id: "bounty-2",
    title: "BlockSlide Week 2 Bounty",
    description: "Keep the momentum going! Compete in our second bounty week with verified players worldwide to earn top rankings and prizes.",
    startTime: "2026-08-07T11:00:00Z",
    endTime: "2026-08-14T11:00:00Z",
    prizes: "$20 prize pool",
    howToParticipate: [
      "Follow BlockSlide on X (@BlockSlideGame)",
      "Join our Telegram community for updates and tips",
      "Sign up on blockslide.app via email or wallet",
      "Verify your identity with GoodDollar (one-face-one-wallet)",
      "Play games during the bounty period",
      "Use shop boosts to climb faster on the leaderboard",
    ],
    winnerCriteria: "Top 5 verified players by XP earned during the bounty period",
  },
  {
    id: "bounty-3",
    title: "BlockSlide Week 3 Bounty",
    description: "The competition continues! Join our third bounty week to prove your skills and compete for prizes with verified players worldwide.",
    startTime: "2026-08-17T11:00:00Z",
    endTime: "2026-08-25T11:00:00Z",
    prizes: "$25 prize pool",
    howToParticipate: [
      "Follow BlockSlide on X (@BlockSlideGame)",
      "Join our Telegram community for updates and tips",
      "Sign up on blockslide.app via email or wallet",
      "Verify your identity with GoodDollar (one-face-one-wallet)",
      "Play games during the bounty period",
      "Use shop boosts to climb faster on the leaderboard",
    ],
    winnerCriteria: "Top 5 verified players by XP earned during the bounty period",
  },
  // Season 5 Leaderboard Race: 21 Nov 2026 1:00 PM WAT (UTC+1) = 2026-11-21T12:00:00Z,
  // to 26 Nov 2026 1:00 PM WAT = 2026-11-26T12:00:00Z (5 days). Fresh standings: XP earned
  // inside the window only; the main leaderboard keeps every player's full XP as before.
  {
    id: "bounty-4",
    title: "Season 5 Leaderboard Race",
    description: "Five days, a fresh leaderboard: everyone starts the race at 0 XP. The XP you earn during the race counts here and on the main leaderboard, exactly as usual.",
    startTime: "2026-11-21T12:00:00Z",
    endTime: "2026-11-26T12:00:00Z",
    prizes: "$30 equivalent in G$",
    prizeTable: [
      { place: 1, usd: 10 },
      { place: 2, usd: 7 },
      { place: 3, usd: 5 },
      { place: 4, usd: 5 },
      { place: 5, usd: 3 },
    ],
    howToParticipate: [
      "Sign in on blockslide.app with email or a wallet",
      "Verify your identity with GoodDollar (one face, one wallet)",
      "Play during the race: all the XP you earn counts",
      "Make at least 10 Shop purchases during the race",
      "Follow @blockslide_app on X",
    ],
    eligibility: [
      { text: "Follow @blockslide_app on X", check: "team" },
      { text: "Be GoodDollar verified", check: "on-chain" },
      { text: "Complete at least 10 qualifying BlockSlide Shop purchases during the race", check: "on-chain" },
      { text: "Finish in the top five eligible players on the race leaderboard", check: "leaderboard" },
    ],
    rules: {
      goodDollarVerified: true,
      minPurchases: 10,
      manualChecks: ["Follows @blockslide_app on X"],
    },
    winnerCriteria: "The five highest-ranked eligible players by XP earned during the race",
    timeZone: { iana: "Africa/Lagos", label: "WAT" },
    // Confirmed by the team on 27 Nov 2026: the only three players who met every rule (GoodDollar
    // verified, 10+ paid Shop purchases inside the race window, X follow). Places 4 and 5 unfilled.
    confirmedWinners: [
      { place: 1, username: "1234" },
      { place: 2, username: "Boloooo" },
      { place: 3, username: "Xthehacker" },
    ],
    // Start inclusive (13:00:00 WAT counts), end exclusive (13:00:00 WAT on 26 Nov doesn't).
    exactWindow: true,
  },
];

export function getBountyStatus(bounty: Bounty, now: Date = new Date()): "upcoming" | "live" | "ended" {
  const startTime = new Date(bounty.startTime);
  const endTime = new Date(bounty.endTime);

  if (now < startTime) return "upcoming";
  if (bounty.exactWindow ? now < endTime : now <= endTime) return "live";
  return "ended";
}
