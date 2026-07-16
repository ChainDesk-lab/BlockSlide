import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";

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

function buildQuery(skip: number): string {
  return `{
    players(first: ${PAGE_SIZE}, skip: ${skip}, orderBy: xp, orderDirection: desc) {
      id
      xp
      username
    }
  }`;
}

async function fetchLeaderboard(skip: number): Promise<PlayerRow[]> {
  const query = buildQuery(skip);
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
  const { data, isLoading, isError } = useQuery({
    queryKey: ["leaderboard", currentPage],
    queryFn: () => fetchLeaderboard(skip),
    enabled: configured,
    refetchInterval: 30_000, // pick up new scores
    staleTime: 15_000,
  });

  const entries = data ?? [];
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
      {entries.length > 0 && entries.length >= 3 && (
        <div className="leaderboard__podium">
          {entries.slice(0, 3).map((entry, idx) => {
            const medals = ["🥇", "🥈", "🥉"];
            const positions = [2, 1, 0]; // order for visual layout
            const pos = positions[idx];
            const entry_ = entries[idx];
            const name = entry_.username?.trim() || generatedName(entry_.id);
            const avatar = getAvatar(entry_.id);
            const isVerified = entry_.isVerified ?? (Number(entry_.xp) > 0);

            return (
              <div key={entry_.id} className={`leaderboard__podium-item leaderboard__podium-item--rank${idx + 1}`}>
                <div className="leaderboard__podium-medal">{medals[idx]}</div>
                <div className="leaderboard__podium-avatar">{avatar}</div>
                <div className="leaderboard__podium-name">{name}</div>
                <div className="leaderboard__podium-badge">
                  {isVerified ? <span className="badge badge--verified">✓</span> : <span className="badge badge--unverified">⏳</span>}
                </div>
                <div className="leaderboard__podium-xp">{Number(entry_.xp).toLocaleString()} XP</div>
              </div>
            );
          })}
        </div>
      )}

      {entries.length > 0 && entries.length < 3 && (
        <div className="leaderboard__podium leaderboard__podium--partial">
          {entries.map((entry, idx) => {
            const medals = ["🥇", "🥈", "🥉"];
            const name = entry.username?.trim() || generatedName(entry.id);
            const avatar = getAvatar(entry.id);
            const isVerified = entry.isVerified ?? (Number(entry.xp) > 0);

            return (
              <div key={entry.id} className="leaderboard__podium-item">
                <div className="leaderboard__podium-medal">{medals[idx]}</div>
                <div className="leaderboard__podium-avatar">{avatar}</div>
                <div className="leaderboard__podium-name">{name}</div>
                <div className="leaderboard__podium-badge">
                  {isVerified ? <span className="badge badge--verified">✓</span> : <span className="badge badge--unverified">⏳</span>}
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
          </div>

          <ol className="leaderboard__list">
            {entries.map((entry, i) => {
              const rank = currentPage * PAGE_SIZE + i + 1;
              const name = entry.username?.trim() || generatedName(entry.id);
              const isCurrentUser = address && entry.id.toLowerCase() === address.toLowerCase();
              const isEditingThis = editingAddress?.toLowerCase() === entry.id.toLowerCase();
              const isVerified = entry.isVerified ?? (Number(entry.xp) > 0);
              const avatar = getAvatar(entry.id);

              return (
                <li
                  key={entry.id}
                  className={`leaderboard__entry ${isCurrentUser ? "leaderboard__entry--current-user" : ""}`}
                >
                  <span className="leaderboard__rank">#{rank}</span>
                  <div className="leaderboard__avatar-sm">{avatar}</div>
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
                      <span className={`leaderboard__badge ${isVerified ? "leaderboard__badge--verified" : "leaderboard__badge--unverified"}`} title={isVerified ? "Verified" : "Unverified"}>
                        {isVerified ? "✓" : "⏳"}
                      </span>
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

          <div className="leaderboard__pagination">
            <button
              className="leaderboard__pagination-btn"
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0 || isLoading}
            >
              ← Previous
            </button>
            <span className="leaderboard__pagination-info">
              Page {currentPage + 1}
            </span>
            <button
              className="leaderboard__pagination-btn"
              onClick={() => setCurrentPage(p => p + 1)}
              disabled={entries.length < PAGE_SIZE || isLoading}
            >
              Next →
            </button>
          </div>
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

// Avatar placeholder: initials or letter-based on address
function getAvatar(addr: string): string {
  // Use first 2 chars of address (after 0x) as a seed for a letter
  const seed = parseInt(addr.slice(2, 4), 16) % 26;
  const letter = String.fromCharCode(65 + seed); // A-Z
  return letter;
}
