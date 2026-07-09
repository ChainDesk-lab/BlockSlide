"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ToastProvider } from "../contexts/ToastContext";
import { DualAuthBridge } from "../auth/DualAuthBridge";
import { NoGasProvider } from "../contexts/NoGasContext";
import ToastContainer from "./ToastContainer";
import Leaderboard from "./Leaderboard";
import { useLeaderboard, fetchLeaderboardPage } from "../hooks/useLeaderboard";
import type { LeaderboardPlayer } from "../hooks/useLeaderboard";
import { useContractAddress } from "../hooks/useContractData";

// ── Your-rank bar ──────────────────────────────────────────────────────────

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

async function fetchPlayerXp(address: string): Promise<string | null> {
  if (!SUBGRAPH_URL) return null;
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{ player(id: "${address.toLowerCase()}") { xp } }`,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { player?: { xp: string } | null } };
  return json.data?.player?.xp ?? null;
}

async function fetchPlayersAbove(xp: string): Promise<number> {
  if (!SUBGRAPH_URL) return 0;
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // xp is BigInt in the schema — pass as string, not number
      query: `{ players(where: { xp_gt: "${xp}" }, first: 1000) { id } }`,
    }),
  });
  if (!res.ok) return 0;
  const json = (await res.json()) as { data?: { players?: { id: string }[] } };
  return json.data?.players?.length ?? 0;
}

function YourRankBar() {
  const address = useContractAddress();
  const [rank, setRank] = useState<number | null>(null);
  const [xp, setXp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const playerXp = await fetchPlayerXp(address);
      if (cancelled) return;

      if (playerXp === null) {
        // No player entity — not in the subgraph yet (never played)
        setRank(null);
        setXp(null);
        setLoading(false);
        return;
      }

      setXp(playerXp);
      const above = await fetchPlayersAbove(playerXp);
      if (!cancelled) {
        setRank(above + 1);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [address]);

  if (!address) {
    return (
      <div className="rank-bar rank-bar--disconnected">
        Connect your wallet to see your rank
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rank-bar rank-bar--loading">
        <span className="spinner" aria-hidden="true" /> Calculating your rank…
      </div>
    );
  }

  if (rank === null) {
    return (
      <div className="rank-bar rank-bar--unranked">
        Play a game to earn your first XP and appear on the leaderboard
      </div>
    );
  }

  return (
    <div className="rank-bar">
      <span className="rank-bar__label">Your rank</span>
      <span className="rank-bar__rank">#{rank}</span>
      <span className="rank-bar__xp">{Number(xp).toLocaleString()} XP</span>
    </div>
  );
}

// ── Paginated leaderboard content ──────────────────────────────────────────

function LeaderboardContent() {
  // First 50 — polled every 30s
  const { players: firstPage, isLoading, isError, configured } = useLeaderboard(50, 0);

  // Manually fetched extra pages — static, appended on "Load more"
  const [extraPlayers, setExtraPlayers] = useState<LeaderboardPlayer[]>([]);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  // Track whether there are more pages: null = unknown (first page still loading),
  // true/false = determined from last fetch result.
  const [hasMoreExtra, setHasMoreExtra] = useState<boolean | null>(null);

  // Once the first page loads, determine initial "has more" from its size
  useEffect(() => {
    if (!isLoading && hasMoreExtra === null) {
      setHasMoreExtra(firstPage.length === 50);
    }
  }, [isLoading, firstPage.length, hasMoreExtra]);

  const allPlayers = [...firstPage, ...extraPlayers];
  const showLoadMore =
    configured &&
    !isLoading &&
    !isError &&
    (hasMoreExtra === null ? firstPage.length === 50 : hasMoreExtra);

  const handleLoadMore = async () => {
    setIsFetchingMore(true);
    try {
      // Always use fixed page offsets (multiples of 50) so skip is predictable
      // even if the first page changes size due to polling.
      const skip = 50 + extraPlayers.length;
      const batch = await fetchLeaderboardPage(50, skip);
      setExtraPlayers((prev) => [...prev, ...batch]);
      setHasMoreExtra(batch.length === 50);
    } catch {
      // silently ignore — user can retry
    } finally {
      setIsFetchingMore(false);
    }
  };

  return (
    <div className="leaderboard-page__content">
      <YourRankBar />

      <Leaderboard
        players={allPlayers}
        isLoading={isLoading}
        isError={isError}
        configured={configured}
        rankOffset={0}
        showSeeMore={false}
      />

      {showLoadMore && (
        <div className="leaderboard-page__load-more">
          <button
            className="btn btn--ghost"
            onClick={handleLoadMore}
            disabled={isFetchingMore}
          >
            {isFetchingMore ? (
              <>
                <span className="spinner" aria-hidden="true" /> Loading…
              </>
            ) : (
              "Load more"
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page root — wraps with all required providers ──────────────────────────

export default function LeaderboardPageRoot() {
  return (
    <ToastProvider>
      <DualAuthBridge>
        <NoGasProvider>
          <ToastContainer />
          <div className="leaderboard-page">
            <header className="leaderboard-page__header">
              <Link href="/" className="leaderboard-page__back">
                ← BlockSlide
              </Link>
              <h1 className="leaderboard-page__title">Leaderboard</h1>
            </header>
            <main className="leaderboard-page__main">
              <LeaderboardContent />
            </main>
          </div>
        </NoGasProvider>
      </DualAuthBridge>
    </ToastProvider>
  );
}
