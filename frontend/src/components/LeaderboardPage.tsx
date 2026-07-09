"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";
import { useLeaderboard, fetchLeaderboardPage } from "../hooks/useLeaderboard";
import type { LeaderboardPlayer } from "../hooks/useLeaderboard";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

async function fetchYourRank(address: string): Promise<{ xp: string; rank: number } | null> {
  if (!SUBGRAPH_URL) return null;

  const playerRes = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{ player(id: "${address.toLowerCase()}") { xp } }`,
    }),
  });
  const playerJson = (await playerRes.json()) as { data?: { player?: { xp: string } } };
  const player = playerJson.data?.player;
  if (!player) return null;

  const xp = player.xp;
  const rankRes = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{ players(first: 1000, where: { xp_gt: "${xp}" }) { id } }`,
    }),
  });
  const rankJson = (await rankRes.json()) as { data?: { players?: { id: string }[] } };
  const ahead = rankJson.data?.players?.length ?? 0;
  return { xp, rank: ahead + 1 };
}

function YourRankBar() {
  const { address } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["your-rank", address],
    queryFn: () => fetchYourRank(address!),
    enabled: !!address && SUBGRAPH_URL.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!address) return null;
  if (isLoading) return <div className="rank-bar rank-bar--loading">Loading your rank…</div>;
  if (!data) return <div className="rank-bar rank-bar--unranked">Play a game to earn your rank!</div>;

  return (
    <div className="rank-bar">
      <span className="rank-bar__label">Your rank</span>
      <span className="rank-bar__value">#{data.rank}</span>
      <span className="rank-bar__xp">{Number(data.xp).toLocaleString()} XP</span>
    </div>
  );
}

export default function LeaderboardPage() {
  const { address } = useAuth();
  const { isSaving, error: saveError, save, clearFeedback } = useUsername();
  const { players: firstPage, isLoading, isError, configured } = useLeaderboard(50, 0);

  const [extraPlayers, setExtraPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);

  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const allPlayers = [...firstPage, ...extraPlayers];

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await fetchLeaderboardPage(50, allPlayers.length);
      if (next.length === 0) {
        setAllLoaded(true);
      } else {
        setExtraPlayers((prev) => [...prev, ...next]);
        if (next.length < 50) setAllLoaded(true);
      }
    } catch {
      // silent — user can retry by clicking Load more again
    } finally {
      setLoadingMore(false);
    }
  };

  const handleEditClick = (addr: string, currentName: string | null) => {
    setEditingAddress(addr);
    setEditValue(currentName?.trim() || "");
    clearFeedback();
  };

  const handleSave = async () => {
    if (!editValue.trim()) return;
    await save(editValue.trim());
    if (!saveError) {
      setEditingAddress(null);
      setEditValue("");
    }
  };

  const handleCancel = () => {
    setEditingAddress(null);
    setEditValue("");
    clearFeedback();
  };

  const showEmpty = configured && !isLoading && (isError || allPlayers.length === 0);

  return (
    <div className="leaderboard-page">
      <div className="leaderboard-page__header">
        <Link href="/" className="leaderboard-page__back">← Back</Link>
        <h1 className="leaderboard-page__title">Leaderboard</h1>
      </div>

      <YourRankBar />

      <div className="leaderboard">
        {!configured && (
          <p className="leaderboard__empty">Leaderboard is being set up.</p>
        )}
        {configured && isLoading && (
          <p className="leaderboard__empty">Loading…</p>
        )}
        {showEmpty && (
          <p className="leaderboard__empty">No scores yet. Be the first to play!</p>
        )}

        {allPlayers.length > 0 && (
          <ol className="leaderboard__list">
            {allPlayers.map((entry, i) => {
              const name = entry.username?.trim() || `Player-${entry.id.slice(-4).toUpperCase()}`;
              const isCurrentUser = address && entry.id.toLowerCase() === address.toLowerCase();
              const isEditingThis = editingAddress?.toLowerCase() === entry.id.toLowerCase();

              return (
                <li
                  key={entry.id}
                  className={`leaderboard__entry ${isCurrentUser ? "leaderboard__entry--current-user" : ""}`}
                >
                  <span className="leaderboard__rank">{i + 1}</span>
                  <div className="leaderboard__player">
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
                    <span className="leaderboard__addr" title={entry.id}>
                      {`${entry.id.slice(0, 6)}…${entry.id.slice(-4)}`}
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
        )}

        {editingAddress && saveError && (
          <div className="leaderboard__error">{saveError}</div>
        )}

        {configured && !isLoading && allPlayers.length > 0 && !allLoaded && (
          <div className="leaderboard__footer">
            <button
              className="leaderboard__load-more"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
