"use client";

import { useState, useEffect, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../auth/AuthContext";
import { useUsername } from "../hooks/useUsername";
import { useGoodDollarIdentity } from "../hooks/useGoodDollarIdentity";
import {
  fetchLeaderboardPage,
  fetchUserRank,
} from "../hooks/useLeaderboard";
import type { LeaderboardPlayer, LeaderboardPage as LeaderboardPageData } from "../hooks/useLeaderboard";
import { keepPreviousData } from "@tanstack/react-query";

const PAGE_SIZE = 20;
const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

// ─── Pagination component ─────────────────────────────────────────────────────

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  // Build the list of page numbers to render, with null meaning ellipsis.
  function pageNumbers(): (number | null)[] {
    const delta = 1; // pages shown on each side of current
    const pages: (number | null)[] = [];
    const left = currentPage - delta;
    const right = currentPage + delta;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= left && i <= right)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== null) {
        pages.push(null); // ellipsis
      }
    }
    return pages;
  }

  const pages = pageNumbers();

  return (
    <nav className="pagination" aria-label="Leaderboard pages">
      <button
        className="pagination__arrow"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        aria-label="Previous page"
      >
        ‹
      </button>

      {pages.map((p, i) =>
        p === null ? (
          <span key={`ellipsis-${i}`} className="pagination__ellipsis">
            …
          </span>
        ) : (
          <button
            key={p}
            className={`pagination__page ${p === currentPage ? "pagination__page--active" : ""}`}
            onClick={() => onPageChange(p)}
            aria-current={p === currentPage ? "page" : undefined}
          >
            {p}
          </button>
        )
      )}

      <button
        className="pagination__arrow"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        aria-label="Next page"
      >
        ›
      </button>
    </nav>
  );
}

// ─── Pinned "You" row ─────────────────────────────────────────────────────────

function YourRankBar({ address }: { address: string }) {
  const { startVerification, isVerifying } = useGoodDollarIdentity();

  const { data, isLoading } = useQuery({
    queryKey: ["your-rank", address],
    queryFn: () => fetchUserRank(address),
    enabled: SUBGRAPH_URL.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="rank-bar rank-bar--loading">Loading your rank…</div>;
  }
  if (!data) {
    return (
      <div className="rank-bar rank-bar--unranked">
        Play a game to earn your rank!
      </div>
    );
  }

  const xpDisplay = Number(data.displayXp).toLocaleString();

  return (
    <div className={`rank-bar ${!data.isVerified ? "rank-bar--unverified" : ""}`}>
      <span className="rank-bar__label">You</span>
      <span className="rank-bar__value">#{data.rank}</span>
      <span className="rank-bar__xp">{xpDisplay} XP</span>
      {!data.isVerified && (
        <div className="rank-bar__verify">
          <span className="badge badge--unverified">Unverified</span>
          <button
            className="btn btn--xs btn--accent"
            onClick={startVerification}
            disabled={isVerifying}
          >
            {isVerifying ? "Verifying…" : "Verify now →"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Leaderboard row ──────────────────────────────────────────────────────────

interface RowProps {
  entry: LeaderboardPlayer;
  globalRank: number;
  isCurrentUser: boolean;
  editingAddress: string | null;
  editValue: string;
  isSaving: boolean;
  saveError: string | null;
  onEditClick: (addr: string, name: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
  onEditValueChange: (v: string) => void;
}

function LeaderboardRow({
  entry,
  globalRank,
  isCurrentUser,
  editingAddress,
  editValue,
  isSaving,
  saveError: _saveError,
  onEditClick,
  onSave,
  onCancel,
  onEditValueChange,
}: RowProps) {
  const name =
    entry.username?.trim() || `Player-${entry.id.slice(-4).toUpperCase()}`;
  const isEditingThis =
    editingAddress?.toLowerCase() === entry.id.toLowerCase();
  const xpDisplay = Number(entry.displayXp).toLocaleString();

  return (
    <li
      className={[
        "leaderboard__entry",
        isCurrentUser ? "leaderboard__entry--current-user" : "",
        !entry.isVerified ? "leaderboard__entry--unverified" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="leaderboard__rank">{globalRank}</span>

      <div className="leaderboard__player">
        {isEditingThis ? (
          <input
            className="leaderboard__name-input"
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            placeholder="your_name"
            maxLength={20}
            autoFocus
            spellCheck={false}
            disabled={isSaving}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") onCancel();
            }}
          />
        ) : (
          <span className="leaderboard__name">{name}</span>
        )}
        <span className="leaderboard__addr" title={entry.id}>
          {`${entry.id.slice(0, 6)}…${entry.id.slice(-4)}`}
        </span>
      </div>

      <div className="leaderboard__score-col">
        <span className="leaderboard__score">{xpDisplay} XP</span>
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
                onClick={onSave}
                disabled={isSaving || !editValue.trim()}
                title="Save username"
              >
                ✓
              </button>
              <button
                className="leaderboard__action-btn leaderboard__action-btn--cancel"
                onClick={onCancel}
                disabled={isSaving}
                title="Cancel"
              >
                ✕
              </button>
            </>
          ) : (
            <button
              className="leaderboard__action-btn leaderboard__action-btn--edit"
              onClick={() => onEditClick(entry.id, entry.username)}
              title="Change username"
            >
              ✎
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ─── Main page (needs useSearchParams → must be inside Suspense) ──────────────

function LeaderboardPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address } = useAuth();
  const { isSaving, error: saveError, save, clearFeedback } = useUsername();

  // Parse ?page=N from URL, clamped after total pages are known.
  const rawPage = parseInt(searchParams.get("page") ?? "1", 10);
  const [currentPage, setCurrentPage] = useState(
    Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1
  );

  const { data, isLoading, isError } = useQuery<LeaderboardPageData>({
    queryKey: ["leaderboard-page", currentPage],
    queryFn: () => fetchLeaderboardPage(currentPage, PAGE_SIZE),
    enabled: SUBGRAPH_URL.length > 0,
    refetchInterval: 30_000,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const players = data?.players ?? [];
  const totalPlayers = data?.totalPlayers ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalPlayers / PAGE_SIZE));
  const configured = SUBGRAPH_URL.length > 0;

  // Clamp currentPage into [1, totalPages] once we know totalPages.
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      handlePageChange(totalPages);
    }
  }, [totalPages]);

  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function handlePageChange(page: number) {
    const clamped = Math.max(1, Math.min(page, totalPages || 1));
    setCurrentPage(clamped);
    router.push(`/leaderboard?page=${clamped}`, { scroll: false });
  }

  function handleEditClick(addr: string, currentName: string | null) {
    setEditingAddress(addr);
    setEditValue(currentName?.trim() || "");
    clearFeedback();
  }

  async function handleSave() {
    if (!editValue.trim()) return;
    await save(editValue.trim());
    if (!saveError) {
      setEditingAddress(null);
      setEditValue("");
    }
  }

  function handleCancel() {
    setEditingAddress(null);
    setEditValue("");
    clearFeedback();
  }

  const showEmpty =
    configured && !isLoading && (isError || players.length === 0);

  return (
    <div className="leaderboard-page">
      <div className="leaderboard-page__header">
        <Link href="/" className="leaderboard-page__back">
          ← Back
        </Link>
        <h1 className="leaderboard-page__title">Leaderboard</h1>
        {totalPlayers > 0 && (
          <span className="leaderboard-page__count">
            {totalPlayers.toLocaleString()} players
          </span>
        )}
      </div>

      {/* Pinned user row — visible on every page */}
      {address && <YourRankBar address={address} />}

      <div className="leaderboard">
        {!configured && (
          <p className="leaderboard__empty">Leaderboard is being set up.</p>
        )}
        {configured && isLoading && !data && (
          <p className="leaderboard__empty">Loading…</p>
        )}
        {showEmpty && (
          <p className="leaderboard__empty">
            No scores yet. Be the first to play!
          </p>
        )}
        {isError && !isLoading && (
          <p className="leaderboard__empty leaderboard__empty--error">
            Could not load leaderboard right now. Please try again shortly.
          </p>
        )}

        {players.length > 0 && (
          <ol className="leaderboard__list">
            {players.map((entry: LeaderboardPlayer, i: number) => {
              const globalRank = (currentPage - 1) * PAGE_SIZE + i + 1;
              const isCurrentUser =
                !!address &&
                entry.id.toLowerCase() === address.toLowerCase();
              return (
                <LeaderboardRow
                  key={entry.id}
                  entry={entry}
                  globalRank={globalRank}
                  isCurrentUser={isCurrentUser}
                  editingAddress={editingAddress}
                  editValue={editValue}
                  isSaving={isSaving}
                  saveError={saveError}
                  onEditClick={handleEditClick}
                  onSave={handleSave}
                  onCancel={handleCancel}
                  onEditValueChange={setEditValue}
                />
              );
            })}
          </ol>
        )}

        {editingAddress && saveError && (
          <div className="leaderboard__error">{saveError}</div>
        )}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
      />
    </div>
  );
}

// Suspense wrapper required because useSearchParams() suspends in Next.js 14.
export default function LeaderboardPage() {
  return (
    <Suspense
      fallback={
        <div className="leaderboard-page">
          <div className="leaderboard__empty">Loading…</div>
        </div>
      }
    >
      <LeaderboardPageInner />
    </Suspense>
  );
}
