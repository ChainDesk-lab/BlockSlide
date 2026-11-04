/**
 * Season 5 view model (Phase 4). Pure functions over the public API's JSON:
 * labels, formatting and the reward line. The browser never calculates or
 * authorizes a reward; it only describes what the backend returned.
 *
 * Distinctions kept on screen: unverified, excluded and flagged XP;
 * provisional vs final-candidate vs approved calculations; and "paid", which
 * this model can't produce because the backend never reports a payout yet.
 */

export type SeasonState = "not-configured" | "unavailable" | "draft" | "approved" | "active" | "closed";

export interface PublicRules {
  rulesVersion: string; xpPerUnit: string; rewardPerUnitWei: string; maxUnitsPerWallet: string; perWallet: boolean;
  boostedXpCounts: boolean; bountiesCountTowardCap: boolean; goodDollarRequired: boolean; ownershipProofRequired: boolean;
  supportedWallets: "eoa-only"; manualApprovalRequired: boolean;
}
export interface StatusResponse {
  state: SeasonState; message?: string;
  season: { id: number; name: string; startTimeUtc: string; endTimeUtc: string; startBlock: string; endBlock: string; rulesVersion: string } | null;
  rules: PublicRules;
  bounty: { budgetUsdCents: number; budgetApproval: string; split: "unresolved"; payoutDenomination: "unresolved" };
  payouts: { executed: boolean };
}
export interface LeaderboardResponse {
  state: "not-configured" | "no-calculation" | "calculated"; message?: string;
  presentation?: "final-candidate" | "provisional-blocked"; approval?: Approval; calculatedAt?: string;
  entries?: Array<{ rank: number; wallet: string; eligibleXp: string; verifiedXp: string; unverifiedXp: string }>;
}
export type Approval = "approved" | "not-approved" | "rejected" | "approval-stale";
export interface WalletResponse {
  state: "not-configured" | "no-calculation" | "calculated"; message?: string; wallet?: string;
  calculationId?: string; calculatedAt?: string; presentation?: "final-candidate" | "provisional-blocked"; approval?: Approval;
  approvedAt?: string | null; blockedBecause?: string[];
  xp?: { eligible: string; verified: string; unverified: string; excluded: string };
  conversion?: { units: string; amountWei: string; status: "approved-unpaid" | "calculated-awaiting-approval" } | null;
  games?: Array<{ gameId: string; txHash: string; logIndex: number; status: "verified" | "unverified" | "excluded"; eligibleXp: string; reasons: string[]; flagged: boolean }>;
  /** Games are paged (Phase 5): this page's offset, the page size and the wallet's total. */
  gamesPage?: { offset: number; limit: number; total: number };
  payout?: { status: "not-paid"; txHash: null };
}

export const SEASON_STATE_LABEL: Record<SeasonState, string> = {
  "not-configured": "Not started",
  unavailable: "Unavailable",
  draft: "In preparation",
  approved: "Approved, not started",
  active: "Active",
  closed: "Closed: rewards under review",
};

/** Whole-number XP with thousands separators, from a decimal string. Never via floating point. */
export function formatXp(s: string | undefined): string {
  if (!s || !/^[0-9]+$/.test(s)) return "—";
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** G$ from 18-decimal base units, using integer arithmetic only. */
export function formatG(wei: string): string {
  if (!/^[0-9]+$/.test(wei)) return "—";
  const v = BigInt(wei);
  const whole = v / 10n ** 18n;
  const cents = (v % 10n ** 18n) / 10n ** 16n;
  return `${formatXp(whole.toString())}${cents ? `.${cents.toString().padStart(2, "0")}` : ""} G$`;
}

export function rulesSummary(r: PublicRules): string[] {
  const perUnit = formatG(r.rewardPerUnitWei);
  const cap = formatG((BigInt(r.rewardPerUnitWei) * BigInt(r.maxUnitsPerWallet)).toString());
  return [
    `${formatXp(r.xpPerUnit)} eligible Season 5 XP = ${perUnit}, up to ${cap} per wallet.`,
    r.boostedXpCounts ? "XP from purchased boosts counts." : "XP from purchased boosts doesn't count.",
    "Each wallet is treated on its own.",
    r.bountiesCountTowardCap ? "Bounty awards count toward that cap." : "Bounty awards are separate and don't count toward that cap.",
    r.goodDollarRequired ? "GoodDollar verification is required." : "GoodDollar verification is shown as a marker; it isn't required.",
    "Rewards need proof that you own the wallet (a free signature) and a manual review before anything is paid.",
    "Only regular wallets (EOAs) can prove ownership today; smart-contract wallets aren't supported yet.",
  ];
}

export type Tone = "neutral" | "info" | "warn" | "good";
export interface RewardLine { title: string; tone: Tone; amount: string | null; detail: string }

/** One honest sentence about a wallet's reward. Can never say "paid". */
export function rewardLine(w: WalletResponse): RewardLine {
  if (w.state === "not-configured") return { title: "Season 5 hasn't started", tone: "neutral", amount: null, detail: w.message ?? "No Season 5 XP is counted yet." };
  if (w.state === "no-calculation") return { title: "No calculation yet", tone: "neutral", amount: null, detail: "Rewards are calculated by the BlockSlide backend during and after the season." };
  if (w.presentation === "provisional-blocked") {
    return { title: "Provisional", tone: "warn", amount: null,
      detail: `The season's data isn't complete yet${w.blockedBecause?.length ? ` (${w.blockedBecause.join(", ")})` : ""}, so no reward amount is shown.` };
  }
  if (w.approval === "rejected") return { title: "Under re-review", tone: "warn", amount: null, detail: "A reviewer sent this calculation back; a new one will follow." };
  if (w.approval === "approval-stale") return { title: "Under re-review", tone: "warn", amount: null, detail: "The data changed after approval, so the season must be reviewed again." };
  if (!w.conversion) return { title: "No reward", tone: "neutral", amount: null, detail: "This wallet has no eligible XP in the current calculation." };
  if (w.conversion.status === "approved-unpaid") {
    return { title: "Approved, not paid yet", tone: "good", amount: formatG(w.conversion.amountWei), detail: "A reviewer approved this amount. It hasn't been sent yet." };
  }
  return { title: "Calculated, awaiting manual approval", tone: "info", amount: formatG(w.conversion.amountWei),
    detail: "This is the backend's calculation. It isn't approved or paid." };
}

export const GAME_STATUS_LABEL = {
  verified: "Verified (replayed)",
  unverified: "Unverified",
  excluded: "Excluded",
} as const;

/** The legend shown next to every Season 5 figure. */
export const STATUS_LEGEND: Array<[string, string]> = [
  ["Unverified XP", "Counted from on-chain results but not yet confirmed by replaying the game. Today every game is unverified: move-list replay isn't built yet."],
  ["Excluded XP", "Not counted, for example outside the season window or reorganised off the chain."],
  ["Flagged game", "Counted or excluded with a note a reviewer must look at, such as a reused seed."],
  ["Provisional", "The season's data isn't complete or consistent yet. No reward amount is shown."],
  ["Calculated, awaiting approval", "A complete calculation that a person still has to approve."],
  ["Approved, not paid", "A person approved the amount. Nothing has been sent yet."],
  ["Paid", "Only shown once a payout transaction is confirmed on-chain. No Season 5 payouts have been made."],
];

export function shortAddress(a: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
