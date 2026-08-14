"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bounties, getBountyStatus } from "../../src/config/bounties";
import { useBountyLeaderboard } from "../../src/hooks/useBountyLeaderboard";
import { getAvatarGradient, formatAddress } from "../../src/lib/profileUtils";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

function EndedBountyWinners({ bounty }: { bounty: typeof bounties[0] }) {
  const { entries: leaderboardEntries, loading, error } = useBountyLeaderboard(
    bounty,
    SUBGRAPH_URL,
    "ended"
  );

  // Show only top 5 winners
  const topWinners = leaderboardEntries.slice(0, 5);

  return (
    <div className="bounty-ended__winners">
      <h3 className="bounty-ended__section-title">Winners</h3>

      {loading && <p className="bounty-leaderboard__loading">Loading winners…</p>}
      {error && <p className="bounty-leaderboard__error">Failed to load winners: {error}</p>}

      {!loading && topWinners.length === 0 && (
        <p className="bounty-leaderboard__empty">No winners recorded.</p>
      )}

      {!loading && topWinners.length > 0 && (
        <ol className="bounty-leaderboard__list bounty-leaderboard__list--faded">
          {topWinners.map((entry, idx) => (
            <BountyLeaderboardRow
              key={entry.id}
              rank={idx + 1}
              player={{ id: entry.id, username: entry.username }}
              bountyXp={entry.bountyXp}
              isPrizePosition={true}
              isPreview={false}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function UpcomingBountyCard({ bounty }: { bounty: typeof bounties[0] }) {
  return (
    <div className="bounty-card bounty-card--upcoming">
      <div className="bounty-card__header">
        <h2 className="bounty-card__title">{bounty.title}</h2>
        <span className="bounty-card__badge">Coming Soon</span>
      </div>

      <p className="bounty-card__description">{bounty.description}</p>

      <div className="bounty-card__info">
        <div className="bounty-card__info-item">
          <span className="bounty-card__info-label">Prizes</span>
          <span className="bounty-card__info-value">{bounty.prizes}</span>
        </div>
      </div>

      <div className="bounty-card__section">
        <h3 className="bounty-card__section-title">How to Participate</h3>
        <ol className="bounty-card__list">
          {bounty.howToParticipate.map((step, i) => (
            <li key={i} className="bounty-card__list-item">
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="bounty-card__section">
        <h3 className="bounty-card__section-title">Winner Criteria</h3>
        <p className="bounty-card__criteria">{bounty.winnerCriteria}</p>
      </div>
    </div>
  );
}

function CountdownTimer({ targetTime }: { targetTime: Date }) {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const diff = targetTime.getTime() - now.getTime();

      if (diff <= 0) {
        setTime("0d 0h 0m 0s");
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTime(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetTime]);

  return <span className="bounty-countdown">{time}</span>;
}

function BountyLeaderboardRow({
  rank,
  player,
  bountyXp,
  isPrizePosition,
  isPreview,
}: {
  rank: number;
  player: { id: string; username: string | null };
  bountyXp: bigint;
  isPrizePosition: boolean;
  isPreview: boolean;
}) {
  const avatar = getAvatarGradient(player.id);
  const name = player.username || formatAddress(player.id);

  return (
    <li
      className={`bounty-leaderboard__entry ${isPrizePosition ? "bounty-leaderboard__entry--prize" : ""} ${
        isPreview ? "bounty-leaderboard__entry--preview" : ""
      }`}
    >
      <span className="bounty-leaderboard__rank">{isPrizePosition ? `🏆 #${rank}` : `#${rank}`}</span>
      <div className="bounty-leaderboard__avatar" style={{ background: avatar }}>
        {player.id.slice(2, 3).toUpperCase()}
      </div>
      <div className="bounty-leaderboard__name">
        <Link href={`/profile/${player.id}`} className="bounty-leaderboard__name-link">
          {name}
        </Link>
      </div>
      <span className="bounty-leaderboard__xp">{Number(bountyXp).toLocaleString()} XP</span>
    </li>
  );
}

export default function BountyPage() {
  // Find the first non-ended bounty (upcoming or live)
  const currentBounty = bounties.find((b) => getBountyStatus(b) !== "ended") || bounties[bounties.length - 1];
  const [status, setStatus] = useState<"upcoming" | "live" | "ended">(getBountyStatus(currentBounty));
  // Show all ended bounties EXCEPT the current one (to avoid duplication if it's the fallback)
  const endedBounties = bounties.filter((b) => getBountyStatus(b) === "ended" && b.id !== currentBounty.id);
  // Show upcoming bounties EXCEPT the current one (to avoid duplication)
  const upcomingBounties = bounties.filter((b) => getBountyStatus(b) === "upcoming" && b.id !== currentBounty.id);

  const { entries: leaderboardEntries, loading, error } = useBountyLeaderboard(
    currentBounty,
    SUBGRAPH_URL,
    status
  );

  const statusBadgeText = status === "upcoming" ? "Upcoming" : status === "live" ? "LIVE 🔴" : "Ended";
  // Countdown target derives from status: upcoming → startTime, live → endTime, ended → no countdown
  const targetTime =
    status === "upcoming" ? new Date(currentBounty.startTime) : new Date(currentBounty.endTime);
  const isUpcoming = status === "upcoming";

  // Auto-flip status when countdown reaches zero
  useEffect(() => {
    if (isUpcoming) {
      const checkFlip = () => {
        const newStatus = getBountyStatus(currentBounty);
        if (newStatus !== status) {
          setStatus(newStatus);
        }
      };

      const startTime = new Date(currentBounty.startTime).getTime();
      const now = Date.now();
      const timeUntilLive = startTime - now;

      if (timeUntilLive > 0) {
        const timer = setTimeout(checkFlip, timeUntilLive + 100);
        return () => clearTimeout(timer);
      }
    }
  }, [status, currentBounty, isUpcoming]);

  return (
    <div className="bounty-page">
      {/* Header */}
      <h1 className="bounty-page__title">Bounties</h1>

      {/* Featured bounty */}
      <div className={`bounty-card bounty-card--${status}`}>
        <div className="bounty-card__header">
          <h2 className="bounty-card__title">{currentBounty.title}</h2>
          <span className="bounty-card__badge">{statusBadgeText}</span>
        </div>

        <p className="bounty-card__description">{currentBounty.description}</p>

        <div className="bounty-card__info">
          <div className="bounty-card__info-item">
            <span className="bounty-card__info-label">Prizes</span>
            <span className="bounty-card__info-value">{currentBounty.prizes}</span>
          </div>
          {status !== "ended" && (
            <div className="bounty-card__info-item">
              <span className="bounty-card__info-label">
                {status === "upcoming" ? "Starts in" : "Ends in"}
              </span>
              <CountdownTimer targetTime={targetTime} />
            </div>
          )}
        </div>

        <div className="bounty-card__section">
          <h3 className="bounty-card__section-title">How to Participate</h3>
          <ol className="bounty-card__list">
            {currentBounty.howToParticipate.map((step, i) => (
              <li key={i} className="bounty-card__list-item">
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="bounty-card__section">
          <h3 className="bounty-card__section-title">Winner Criteria</h3>
          <p className="bounty-card__criteria">{currentBounty.winnerCriteria}</p>
        </div>

        {/* Leaderboard section — visible in all states */}
        <div className="bounty-card__section bounty-card__section--leaderboard">
          <h3 className="bounty-card__section-title">
            {status === "live" ? "Live Standings" : status === "ended" ? "Final Standings" : "Preview"}
          </h3>

          {loading && <p className="bounty-leaderboard__loading">Loading leaderboard…</p>}
          {error && <p className="bounty-leaderboard__error">Failed to load leaderboard: {error}</p>}

          {!loading && leaderboardEntries.length === 0 && (
            <p className="bounty-leaderboard__empty">No verified players yet.</p>
          )}

          {!loading && leaderboardEntries.length > 0 && (
            <ol className="bounty-leaderboard__list">
              {leaderboardEntries.map((entry, idx) => (
                <BountyLeaderboardRow
                  key={entry.id}
                  rank={idx + 1}
                  player={{ id: entry.id, username: entry.username }}
                  bountyXp={entry.bountyXp}
                  isPrizePosition={idx < 5 && !isUpcoming}
                  isPreview={isUpcoming}
                />
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Upcoming bounties section */}
      {upcomingBounties.length > 0 && (
        <div className="bounty-page__upcoming">
          <h2 className="bounty-page__upcoming-title">Upcoming Bounties</h2>
          <div className="bounty-page__upcoming-grid">
            {upcomingBounties.map((bounty) => (
              <UpcomingBountyCard key={bounty.id} bounty={bounty} />
            ))}
          </div>
        </div>
      )}

      {/* Past bounties section */}
      {endedBounties.length > 0 && (
        <div className="bounty-page__past">
          <h2 className="bounty-page__past-title">Past Bounties</h2>
          {endedBounties.map((bounty) => (
            <div key={bounty.id} className="bounty-ended bounty-card--ended">
              <div className="bounty-card__header">
                <h3 className="bounty-card__title">{bounty.title}</h3>
                <span className="bounty-card__badge">Ended</span>
              </div>
              <EndedBountyWinners bounty={bounty} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
