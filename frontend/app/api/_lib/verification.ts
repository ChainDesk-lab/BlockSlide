import { createPublicClient, http, type Address } from "viem";
import { celo } from "viem/chains";
import { IDENTITY_ADDRESS } from "../../../src/lib/constants";
import { getRedis } from "./redis";

/**
 * Shared GoodDollar "verified human" lookup, used by both the leaderboard merge
 * and the /api/player-verification endpoint so the two never disagree.
 *
 * Authoritative source: the GoodDollar identity registry's
 * isWhitelisted(address). Results are cached in Redis so a full leaderboard
 * rebuild does not re-hit the chain for every player on every cycle.
 *
 * Value semantics: true = verified, false = not verified, null = could not be
 * determined right now (all RPCs failed). Callers must treat null as "unknown",
 * never as "unverified".
 */

const IDENTITY_ABI = [
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "isWhitelisted",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Primary + fallbacks. Tried in order; a later one only covers addresses the
// earlier ones could not resolve.
const RPC_ENDPOINTS = ["https://forno.celo.org", "https://rpc.ankr.com/celo"];

const CACHE_PREFIX = "verif:";
const TTL_VERIFIED = 30 * 60; // 30 min — verified status is rarely revoked
const TTL_UNVERIFIED = 5 * 60; // 5 min — re-check often so new verifications surface fast
const MULTICALL_CHUNK = 150;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const RPC_REQUEST_TIMEOUT = 8_000; // per HTTP call to an RPC
const ONCHAIN_BUDGET_MS = 20_000; // hard ceiling for the whole on-chain phase

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Batch isWhitelisted via Multicall3, walking the RPC list for anything still unresolved. */
async function checkOnChain(
  addresses: Address[]
): Promise<Map<string, boolean | null>> {
  const result = new Map<string, boolean | null>();
  for (const addr of addresses) result.set(addr.toLowerCase(), null);
  if (addresses.length === 0) return result;

  const deadline = Date.now() + ONCHAIN_BUDGET_MS;

  for (const rpcUrl of RPC_ENDPOINTS) {
    if (Date.now() >= deadline) break;

    const pending = [...result.entries()]
      .filter(([, v]) => v === null)
      .map(([a]) => a as Address);
    if (pending.length === 0) break;

    const client = createPublicClient({
      chain: celo,
      transport: http(rpcUrl, { timeout: RPC_REQUEST_TIMEOUT, retryCount: 1 }),
    });

    for (const group of chunk(pending, MULTICALL_CHUNK)) {
      if (Date.now() >= deadline) break;
      try {
        const res = await client.multicall({
          allowFailure: true,
          batchSize: 4096, // pack more isWhitelisted calls per aggregate3 request
          contracts: group.map((address) => ({
            address: IDENTITY_ADDRESS,
            abi: IDENTITY_ABI,
            functionName: "isWhitelisted" as const,
            args: [address] as const,
          })),
        });
        res.forEach((r, i) => {
          if (r.status === "success") {
            result.set(group[i].toLowerCase(), r.result === true);
          }
          // failure → leave null; a later RPC may still resolve it
        });
      } catch (err) {
        console.warn(
          `[Verification] multicall chunk failed on ${rpcUrl}:`,
          err instanceof Error ? err.message : String(err)
        );
        // leave this chunk null; next RPC retries it
      }
    }
  }

  return result;
}

/**
 * Resolve verification for a set of addresses. Reads Redis first, hits the chain
 * only for misses, writes fresh results back. Never throws — on total failure an
 * address maps to null.
 */
export async function getVerifications(
  rawAddresses: string[]
): Promise<Record<string, boolean | null>> {
  const addresses = Array.from(
    new Set(
      (rawAddresses ?? [])
        .filter((a): a is string => typeof a === "string" && ADDR_RE.test(a))
        .map((a) => a.toLowerCase())
    )
  );

  const out: Record<string, boolean | null> = {};
  if (addresses.length === 0) return out;

  const redis = await getRedis();

  // 1. Redis lookup
  const misses: string[] = [];
  if (redis) {
    try {
      const cached = await redis.mGet(addresses.map((a) => `${CACHE_PREFIX}${a}`));
      addresses.forEach((a, i) => {
        const v = cached[i];
        if (v === "1") out[a] = true;
        else if (v === "0") out[a] = false;
        else misses.push(a);
      });
    } catch (e) {
      console.error("[Verification] Redis mGet failed:", e);
      misses.length = 0;
      misses.push(...addresses);
    }
  } else {
    misses.push(...addresses);
  }

  if (misses.length === 0) return out;

  // 2. On-chain for misses
  let fresh: Map<string, boolean | null>;
  try {
    fresh = await checkOnChain(misses as Address[]);
  } catch (e) {
    console.error("[Verification] on-chain check failed:", e);
    fresh = new Map(misses.map((a) => [a, null]));
  }

  // 3. Merge + write back (cache definite answers only)
  const writes: Promise<unknown>[] = [];
  for (const a of misses) {
    const v = fresh.get(a) ?? null;
    out[a] = v;
    if (redis && v !== null) {
      writes.push(
        redis
          .setEx(`${CACHE_PREFIX}${a}`, v ? TTL_VERIFIED : TTL_UNVERIFIED, v ? "1" : "0")
          .catch(() => {
            /* non-fatal cache write */
          })
      );
    }
  }
  if (writes.length) await Promise.allSettled(writes);

  return out;
}
