/**
 * A synthetic multi-week history for the stats reseed tests: eight old wallets, four that first
 * appear inside a two-day gap in September, per-day detail starting mid-day on 4 Nov (as on
 * production), rewards outside the gap. Shared by reseed.test.ts and reseedPlan.test.ts.
 */
import { encodeAbiParameters, toEventSelector } from "viem";
import { ANCHOR_BLOCK, ANCHOR_TIME } from "./config";
import { applyLogs, type StatsState } from "./state";
import { buildState, sortLogs, type GapLog } from "./reseed";

export const FIXED_AT = "2026-11-07T00:00:00.000Z";
export const wallet = (n: number) => "0x" + n.toString(16).padStart(40, "0");
export const topicOf = (a: string) => "0x" + "0".repeat(24) + a.slice(2);
export const SEL = {
  username: toEventSelector("event UsernameSet(address,string)"),
  session: toEventSelector("event SessionStarted(address)"),
  score: toEventSelector("event ScoreSubmitted(address,uint256,uint32)"),
  xp: toEventSelector("event XpEarned(address,uint256,uint256)"),
  streak: toEventSelector("event StreakUpdated(address,uint256)"),
  reward: toEventSelector("event RewardPaid(address,uint32,uint256)"),
  shield: toEventSelector("event ShieldPurchased(address,uint256,uint256)"),
  other: toEventSelector("event Upgraded(address)"),
};

export function blockAt(day: string, hour = 12): number {
  const unix = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`) / 1000;
  return ANCHOR_BLOCK + (unix - ANCHOR_TIME);
}
export const mk = (sel: string, w: number | null, block: number, logIndex: number, data?: string): GapLog => ({
  blockNumber: block, logIndex, topics: w === null ? [sel] : [sel, topicOf(wallet(w))], transactionHash: "0x" + block.toString(16), data,
});
export const scoreData = (s: bigint, tile: number) => encodeAbiParameters([{ type: "uint256" }, { type: "uint32" }], [s, tile]);
export const rewardData = (milestone: number, wei: bigint) => encodeAbiParameters([{ type: "uint32" }, { type: "uint256" }], [milestone, wei]);

export const D = blockAt("2026-11-04", 10); // per-day detail starts mid-day, as on production
export const CP = blockAt("2026-11-06", 23); // checkpoint
export const GAP_FROM = blockAt("2026-09-22", 12);
export const GAP_TO = blockAt("2026-09-24", 12);

/** Eight old wallets active all along; wallets 9-12 first appear inside the gap; 13-14 after it. */
export function timeline(): GapLog[] {
  const logs: GapLog[] = [];
  const kinds = ["session", "score", "xp", "streak", "username", "shield", "other"] as const;
  for (let i = 0; i < 58; i++) {
    const day = new Date(Date.UTC(2026, 8, 10 + i)).toISOString().slice(0, 10);
    const n = 3 + (i % 4);
    for (let k = 0; k < n; k++) {
      const kind = kinds[(i + k) % kinds.length];
      const w = 1 + ((i * 5 + k * 3) % 8);
      const block = blockAt(day, 5 + k * 2);
      if (kind === "other") logs.push(mk(SEL.other, null, block, 0));
      else if (kind === "score") { logs.push(mk(SEL.score, w, block, 0, scoreData(BigInt(1000 + i * 10 + k), 256))); logs.push(mk(SEL.xp, w, block, 1)); }
      else logs.push(mk(SEL[kind], w, block, 0));
    }
  }
  // Extra logs get log index 9, so none shares a (block, logIndex) with the generated ones.
  const X = (sel: string, w: number, block: number, data?: string) => mk(sel, w, block, 9, data);
  // Wallets that first appear inside the gap (22-24 Sep), and later ones.
  logs.push(X(SEL.username, 9, blockAt("2026-09-22", 14)), X(SEL.session, 9, blockAt("2026-09-22", 15)));
  logs.push(X(SEL.username, 10, blockAt("2026-09-23", 9)), X(SEL.session, 10, blockAt("2026-09-23", 10)), X(SEL.score, 10, blockAt("2026-09-23", 11), scoreData(500n, 128)));
  logs.push(X(SEL.session, 11, blockAt("2026-09-23", 16)), X(SEL.username, 12, blockAt("2026-09-24", 8)));
  logs.push(X(SEL.session, 9, blockAt("2026-10-10", 9))); // wallet 9 is seen again long after the gap
  logs.push(X(SEL.username, 13, blockAt("2026-10-12", 9)), X(SEL.session, 14, blockAt("2026-10-13", 9)));
  // Rewards, both outside the gap.
  logs.push(X(SEL.reward, 2, blockAt("2026-09-15", 7), rewardData(256, 10n * 10n ** 18n)));
  logs.push(X(SEL.reward, 5, blockAt("2026-10-20", 7), rewardData(512, 20n * 10n ** 18n)));
  // Activity after per-day detail began (D is 10:00 on 4 Nov).
  logs.push(X(SEL.session, 1, blockAt("2026-11-04", 11)), X(SEL.session, 9, blockAt("2026-11-05", 9)), X(SEL.score, 3, blockAt("2026-11-05", 10), scoreData(900n, 64)));
  return sortLogs(logs);
}

export const inGap = (l: GapLog) => l.blockNumber >= GAP_FROM && l.blockNumber <= GAP_TO;
export const world = () => {
  const all = timeline();
  const gap = all.filter(inGap);
  const rest = all.filter((l) => !inGap(l));
  const opts = { checkpointBlock: CP, detailSinceBlock: D, updatedAt: FIXED_AT };
  return { all, gap, rest, opts, complete: buildState(all, opts), stored: buildState(rest, opts) };
};

/** New logs above the checkpoint: an old wallet again, a brand-new wallet, and a later UTC day. */
export const LATER_CP = CP + 100_000;
export const laterLogs = (): GapLog[] => [
  mk(SEL.session, 1, CP + 100, 9),
  mk(SEL.username, 20, CP + 200, 9),
  mk(SEL.session, 20, CP + 90_000, 9),
];

/** `state` after the app's own refresh scanned `logs` and moved the checkpoint to `cp`. */
export function advance(state: StatsState, logs: GapLog[], cp: number): StatsState {
  const next = structuredClone(state);
  applyLogs(next, sortLogs(logs), cp);
  return next;
}
