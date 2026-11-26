/**
 * Invite links: the Redis and chain reads behind lib/referrals.ts.
 *
 * Wallet activity comes from the stats aggregate (stats:v1:state), which records every wallet that
 * has emitted an event on the game contract and which kinds. It is read at most once a minute per
 * server instance. When it can't be read, "on chain" is unknown: a new invite is then decided by the
 * sign-in registry alone, and played counts are reported as unavailable rather than zero.
 */
import { createPublicClient, fallback, http, recoverMessageAddress } from "viem";
import { celo } from "viem/chains";
import { getRedis } from "../../app/api/_lib/redis";
import { getVerifications } from "../../app/api/_lib/verification";
import { loadState } from "./stats/store";
import type { AddrRow } from "./stats/state";
import {
  CLAIMED_KEY, PAYOUTS_KEY, REFERRALS_KEY, decideReferral, parsePayout, parseRecords, startedAGame,
  type PayoutRequest, type ReferralOutcome, type ReferralRecord,
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

/**
 * GoodDollar verification for these wallets (the shared, Redis-cached lookup the leaderboard uses):
 * true, false, or null when it couldn't be determined. Null is never treated as verified.
 */
export async function verificationOf(addresses: string[]): Promise<Record<string, boolean | null>> {
  return addresses.length ? getVerifications(addresses) : {};
}

/**
 * The same lookup for pages that must answer quickly: after `ms` it gives up and reports every
 * address as unknown (null) instead of making the page wait. The lookup keeps running and caches
 * what it finds, so the next request is fast. Payment requests use verificationOf, which waits.
 */
export async function verificationWithin(addresses: string[], ms = 5_000): Promise<Record<string, boolean | null>> {
  if (!addresses.length) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Record<string, boolean | null>>((resolve) => {
    timer = setTimeout(() => resolve(Object.fromEntries(addresses.map((a) => [a, null]))), ms);
  });
  try {
    return await Promise.race([getVerifications(addresses), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ── Payment requests ──────────────────────────────────────────────────────────

export async function payoutRequests(client: Redis): Promise<PayoutRequest[]> {
  const raw = await client.hGetAll(PAYOUTS_KEY);
  return Object.values(raw).map(parsePayout).filter((r): r is PayoutRequest => !!r);
}

export async function getPayout(client: Redis, id: string): Promise<PayoutRequest | null> {
  const raw = await client.hGet(PAYOUTS_KEY, id);
  return raw ? parsePayout(raw) : null;
}

export async function savePayout(client: Redis, req: PayoutRequest): Promise<void> {
  await client.hSet(PAYOUTS_KEY, req.id, JSON.stringify(req));
}

/** invitee -> id of the pending or paid request that includes them. */
export async function claimedInvitees(client: Redis): Promise<Record<string, string>> {
  return client.hGetAll(CLAIMED_KEY);
}

/** Marks these referrals as part of `requestId`, overwriting (used when a request is paid). */
export async function claimInvitees(client: Redis, invitees: string[], requestId: string): Promise<void> {
  if (invitees.length) await client.hSet(CLAIMED_KEY, Object.fromEntries(invitees.map((i) => [i, requestId])));
}

/**
 * Reserves each referral for `requestId` only if no other request holds it (HSETNX, one at a time),
 * so the same referral can never be in two requests whatever the timing. If any is already taken,
 * the ones reserved here are released again and false is returned.
 */
export async function reserveInvitees(client: Redis, invitees: string[], requestId: string): Promise<boolean> {
  const got: string[] = [];
  for (const i of invitees) {
    if (await client.hSetNX(CLAIMED_KEY, i, requestId)) { got.push(i); continue; }
    if ((await client.hGet(CLAIMED_KEY, i)) === requestId) continue;
    await releaseInvitees(client, got);
    return false;
  }
  return true;
}

export async function releaseInvitees(client: Redis, invitees: string[]): Promise<void> {
  if (invitees.length) await client.hDel(CLAIMED_KEY, invitees);
}

/**
 * Runs `fn` while holding the lock `name`. Returns "busy" when someone else holds it. The lock outlives
 * the slowest work it guards (LOCK_MS covers the verification lookup's 20 s on-chain budget with room
 * to spare) and is released only by its holder. It keeps double-clicks and two tabs (or two admins)
 * from racing; the referral reservations themselves are made safe by reserveInvitees.
 */
const LOCK_MS = 90_000;
export async function withLock<T>(client: Redis, name: string, fn: () => Promise<T>): Promise<T | "busy"> {
  const key = `payouts:v1:lock:${name}`;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const got = await client.set(key, token, { NX: true, PX: LOCK_MS });
  if (!got) return "busy";
  try {
    return await fn();
  } finally {
    if ((await client.get(key).catch(() => null)) === token) await client.del(key).catch(() => {});
  }
}

/** Lock for one player's payment request. */
export const withInviterLock = <T>(client: Redis, inviter: string, fn: () => Promise<T>) => withLock(client, `inviter:${inviter}`, fn);

// ── Wallet signatures ─────────────────────────────────────────────────────────

const RPC_URLS = (process.env.CELO_RPC_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);

/**
 * Whether `signature` is `address` signing `message`. An ordinary wallet is checked locally; any other
 * (a smart-contract wallet) is checked on chain, which covers ERC-1271 and ERC-6492. Throws only when
 * the on-chain check couldn't run.
 */
export async function verifyWalletSignature(address: string, message: string, signature: `0x${string}`): Promise<boolean> {
  const recovered = await recoverMessageAddress({ message, signature }).catch(() => null);
  if (recovered?.toLowerCase() === address.toLowerCase()) return true;
  const client = createPublicClient({
    chain: celo,
    transport: fallback((RPC_URLS.length ? RPC_URLS : ["https://forno.celo.org"]).map((u) => http(u, { timeout: 8_000 }))),
  });
  return client.verifyMessage({ address: address as `0x${string}`, message, signature });
}
