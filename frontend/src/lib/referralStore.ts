/**
 * Invite links: the Redis and chain reads behind lib/referrals.ts.
 *
 * Wallet activity comes from the stats aggregate (stats:v1:state), which records every wallet that
 * has emitted an event on the game contract and which kinds. It is read at most once a minute per
 * server instance. When it can't be read, "on chain" is unknown: a new invite is then decided by the
 * sign-in registry alone, and played counts are reported as unavailable rather than zero.
 */
import { getRedis } from "../../app/api/_lib/redis";
import { loadState } from "./stats/store";
import type { AddrRow } from "./stats/state";
import {
  REFERRALS_KEY, decideReferral, parseRecords, startedAGame,
  type ReferralOutcome, type ReferralRecord,
} from "./referrals";

const REGISTRY_KEY = "players:registry";
const ACTIVITY_TTL_MS = 60_000;

type Redis = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

let activity: { at: number; addrs: Record<string, AddrRow> } | null = null;

/** Every wallet active on the game contract, or null when the stats store can't be read. */
export async function walletActivity(): Promise<Record<string, AddrRow> | null> {
  if (activity && Date.now() - activity.at < ACTIVITY_TTL_MS) return activity.addrs;
  const load = await loadState();
  if (load.status !== "ok") return activity?.addrs ?? null;
  activity = { at: Date.now(), addrs: load.state.addrs };
  return activity.addrs;
}

/**
 * Records `invitee` as invited by `referrer` if the rules in lib/referrals.ts allow it.
 * `inviteeInRegistry` must be read before this sign-in writes the registry entry.
 */
export async function recordReferral(
  client: Redis,
  input: { invitee: string; referrer: string | null; inviteeInRegistry: boolean },
): Promise<ReferralOutcome> {
  // The cheap checks first; the reads below run only for a new wallet with a usable ref.
  const early = decideReferral({ ...input, inviteeOnChain: false, referrerKnown: true });
  if (early !== "ok") return early;
  const addrs = await walletActivity();
  const referrerKnown = !!addrs?.[input.referrer as string] || !!(await client.hGet(REGISTRY_KEY, input.referrer as string));
  const decision = decideReferral({
    invitee: input.invitee,
    referrer: input.referrer,
    inviteeInRegistry: input.inviteeInRegistry,
    inviteeOnChain: !!addrs?.[input.invitee],
    referrerKnown,
  });
  if (decision !== "ok") return decision;
  const record: ReferralRecord = { referrer: input.referrer as string, at: Date.now() };
  const added = await client.hSetNX(REFERRALS_KEY, input.invitee, JSON.stringify(record));
  return added ? "recorded" : "already_referred";
}

export async function allReferrals(client: Redis): Promise<Record<string, ReferralRecord>> {
  return parseRecords(await client.hGetAll(REFERRALS_KEY));
}

/** Registry usernames for these addresses (null when unset or unknown). */
export async function registryUsernames(client: Redis, addresses: string[]): Promise<Record<string, string | null>> {
  if (addresses.length === 0) return {};
  const raw = await client.hmGet(REGISTRY_KEY, addresses);
  const out: Record<string, string | null> = {};
  addresses.forEach((a, i) => {
    let name: string | null = null;
    try { name = raw[i] ? ((JSON.parse(raw[i] as string) as { username?: string | null }).username ?? null) : null; } catch { /* unreadable entry */ }
    out[a] = name;
  });
  return out;
}

/** played(invitee), or null when activity is unknown. */
export function playedFn(addrs: Record<string, AddrRow> | null): ((invitee: string) => boolean) | null {
  return addrs ? (invitee) => startedAGame(addrs[invitee]) : null;
}
