import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";
import Avatar from "./Avatar";

const PAGE_SIZE = 50;

interface PlayerRow {
  id: string; // wallet address (lowercase)
  xp: string; // BigInt as string
  username: string | null;
  // GoodDollar verification, resolved server-side alongside ranking so the
  // badge and the sort order can never disagree. null = could not determine.
  isVerified: boolean | null;
}

interface LeaderboardResponse {
  entries: PlayerRow[];
  page: number;
  pageSize: number;
  totalPlayers: number;
  totalPages: number;
  stale?: boolean;
  error?: string;
}

async function fetchLeaderboardPage(
  page: number,
  fresh: boolean
): Promise<LeaderboardResponse> {
  const qs = new URLSearchParams({ page: String(page) });
  if (fresh) qs.set("fresh", "1");
  const res = await fetch(`/api/leaderboard?${qs.toString()}`);
  if (!res.ok) throw new Error(`Leaderboard API returned ${res.status}`);
  return (await res.json()) as LeaderboardResponse;
}

export default function Leaderboard() {
  const { address } = useAuth();
  const { isSaving, error, save, clearFeedback } = useUsername();
  const queryClient = useQueryClient();

  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  // After a score submit, bypass the server-side cache once so the new XP shows
  // immediately instead of after the 15s cache window.
  const freshUntilRef = useRef(0);
  useEffect(() => {
    const onSubmitted = () => {
      freshUntilRef.current = Date.now() + 30_000;
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    };
    window.addEventListener("scoreSubmitted", onSubmitted);
    return () => window.removeEventListener("scoreSubmitted", onSubmitted);
  }, [queryClient]);

  const isFresh = () => Date.now() < freshUntilRef.current;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["leaderboard", "page", currentPage],
    queryFn: () => fetchLeaderboardPage(currentPage, isFresh()),
    refetchInterval: 20_000,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });

  // Global top 3 — independent of pagination.
  const { data: topData } = useQuery({
    queryKey: ["leaderboard", "top"],
    queryFn: () => fetchLeaderboardPage(0, isFresh()),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const topThree = useMemo(
    () => (topData?.entries ?? []).slice(0, 3),
    [topData]
  );
  const totalPages = data?.totalPages ?? 1;
  const totalPlayers = data?.totalPlayers ?? 0;
  const isStale = data?.stale === true;

  // Keep the current page in range if the total player count shrinks.
  useEffect(() => {
    if (currentPage > totalPages - 1) {
      setCurrentPage(Math.max(0, totalPages - 1));
    }
  }, [totalPages, currentPage]);

  useEffect(() => {
    if (isError) console.error("[Leaderboard] failed to load leaderboard page");
  }, [isError]);

  // Only the genuine "nobody has played" case — a transient fetch error keeps
  // the last good page visible via placeholderData rather than flashing empty.
  const showEmpty = !isLoading && totalPlayers === 0 && entries.length === 0;
  const isLastPage = currentPage >= totalPages - 1;
  const showPagination = entries.length > 0 && totalPages > 1;

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

  // Normalises the server-provided flag: true → verified, false → unverified,
  // null/undefined → "could not determine" (badge shows "?").
  const resolveVerified = (v: boolean | null | undefined): boolean | null =>
    v === true ? true : v === false ? false : null;

  return (
    <div className="leaderboard">
      <h2 className="leaderboard__title">Leaderboard</h2>

      {isLoading && <p className="leaderboard__empty">Loading…</p>}

      {isStale && !isLoading && !showEmpty && (
        <p className="leaderboard__empty">
          Live rankings are catching up — some recent XP may not show yet.
        </p>
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
      {topThree.length >= 3 && (
        <div className="leaderboard__podium">
          {topThree.slice(0, 3).map((entry, idx) => {
            const medals = ["🥇", "🥈", "🥉"];
            const name = entry.username?.trim() || generatedName(entry.id);
            const isVerified = resolveVerified(entry.isVerified);

            return (
              <div key={entry.id} className={`leaderboard__podium-item leaderboard__podium-item--rank${idx + 1}`}>
                <div className="leaderboard__podium-medal">{medals[idx]}</div>
                <div className="leaderboard__podium-avatar">
                  <Avatar address={entry.id} size="lg" />
                </div>
                <div className="leaderboard__podium-name">{name}</div>
                <div className="leaderboard__podium-badge">
                  {isVerified === null ? (
                    <span className="badge badge--unavailable" title="Verification status unavailable — refreshes automatically">
                      ?
                    </span>
                  ) : isVerified ? (
                    <span className="badge badge--verified" title="GoodDollar verified">✓</span>
                  ) : (
                    <span className="badge badge--unverified" title="Not verified">✓</span>
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
            const isVerified = resolveVerified(entry.isVerified);

            return (
              <div key={entry.id} className="leaderboard__podium-item">
                <div className="leaderboard__podium-medal">{medals[idx]}</div>
                <div className="leaderboard__podium-avatar">
                  <Avatar address={entry.id} size="lg" />
                </div>
                <div className="leaderboard__podium-name">{name}</div>
                <div className="leaderboard__podium-badge">
                  {isVerified === null ? (
                    <span className="badge badge--unavailable" title="Verification status unavailable — refreshes automatically">
                      ?
                    </span>
                  ) : isVerified ? (
                    <span className="badge badge--verified" title="GoodDollar verified">✓</span>
                  ) : (
                    <span className="badge badge--unverified" title="Not verified">✓</span>
                  )}
                </div>
                <div className="leaderboard__podium-xp">{Number(entry.xp).toLocaleString()} XP</div>
              </div>
            );
          })}
        </div>
      )}

      {entries.length > 0 && (
        <>
          <div className="leaderboard__separator" />
          <div className="leaderboard__list-header">
            <h3 className="leaderboard__list-title">All Players</h3>
            {totalPlayers > 0 && (
              <span className="leaderboard__list-count">{totalPlayers.toLocaleString()}</span>
            )}
          </div>

          <ol className="leaderboard__list">
            {entries.map((entry: PlayerRow, i: number) => {
              const rank = currentPage * PAGE_SIZE + i + 1;
              const name = entry.username?.trim() || generatedName(entry.id);
              const isCurrentUser = address && entry.id.toLowerCase() === address.toLowerCase();
              const isEditingThis = editingAddress?.toLowerCase() === entry.id.toLowerCase();
              const isVerified = resolveVerified(entry.isVerified);

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
                      {isVerified === null ? (
                        <span className="leaderboard__badge leaderboard__badge--unavailable" title="Verification status unavailable — refreshes automatically">
                          ?
                        </span>
                      ) : isVerified ? (
                        <span className="leaderboard__badge leaderboard__badge--verified" title="GoodDollar verified">
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
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
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
                onClick={() => setCurrentPage((p) => p + 1)}
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
