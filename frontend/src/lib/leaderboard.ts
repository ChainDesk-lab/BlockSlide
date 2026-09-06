/**
 * Pure leaderboard merge + ordering logic. No I/O — imported by the
 * /api/leaderboard route (which supplies subgraph rows, registry rows and
 * verification results) and covered directly by unit tests.
 *
 * Ordering is the three-tier rule, applied once over the whole player set:
 *   tier 0 — GoodDollar-verified players, ranked by XP desc
 *   tier 1 — unverified players who have earned XP, ranked by XP desc
 *   tier 2 — everyone else (no XP yet), oldest signup first
 * Every tier has a fully deterministic tie-break (firstSeen, then address), so a
 * player always lands on exactly one page and never appears twice.
 */

export interface SubgraphPlayerInput {
  id: string;
  xp: string | null;
  username: string | null;
  firstSeen: string | number | null;
}

export interface RegistryProfileInput {
  address: string;
  username: string | null;
  createdAt: number | null;
}

export interface MergedPlayer {
  id: string; // lowercase address
  xp: string; // BigInt as decimal string
  username: string | null;
  firstSeen: number; // seconds epoch
  isVerified: boolean | null; // GoodDollar whitelist; null = undetermined
}

function toBigIntSafe(v: string): bigint {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

/** Union of subgraph rows and registry rows into one entry per address. Unsorted. */
export function mergePlayers(
  subgraph: SubgraphPlayerInput[],
  registry: RegistryProfileInput[]
): MergedPlayer[] {
  const map = new Map<string, MergedPlayer>();

  for (const p of subgraph ?? []) {
    if (!p?.id) continue;
    const id = p.id.toLowerCase();
    map.set(id, {
      id,
      xp: p.xp ?? "0",
      username: p.username?.trim() || null,
      firstSeen: Number(p.firstSeen) || 0,
      isVerified: null,
    });
  }

  for (const r of registry ?? []) {
    if (!r?.address) continue;
    const id = r.address.toLowerCase();
    const regSeen = Math.floor((r.createdAt ?? 0) / 1000);
    const existing = map.get(id);

    if (existing) {
      // Registry username is a fallback only — used until the subgraph has
      // indexed the on-chain UsernameSet event.
      if (!existing.username && r.username) existing.username = r.username.trim() || null;
      if (regSeen && (!existing.firstSeen || regSeen < existing.firstSeen)) {
        existing.firstSeen = regSeen;
      }
    } else {
      map.set(id, {
        id,
        xp: "0",
        username: r.username?.trim() || null,
        firstSeen: regSeen || Math.floor(Date.now() / 1000),
        isVerified: null,
      });
    }
  }

  return Array.from(map.values());
}

export function hasXp(p: Pick<MergedPlayer, "xp">): boolean {
  return toBigIntSafe(p.xp) > 0n;
}

/** 0 = verified, 1 = unverified with XP, 2 = no XP yet. */
export function tierOf(p: MergedPlayer): 0 | 1 | 2 {
  if (p.isVerified === true) return 0;
  if (hasXp(p)) return 1;
  return 2;
}

export function compareRows(a: MergedPlayer, b: MergedPlayer): number {
  const ta = tierOf(a);
  const tb = tierOf(b);
  if (ta !== tb) return ta - tb;

  // Within tiers 0 and 1, rank by XP (BigInt — cumulative XP can exceed 2^53).
  if (ta !== 2 && a.xp !== b.xp) {
    return toBigIntSafe(b.xp) > toBigIntSafe(a.xp) ? 1 : -1;
  }
  // Deterministic tie-break everywhere: earliest signup first, then address.
  if (a.firstSeen !== b.firstSeen) return a.firstSeen - b.firstSeen;
  return a.id < b.id ? -1 : 1;
}

/** Merge, apply verification, and return the fully ordered leaderboard. */
export function buildOrderedLeaderboard(
  subgraph: SubgraphPlayerInput[],
  registry: RegistryProfileInput[],
  verification: Record<string, boolean | null>
): MergedPlayer[] {
  const rows = mergePlayers(subgraph, registry);
  for (const r of rows) r.isVerified = verification[r.id] ?? null;
  rows.sort(compareRows);
  return rows;
}
