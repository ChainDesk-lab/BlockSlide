import { useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";
import type { LeaderboardPlayer } from "../hooks/useLeaderboard";

interface LeaderboardProps {
  players: LeaderboardPlayer[];
  isLoading: boolean;
  isError: boolean;
  configured: boolean;
  /** Adds this number to each row's index when computing its rank label.
   *  Default 0 — first row shows rank 1. */
  rankOffset?: number;
  /** When true, renders a "See more →" link to /leaderboard at the bottom. */
  showSeeMore?: boolean;
}

export default function Leaderboard({
  players,
  isLoading,
  isError,
  configured,
  rankOffset = 0,
  showSeeMore = false,
}: LeaderboardProps) {
  const { address } = useAuth();
  const { isSaving, error, save, clearFeedback } = useUsername();

  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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

  const showEmpty = configured && !isLoading && (isError || players.length === 0);

  return (
    <div className="leaderboard">
      <h3 className="leaderboard__title">Top Players</h3>

      {!configured && (
        <p className="leaderboard__empty">Leaderboard is being set up.</p>
      )}
      {configured && isLoading && (
        <p className="leaderboard__empty">Loading…</p>
      )}
      {showEmpty && (
        <p className="leaderboard__empty">No scores yet. Be the first to play.</p>
      )}

      {players.length > 0 && (
        <ol className="leaderboard__list">
          {players.map((entry, i) => {
            const rank = rankOffset + i + 1;
            const name = entry.username?.trim() || generatedName(entry.id);
            const isCurrentUser =
              address && entry.id.toLowerCase() === address.toLowerCase();
            const isEditingThis =
              editingAddress?.toLowerCase() === entry.id.toLowerCase();

            return (
              <li
                key={entry.id}
                className={`leaderboard__entry ${isCurrentUser ? "leaderboard__entry--current-user" : ""}`}
              >
                <span className="leaderboard__rank">{rank}</span>
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
      )}

      {editingAddress && error && (
        <div className="leaderboard__error">{error}</div>
      )}

      {showSeeMore && (
        <div className="leaderboard__footer">
          <Link href="/leaderboard" className="leaderboard__see-more">
            See more →
          </Link>
        </div>
      )}
    </div>
  );
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function generatedName(addr: string): string {
  return `Player-${addr.slice(-4).toUpperCase()}`;
}
