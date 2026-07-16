import { useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  limit?: number;
  showSeeMore?: boolean;
}

export default function Leaderboard({ limit = 10, showSeeMore = false }: Props) {
  const { address } = useAuth();
  const { isSaving, error, save, clearFeedback } = useUsername();
  const { players, isLoading, isError, configured } = useLeaderboard(limit, 0);

  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const entries = players;
  const showEmpty = configured && !isLoading && (isError || entries.length === 0);

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

      {entries.length > 0 && (
        <ol className="leaderboard__list">
          {entries.map((entry, i) => {
            const name = entry.username?.trim() || generatedName(entry.id);
            const isCurrentUser = address && entry.id.toLowerCase() === address.toLowerCase();
            const isEditingThis = editingAddress?.toLowerCase() === entry.id.toLowerCase();

            return (
              <li
                key={entry.id}
                className={[
                  "leaderboard__entry",
                  isCurrentUser ? "leaderboard__entry--current-user" : "",
                  !entry.isVerified ? "leaderboard__entry--unverified" : "",
                ].filter(Boolean).join(" ")}
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
                    {shortAddr(entry.id)}
                  </span>
                </div>
                <div className="leaderboard__score-col">
                  <span className="leaderboard__score">
                    {Number(entry.displayXp).toLocaleString()} XP
                  </span>
                  {!entry.isVerified && (
                    <span className="badge badge--unverified">Unverified</span>
                  )}
                </div>
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
        <div className="leaderboard__error">
          {error}
        </div>
      )}

      {showSeeMore && entries.length > 0 && (
        <div className="leaderboard__footer">
          <Link href="/leaderboard" className="leaderboard__see-more">
            See full leaderboard →
          </Link>
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
