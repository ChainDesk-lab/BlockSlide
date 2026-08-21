import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";
import Avatar from "./Avatar";

/**
 * Fetch verification status from reconciliation endpoint
 * Checks both on-chain verification status and score history
 */
async function fetchPlayerVerifications(
  addresses: string[]
): Promise<Record<string, boolean>> {
  if (addresses.length === 0) return {};

  console.log(`[Verification API] Requesting ${addresses.length} addresses:`, addresses.map(a => a.slice(0, 8)).join(", "));

  try {
    const response = await fetch("/api/player-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses }),
    });

    if (!response.ok) {
      console.error("[Verification API] HTTP error:", response.status);
      throw new Error(`Verification API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: Record<string, { isVerified: boolean }>;
    };
    const results: Record<string, boolean> = {};
    if (data.results) {
      for (const [addr, { isVerified }] of Object.entries(data.results)) {
        results[addr.toLowerCase()] = isVerified;
      }
    }

    console.log(`[Verification API] Got ${Object.keys(results).length} results:`,
      Object.entries(results).map(([a, v]) => `${a.slice(0, 8)}=${v}`).join(", "));

    return results;
  } catch (err) {
    console.error("[Verification API] Error:", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// Goldsky subgraph GraphQL endpoint. Set NEXT_PUBLIC_SUBGRAPH_URL after deploying
// the subgraph in /subgraph (see its README/deploy step).
const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";
const PAGE_SIZE = 50;

interface PlayerRow {
  id: string; // wallet address
  xp: string; // BigInt as string
  username: string | null;
  isVerified?: boolean; // true if player has earned XP; undefined for backward compat
}

interface LeaderboardData {
  entries: PlayerRow[];
  totalPlayers: number;
  totalPages: number;
}

function buildPlayersQuery(skip: number): string {
  return `{
    players(first: ${PAGE_SIZE}, skip: ${skip}, orderBy: xp, orderDirection: desc) {
      id
      xp
      username
    }
  }`;
}

function buildTotalQuery(): string {
  return `{
    players(first: 1000) {
      id
    }
  }`;
}

async function fetchLeaderboard(skip: number): Promise<LeaderboardData> {
  // Fetch page data
  const playersQuery = buildPlayersQuery(skip);
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: playersQuery }),
  });
  if (!res.ok) throw new Error(`Subgraph query failed: ${res.status}`);
  const json = (await res.json()) as { data?: { players?: PlayerRow[] }; errors?: unknown };
  if (json.errors) throw new Error("Subgraph returned errors");
  const entries = json.data?.players ?? [];

  // Fetch total count (once per query to keep it fresh)
  const totalRes = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildTotalQuery() }),
  });
  const totalJson = (await totalRes.json()) as { data?: { players?: { id: string }[] }; errors?: unknown };
  const totalPlayers = totalJson.data?.players?.length ?? 0;
  const totalPages = Math.ceil(totalPlayers / PAGE_SIZE);

  return { entries, totalPlayers, totalPages };
}

// Fetch the global top 3 players (independent of pagination)
async function fetchTopThree(): Promise<PlayerRow[]> {
  const query = `{
    players(first: 3, orderBy: xp, orderDirection: desc) {
      id
      xp
      username
    }
  }`;
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Subgraph query failed: ${res.status}`);
  const json = (await res.json()) as { data?: { players?: PlayerRow[] }; errors?: unknown };
  if (json.errors) throw new Error("Subgraph returned errors");
  return json.data?.players ?? [];
}

export default function Leaderboard() {
  const configured = SUBGRAPH_URL.length > 0;
  const { address } = useAuth();
  const { isSaving, error, save, clearFeedback } = useUsername();

  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  const skip = currentPage * PAGE_SIZE;

  // Paginated list query for current page
  const { data, isLoading, isError, error: queryError } = useQuery({
    queryKey: ["leaderboard", currentPage],
    queryFn: () => fetchLeaderboard(skip),
    enabled: configured,
    refetchInterval: 30_000, // pick up new scores
    staleTime: 15_000,
  });

  // Independent query for global top 3 (never changes with page navigation)
  const { data: topThreeData } = useQuery({
    queryKey: ["leaderboard-top-three"],
    queryFn: () => fetchTopThree(),
    enabled: configured,
    refetchInterval: 30_000, // pick up new scores
    staleTime: 15_000,
  });

  // Memoize addresses to prevent query refetch on every render
  // DEDUPLICATE to avoid requesting the same address multiple times
  const allAddresses = useMemo(
    () => {
      const combined = [
        ...(data?.entries ?? []).map((e) => e.id),
        ...(topThreeData ?? []).map((e) => e.id),
      ];
      return Array.from(new Set(combined.map(a => a.toLowerCase())));
    },
    [data?.entries, topThreeData]
  );

  const verificationQueryKey = useMemo(
    () => ["player-verifications", allAddresses.sort().join(",")],
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

  const entries = data?.entries ?? [];
  const topThree = topThreeData ?? [];
  const totalPages = data?.totalPages ?? 0;
  const totalPlayers = data?.totalPlayers ?? 0;
  const showEmpty = configured && !isLoading && (isError || totalPlayers === 0);
  const isLastPage = currentPage >= totalPages - 1;
  const showPagination = entries.length > 0 && totalPages > 1;

  // Debug: log navigation state when page changes
  console.log(`[Leaderboard] Page ${currentPage + 1}/${totalPages}, skip=${skip}, entries=${entries.length}, isLoading=${isLoading}`);

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

  // Sort entries into three tiers:
  // 1. Verified users (by XP descending)
  // 2. Unverified users with XP > 0 (by XP descending)
  // 3. Unverified users with XP = 0 (maintain original order)
  const sortedEntries = useMemo(() => {
    if (!verificationData || Object.keys(verificationData).length === 0) {
      return entries; // If no verification data yet, return unsorted
    }

    const verified: typeof entries = [];
    const unverifiedWithXp: typeof entries = [];
    const unverifiedZeroXp: typeof entries = [];

    for (const entry of entries) {
      const addr = entry.id.toLowerCase();
      const isVerified = verificationData[addr];
      const xp = Number(entry.xp) || 0;

      if (isVerified === true) {
        verified.push(entry);
      } else if (xp > 0) {
        unverifiedWithXp.push(entry);
      } else {
        unverifiedZeroXp.push(entry);
      }
    }

    // Sort each tier
    verified.sort((a, b) => Number(b.xp) - Number(a.xp));
    unverifiedWithXp.sort((a, b) => Number(b.xp) - Number(a.xp));
    // unverifiedZeroXp keeps original order (stable)

    return [...verified, ...unverifiedWithXp, ...unverifiedZeroXp];
  }, [entries, verificationData]);

  return (
    <div className="leaderboard">
      <h2 className="leaderboard__title">Leaderboard</h2>

      {!configured && (
        <p className="leaderboard__empty">Leaderboard is being set up.</p>
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
                  {isVerified === undefined ? (
                    <span className="badge badge--loading">…</span>
                  ) : isVerified === null ? (
                    <span className="badge badge--unavailable" title="Verification service temporarily unavailable">
                      ?
                    </span>
                  ) : isVerified ? (
                    <span className="badge badge--verified">✓</span>
                  ) : (
                    <span className="badge badge--unverified">✓</span>
                  )}
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
                  {isVerified === undefined ? (
                    <span className="badge badge--loading">…</span>
                  ) : isVerified === null ? (
                    <span className="badge badge--unavailable" title="Verification service temporarily unavailable">
                      ?
                    </span>
                  ) : isVerified ? (
                    <span className="badge badge--verified">✓</span>
                  ) : (
                    <span className="badge badge--unverified">✓</span>
                  )}
                </div>
                <div className="leaderboard__podium-xp">{Number(entry.xp).toLocaleString()} XP</div>
              </div>
            );
          })}
        </div>
      )}

      {sortedEntries.length > 0 && (
        <>
          <div className="leaderboard__separator" />
          <div className="leaderboard__list-header">
            <h3 className="leaderboard__list-title">All Players</h3>
          </div>

          <ol className="leaderboard__list">
            {sortedEntries.map((entry, i) => {
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
                      {isVerified === undefined ? (
                        <span className="leaderboard__badge leaderboard__badge--loading" title="Verifying...">
                          …
                        </span>
                      ) : isVerified === null ? (
                        <span className="leaderboard__badge leaderboard__badge--unavailable" title="Verification service temporarily unavailable">
                          ?
                        </span>
                      ) : isVerified ? (
                        <span className="leaderboard__badge leaderboard__badge--verified" title="Verified">
                          ✓
                        </span>
                      ) : (
                        <span className="leaderboard__badge leaderboard__badge--unverified" title="Unverified">
                          ✓
                        </span>
                      )}
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
