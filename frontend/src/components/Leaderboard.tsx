import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBlockNumber } from "wagmi";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";
import Avatar from "./Avatar";

/**
 * Fetch verification status from reconciliation endpoint
 * Checks both on-chain verification status and score history
 */
/** The API caps each request at 100 addresses, so the board is sent in parallel chunks. */
const VERIFICATION_BATCH = 100;

async function fetchVerificationChunk(
  addresses: string[]
): Promise<Record<string, boolean | null>> {
  const response = await fetch("/api/player-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses }),
  });
  if (!response.ok) throw new Error(`Verification API returned ${response.status}`);

  const data = (await response.json()) as {
    results?: Record<string, { isVerified: boolean | null }>;
  };
  const out: Record<string, boolean | null> = {};
  for (const [addr, r] of Object.entries(data.results ?? {})) {
    out[addr.toLowerCase()] = r.isVerified;
  }
  return out;
}

async function fetchPlayerVerifications(
  addresses: string[]
): Promise<Record<string, boolean | null>> {
  if (addresses.length === 0) return {};

  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += VERIFICATION_BATCH) {
    chunks.push(addresses.slice(i, i + VERIFICATION_BATCH));
  }

  // Partial results beat none: one failing chunk shouldn't drop the whole
  // board back to unordered, so settled results are merged and only a total
  // failure throws.
  const settled = await Promise.allSettled(chunks.map(fetchVerificationChunk));
  const results: Record<string, boolean | null> = {};
  let ok = 0;
  for (const s of settled) {
    if (s.status === "fulfilled") {
      ok++;
      Object.assign(results, s.value);
    } else {
      console.error("[Verification API] chunk failed:", s.reason);
    }
  }
  if (ok === 0) throw new Error("Verification API unavailable");

  console.log(
    `[Verification API] ${Object.keys(results).length}/${addresses.length} resolved across ${ok}/${chunks.length} chunks`
  );
  return results;
}

// Goldsky subgraph GraphQL endpoint. Set NEXT_PUBLIC_SUBGRAPH_URL after deploying
// the subgraph in /subgraph (see its README/deploy step).
const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";
const PAGE_SIZE = 50;

interface PlayerRow {
  id: string; // wallet address
  xp: string; // BigInt as string
  username: string | null;
  // NOTE: the subgraph also exposes an `isVerified` field, but it is set by
  // handleXpEarned and therefore only means "has earned XP" — it is NOT
  // GoodDollar verification. Badges and tiers use /api/player-verification,
  // which reads isWhitelisted from the identity contract. Deliberately not
  // read here so the two can't be confused.
}

/**
 * Every player is listed, including wallets that have not played yet.
 *
 * The whole set is fetched at once and ordered client-side, because a player's
 * tier depends on GoodDollar verification, which the subgraph does not know.
 * The previous approach paginated server-side by XP and then grouped the rows
 * it happened to receive, so grouping only ever applied within one page — a
 * verified player on page 3 stayed on page 3 instead of rising to the top.
 * That is the ordering inconsistency this replaces.
 */
async function subgraphQuery<T>(query: string): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Subgraph query failed: ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error("Subgraph returned errors");
  if (!json.data) throw new Error("Subgraph returned no data");
  return json.data;
}

async function fetchAllPlayers(): Promise<PlayerRow[]> {
  const all: PlayerRow[] = [];
  let cursor = "";
  // Cursor on id rather than `skip`: The Graph caps skip at 5000, and this
  // keeps working as the player count grows.
  for (let guard = 0; guard < 50; guard++) {
    const data = await subgraphQuery<{ players?: PlayerRow[] }>(`{
      players(first: 1000, orderBy: id, orderDirection: asc, where: { id_gt: "${cursor}" }) {
        id
        xp
        username
      }
    }`);
    const page = data.players ?? [];
    if (page.length === 0) break;
    all.push(...page);
    cursor = page[page.length - 1].id;
    if (page.length < 1000) break;
  }
  return all;
}

/** How far behind chain head the subgraph is, so staleness can be shown rather than silently served. */
async function fetchSubgraphHead(): Promise<number | null> {
  try {
    const data = await subgraphQuery<{ _meta?: { block?: { number?: number } } }>(
      `{ _meta { block { number } } }`
    );
    return data._meta?.block?.number ?? null;
  } catch {
    return null;
  }
}

export default function Leaderboard() {
  const configured = SUBGRAPH_URL.length > 0;
  const { address } = useAuth();
  const { isSaving, error, save, clearFeedback } = useUsername();

  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  // One query for the whole board. Ordering is global (see fetchAllPlayers), so
  // pagination is applied after sorting rather than before it.
  const { data: allPlayers, isLoading, isError, error: queryError } = useQuery({
    queryKey: ["leaderboard-all"],
    queryFn: fetchAllPlayers,
    enabled: configured,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Indexing height, used only to warn when the board is being served from a
  // stalled subgraph — the failure mode that froze XP for 12 days.
  const { data: subgraphHead } = useQuery({
    queryKey: ["leaderboard-subgraph-head"],
    queryFn: fetchSubgraphHead,
    enabled: configured,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Memoize addresses to prevent query refetch on every render
  // DEDUPLICATE to avoid requesting the same address multiple times
  const allAddresses = useMemo(
    () => Array.from(new Set((allPlayers ?? []).map((e) => e.id.toLowerCase()))).sort(),
    [allPlayers]
  );

  // allAddresses is already sorted; re-sorting here would mutate the memoized array.
  const verificationQueryKey = useMemo(
    () => ["player-verifications", allAddresses.join(",")],
    [allAddresses]
  );

  const { data: verificationData, isLoading: isVerificationLoading, error: verificationError } = useQuery({
    queryKey: verificationQueryKey,
    queryFn: () => fetchPlayerVerifications(allAddresses),
    enabled: configured && allAddresses.length > 0,
    staleTime: 5 * 60_000, // 5 minutes (matches server cache)
    gcTime: 30 * 60_000, // Keep in cache for 30 min even after stale
    retry: 2, // Retry failed requests twice before giving up
  });

  console.log(`[Leaderboard] Verification query: loading=${isVerificationLoading} dataKeys=${Object.keys(verificationData || {}).length} error=${verificationError ? (verificationError as Error).message : "none"}`);

  if (queryError) {
    console.error("[Leaderboard] Subgraph query error:", queryError);
  }
  if (verificationError) {
    console.error("[Leaderboard] Verification query error:", verificationError);
  }

  // Celo produces one block per second (measured: 604,800 blocks across 7 days),
  // so block lag converts directly to wall-clock lag.
  const CELO_BLOCK_SECONDS = 1;
  const STALE_WARN_HOURS = 2;
  const { data: chainHead } = useBlockNumber({ query: { refetchInterval: 60_000 } });
  const staleHours = useMemo(() => {
    if (!chainHead || !subgraphHead) return null;
    const behind = Number(chainHead) - subgraphHead;
    return behind <= 0 ? 0 : (behind * CELO_BLOCK_SECONDS) / 3600;
  }, [chainHead, subgraphHead]);

  const entries = allPlayers ?? [];
  const totalPlayers = entries.length;
  const totalPages = Math.ceil(totalPlayers / PAGE_SIZE);
  const showEmpty = configured && !isLoading && (isError || totalPlayers === 0);
  const isLastPage = currentPage >= totalPages - 1;
  const showPagination = totalPlayers > PAGE_SIZE;

  const handleEditClick = (addr: string, currentName: string | null) => {
    setEditingAddress(addr);
    setEditValue(currentName?.trim() || "");
    clearFeedback();
  };

  const handleSave = async () => {
    if (!editValue.trim()) return;
    await save(editValue.trim());
    if (!error) {
      setEditingAddress(null);
      setEditValue("");
    }
  };

  const handleCancel = () => {
    setEditingAddress(null);
    setEditValue("");
    clearFeedback();
  };

  // Display tiers, in board order. A player's badge is decided separately (see
  // badgeFor) — tier controls WHERE a row sits, badge controls what it shows.
  //
  // Ranking is on merit: a missing username is display-only and never costs a
  // player position. Setting this true would sink anyone without a username to
  // the bottom tier — which today would bury 21 active players (one with 5,810
  // XP, three of them GoodDollar-verified) beneath 332 wallets that have never
  // played a game.
  const USERNAMELESS_SORTS_LAST = false;

  const TIER = { VERIFIED: 0, PLAYED_UNVERIFIED: 1, NOT_PLAYED: 2, NO_USERNAME: 3 } as const;

  const tierFor = (entry: PlayerRow, isVerified: boolean | null | undefined): number => {
    const hasUsername = !!entry.username?.trim();
    const xp = Number(entry.xp) || 0;
    if (USERNAMELESS_SORTS_LAST && !hasUsername) return TIER.NO_USERNAME;
    if (isVerified === true) return TIER.VERIFIED;
    if (xp > 0) return TIER.PLAYED_UNVERIFIED;
    return TIER.NOT_PLAYED;
  };

  // Badge reflects standing, independent of where the row sorts:
  //   verified   -> green tick
  //   played but not verified -> amber tick
  //   never played -> no badge at all (previously these showed an amber tick,
  //                   which read as "unverified player" for someone who had
  //                   simply never played)
  type BadgeKind = "loading" | "unavailable" | "verified" | "unverified" | "none";
  const badgeFor = (
    entry: PlayerRow,
    isVerified: boolean | null | undefined,
    loading: boolean
  ): BadgeKind => {
    if (loading) return "loading";
    if (isVerified === null) return "unavailable";
    if (isVerified === true) return "verified";
    return (Number(entry.xp) || 0) > 0 ? "unverified" : "none";
  };

  /** `prefix` is "badge" on the podium and "leaderboard__badge" in the list. */
  const renderBadge = (
    entry: PlayerRow,
    isVerified: boolean | null | undefined,
    prefix: "badge" | "leaderboard__badge"
  ) => {
    const kind = badgeFor(entry, isVerified, isVerificationLoading);
    if (kind === "none") return null;
    const base = prefix === "badge" ? "badge" : "leaderboard__badge";
    if (kind === "loading") {
      return <span className={`${base} ${base}--loading`} title="Verifying…">…</span>;
    }
    if (kind === "unavailable") {
      return (
        <span className={`${base} ${base}--unavailable`} title="Verification service temporarily unavailable">
          ?
        </span>
      );
    }
    return (
      <span
        className={`${base} ${base}--${kind}`}
        title={kind === "verified" ? "GoodDollar verified" : "Played, not yet verified"}
      >
        ✓
      </span>
    );
  };

  // Full board, tier-ordered. Sorting the complete set (rather than one page of
  // it) is what makes the ordering stable across pages.
  const sortedEntries = useMemo(() => {
    const rows = [...entries];
    const rank = new Map<string, number>();
    for (const e of rows) {
      const addr = e.id.toLowerCase();
      rank.set(addr, tierFor(e, verificationData?.[addr]));
    }
    rows.sort((a, b) => {
      const ta = rank.get(a.id.toLowerCase()) ?? TIER.NOT_PLAYED;
      const tb = rank.get(b.id.toLowerCase()) ?? TIER.NOT_PLAYED;
      if (ta !== tb) return ta - tb;
      const xa = Number(a.xp) || 0;
      const xb = Number(b.xp) || 0;
      if (xa !== xb) return xb - xa;
      // Stable, deterministic fallback so equal-XP rows don't shuffle between renders.
      return a.id.localeCompare(b.id);
    });
    return rows;
  }, [entries, verificationData]);

  const pagedEntries = useMemo(
    () => sortedEntries.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [sortedEntries, currentPage]
  );

  // Podium is the head of the same ordering, so it can never disagree with the list.
  const topThree = useMemo(() => sortedEntries.slice(0, 3), [sortedEntries]);

  const sortedAndPagedEntries = pagedEntries;

  return (
    <div className="leaderboard">
      <h2 className="leaderboard__title">Leaderboard</h2>

      {!configured && (
        <p className="leaderboard__empty">Leaderboard is being set up.</p>
      )}

      {/* A stalled indexer looks identical to "nobody scored recently", which is
          how XP appeared frozen for 12 days. Surface it instead of hiding it. */}
      {staleHours !== null && staleHours >= STALE_WARN_HOURS && (
        <p className="leaderboard__stale" role="alert">
          ⚠ Scores are {staleHours < 48
            ? `${Math.round(staleHours)} hours`
            : `${Math.round(staleHours / 24)} days`} behind — the indexer has stopped
          updating, so recent XP may not appear yet.
        </p>
      )}
      {configured && isLoading && (
        <p className="leaderboard__empty">Loading…</p>
      )}
      {showEmpty && (
        <div className="leaderboard__empty-state">
          <div className="leaderboard__empty-icon">🎮</div>
          <h3>No Scores Yet</h3>
          <p>Be the first to slide tiles and claim the top rank.</p>
          <button className="btn btn--primary" onClick={() => { /* navigate to game */ }}>
            Play Now
          </button>
        </div>
      )}

      {/* ── Top 3 Podium Section ────────────────────────────────────────── */}
      {topThree.length > 0 && topThree.length >= 3 && (
        <div className="leaderboard__podium">
          {topThree.slice(0, 3).map((entry, idx) => {
            const medals = ["🥇", "🥈", "🥉"];
            const name = entry.username?.trim() || generatedName(entry.id);
            // Use verification endpoint result; show loading during fetch
            // Distinguish: undefined/loading → "…", true → verified, false → unverified, null → unavailable
            const normalizedAddr = entry.id.toLowerCase();
            const verifiedStatus = verificationData?.[normalizedAddr];
            let isVerified: boolean | undefined | null;

            if (isVerificationLoading) {
              isVerified = undefined; // Loading state
            } else if (verifiedStatus === null) {
              isVerified = null; // Verification service unavailable
            } else if (verifiedStatus !== undefined) {
              isVerified = verifiedStatus; // Got result (true or false)
            } else {
              isVerified = false; // Missing from response, assume unverified
            }

            if (idx === 0) {
              console.log(`[Leaderboard] Top #${idx + 1}: ${normalizedAddr.slice(0, 8)} status=${isVerified === undefined ? "loading" : isVerified === null ? "unavailable" : isVerified ? "verified" : "unverified"}`);
            }

            return (
              <div key={entry.id} className={`leaderboard__podium-item leaderboard__podium-item--rank${idx + 1}`}>
                <div className="leaderboard__podium-medal">{medals[idx]}</div>
                <div className="leaderboard__podium-avatar">
                  <Avatar address={entry.id} size="lg" />
                </div>
                <div className="leaderboard__podium-name">{name}</div>
                <div className="leaderboard__podium-badge">
                  {renderBadge(entry, isVerified, "badge")}
                </div>
                <div className="leaderboard__podium-xp">{Number(entry.xp).toLocaleString()} XP</div>
              </div>
            );
          })}
        </div>
      )}

      {topThree.length > 0 && topThree.length < 3 && (
        <div className="leaderboard__podium leaderboard__podium--partial">
          {topThree.map((entry, idx) => {
            const medals = ["🥇", "🥈", "🥉"];
            const name = entry.username?.trim() || generatedName(entry.id);
            // Use verification endpoint result; show loading during fetch
            // Distinguish: undefined/loading → "…", true → verified, false → unverified, null → unavailable
            const normalizedAddr = entry.id.toLowerCase();
            const verifiedStatus = verificationData?.[normalizedAddr];
            let isVerified: boolean | undefined | null;

            if (isVerificationLoading) {
              isVerified = undefined; // Loading state
            } else if (verifiedStatus === null) {
              isVerified = null; // Verification service unavailable
            } else if (verifiedStatus !== undefined) {
              isVerified = verifiedStatus; // Got result (true or false)
            } else {
              isVerified = false; // Missing from response, assume unverified
            }

            if (idx === 0) {
              console.log(`[Leaderboard] Top #${idx + 1}: ${normalizedAddr.slice(0, 8)} status=${isVerified === undefined ? "loading" : isVerified === null ? "unavailable" : isVerified ? "verified" : "unverified"}`);
            }

            return (
              <div key={entry.id} className="leaderboard__podium-item">
                <div className="leaderboard__podium-medal">{medals[idx]}</div>
                <div className="leaderboard__podium-avatar">
                  <Avatar address={entry.id} size="lg" />
                </div>
                <div className="leaderboard__podium-name">{name}</div>
                <div className="leaderboard__podium-badge">
                  {renderBadge(entry, isVerified, "badge")}
                </div>
                <div className="leaderboard__podium-xp">{Number(entry.xp).toLocaleString()} XP</div>
              </div>
            );
          })}
        </div>
      )}

      {sortedAndPagedEntries.length > 0 && (
        <>
          <div className="leaderboard__separator" />
          <div className="leaderboard__list-header">
            <h3 className="leaderboard__list-title">All Players</h3>
          </div>

          <ol className="leaderboard__list">
            {sortedAndPagedEntries.map((entry: PlayerRow, i: number) => {
              const rank = currentPage * PAGE_SIZE + i + 1;
              const name = entry.username?.trim() || generatedName(entry.id);
              const isCurrentUser = address && entry.id.toLowerCase() === address.toLowerCase();
              const isEditingThis = editingAddress?.toLowerCase() === entry.id.toLowerCase();
              // Use verification endpoint result; show loading during fetch
              const normalizedAddr = entry.id.toLowerCase();
              const verifiedStatus = verificationData?.[normalizedAddr];
              let isVerified: boolean | undefined | null;

              if (isVerificationLoading) {
                isVerified = undefined;
              } else if (verifiedStatus === null) {
                isVerified = null;
              } else if (verifiedStatus !== undefined) {
                isVerified = verifiedStatus;
              } else {
                isVerified = false;
              }

              return (
                <li
                  key={entry.id}
                  className={`leaderboard__entry ${isCurrentUser ? "leaderboard__entry--current-user" : ""}`}
                >
                  <span className="leaderboard__rank">#{rank}</span>
                  <div className="leaderboard__avatar-sm">
                    <Avatar address={entry.id} size="sm" />
                  </div>
                  <div className="leaderboard__player">
                    <div className="leaderboard__name-badge">
                      {isEditingThis ? (
                        <input
                          className="leaderboard__name-input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder="your_name"
                          maxLength={20}
                          autoFocus
                          spellCheck={false}
                          disabled={isSaving}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave();
                            if (e.key === "Escape") handleCancel();
                          }}
                        />
                      ) : (
                        <span className="leaderboard__name">{name}</span>
                      )}
                      {renderBadge(entry, isVerified, "leaderboard__badge")}
                    </div>
                    <span className="leaderboard__addr" title={entry.id}>
                      {shortAddr(entry.id)}
                    </span>
                  </div>
                  <span className="leaderboard__score">
                    {Number(entry.xp).toLocaleString()} XP
                  </span>
                  {isCurrentUser && (
                    <div className="leaderboard__actions">
                      {isEditingThis ? (
                        <>
                          <button
                            className="leaderboard__action-btn leaderboard__action-btn--save"
                            onClick={handleSave}
                            disabled={isSaving || !editValue.trim()}
                            title="Save username"
                          >
                            ✓
                          </button>
                          <button
                            className="leaderboard__action-btn leaderboard__action-btn--cancel"
                            onClick={handleCancel}
                            disabled={isSaving}
                            title="Cancel"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <button
                          className="leaderboard__action-btn leaderboard__action-btn--edit"
                          onClick={() => handleEditClick(entry.id, entry.username)}
                          title="Change username"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {showPagination && (
            <div className="leaderboard__pagination">
              <button
                className="leaderboard__pagination-btn"
                onClick={() => {
                  console.log(`[Leaderboard] Previous clicked: currentPage ${currentPage} → ${Math.max(0, currentPage - 1)}`);
                  setCurrentPage(p => Math.max(0, p - 1));
                }}
                disabled={currentPage === 0 || isLoading}
                aria-label="Previous page"
              >
                ← Previous
              </button>
              <span className="leaderboard__pagination-info">
                Page {currentPage + 1} of {totalPages}
              </span>
              <button
                className="leaderboard__pagination-btn"
                onClick={() => {
                  console.log(`[Leaderboard] Next clicked: currentPage ${currentPage} → ${currentPage + 1}, isLastPage=${isLastPage}`);
                  setCurrentPage(p => p + 1);
                }}
                disabled={isLastPage || isLoading}
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {editingAddress && error && (
        <div className="leaderboard__error">
          {error}
        </div>
      )}
    </div>
  );
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Deterministic friendly name when a player hasn't claimed an on-chain username.
function generatedName(addr: string): string {
  return `Player-${addr.slice(-4).toUpperCase()}`;
}
