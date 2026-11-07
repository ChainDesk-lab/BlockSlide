/**
 * Season rewards configuration.
 *
 * Nothing here is live until a BlockSlideRewards contract is deployed and its
 * address is configured. With no address the app shows "Rewards contract not
 * deployed" and no figures.
 *
 * The economics are NOT hard-coded into the claim path: amounts, thresholds
 * and caps are read from the contract's season configuration. PROPOSED_RULE is
 * used only to explain the proposal and to label estimates before a season
 * exists, and is always shown as proposed.
 */
import { getAddress } from "viem";

export type ParametersStatus = "proposed" | "approved";

/** Proposed, unapproved: 5,000 eligible XP -> 10 G$, at most 50 G$ per identity per season. */
export const PROPOSED_RULE = {
  xpPerUnit: 5_000n,
  rewardPerUnitWei: 10n * 10n ** 18n,
  maxUnitsPerIdentity: 5n,
  status: "proposed" as ParametersStatus,
} as const;

export interface RewardsConfig {
  address: `0x${string}`;
  deployBlock: number;
  season: number;
  /** "approved" only when explicitly configured after the policy is approved. */
  parametersStatus: ParametersStatus;
  /** Season window the server-side XP estimate is tallied for. */
  estimateWindow: { startBlock: number; endBlock: number | null } | null;
}

export interface ConfigResult {
  config: RewardsConfig | null;
  /** Set when some variables are present but invalid, so it isn't silently "not deployed". */
  error: string | null;
}

type Env = Record<string, string | undefined>;

function positiveInt(v: string | undefined): number | null {
  if (v === undefined || !/^\d+$/.test(v.trim())) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Pure, so it can be tested; call with process.env (NEXT_PUBLIC_* in the browser). */
export function parseRewardsConfig(env: Env): ConfigResult {
  const raw = env.NEXT_PUBLIC_REWARDS_ADDRESS?.trim();
  if (!raw) return { config: null, error: null };
  let address: `0x${string}`;
  try {
    address = getAddress(raw);
  } catch {
    return { config: null, error: `NEXT_PUBLIC_REWARDS_ADDRESS is not a valid address` };
  }
  const deployBlock = positiveInt(env.NEXT_PUBLIC_REWARDS_DEPLOY_BLOCK);
  const season = positiveInt(env.NEXT_PUBLIC_REWARDS_SEASON);
  if (deployBlock === null) return { config: null, error: "NEXT_PUBLIC_REWARDS_DEPLOY_BLOCK must be set with the address" };
  if (season === null) return { config: null, error: "NEXT_PUBLIC_REWARDS_SEASON must be set with the address" };
  const status = env.NEXT_PUBLIC_REWARDS_PARAMS_STATUS === "approved" ? "approved" : "proposed";
  return { config: { address, deployBlock, season, parametersStatus: status, estimateWindow: parseEstimateWindow(env) }, error: null };
}

export function parseEstimateWindow(env: Env): RewardsConfig["estimateWindow"] {
  const start = positiveInt(env.REWARDS_SEASON_START_BLOCK ?? env.NEXT_PUBLIC_REWARDS_SEASON_START_BLOCK);
  if (start === null) return null;
  const endRaw = env.REWARDS_SEASON_END_BLOCK ?? env.NEXT_PUBLIC_REWARDS_SEASON_END_BLOCK;
  const end = positiveInt(endRaw);
  if (endRaw && (end === null || end < start)) return null;
  return { startBlock: start, endBlock: end };
}

// Next inlines NEXT_PUBLIC_* only for literal property reads, so list them.
export const rewardsConfig: ConfigResult = parseRewardsConfig({
  NEXT_PUBLIC_REWARDS_ADDRESS: process.env.NEXT_PUBLIC_REWARDS_ADDRESS,
  NEXT_PUBLIC_REWARDS_DEPLOY_BLOCK: process.env.NEXT_PUBLIC_REWARDS_DEPLOY_BLOCK,
  NEXT_PUBLIC_REWARDS_SEASON: process.env.NEXT_PUBLIC_REWARDS_SEASON,
  NEXT_PUBLIC_REWARDS_PARAMS_STATUS: process.env.NEXT_PUBLIC_REWARDS_PARAMS_STATUS,
  REWARDS_SEASON_START_BLOCK: process.env.REWARDS_SEASON_START_BLOCK,
  REWARDS_SEASON_END_BLOCK: process.env.REWARDS_SEASON_END_BLOCK,
  NEXT_PUBLIC_REWARDS_SEASON_START_BLOCK: process.env.NEXT_PUBLIC_REWARDS_SEASON_START_BLOCK,
  NEXT_PUBLIC_REWARDS_SEASON_END_BLOCK: process.env.NEXT_PUBLIC_REWARDS_SEASON_END_BLOCK,
});

export const CELOSCAN_TX = (hash: string) => `https://celoscan.io/tx/${hash}`;
export const CELOSCAN_ADDRESS = (addr: string) => `https://celoscan.io/address/${addr}`;
