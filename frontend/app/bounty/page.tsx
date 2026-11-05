"use client";

import { useEffect, useState } from "react";
import { bounties, getBountyStatus } from "../../src/config/bounties";
import { useBounties } from "../../src/hooks/useBounties";
import { BountyStandings, PastBountyCard, fmtBountyWindow } from "../../src/components/BountyPanels";
import { toPublicBounty, type PublicBounty } from "../../src/lib/bountyStandings";

function UpcomingBountyCard({ bounty }: { bounty: PublicBounty }) {
  return (
    <div className="bounty-card bounty-card--upcoming">
      <div className="bounty-card__header">
        <h2 className="bounty-card__title">{bounty.title}</h2>
        <span className="bounty-card__badge">Coming Soon</span>
      </div>

      <p className="bounty-card__description">{bounty.description}</p>

      <div className="bounty-card__info">
        <div className="bounty-card__info-item">
          <span className="bounty-card__info-label">Status</span>
          <span className="bounty-card__info-value">Coming up soon</span>
        </div>
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

export default function BountyPage() {
  const { data, isLoading, isError } = useBounties();
  // Details always come from the config (they render even if standings can't load); status and
  // standings from the API once it answers, otherwise the status from the end time here.
  const byId = new Map((data ?? []).map((b) => [b.id, b]));
  const all: PublicBounty[] = bounties.map((b, i) =>
    byId.get(b.id) ?? toPublicBounty(b, i, getBountyStatus(b), isError ? { phase: "unavailable" } : { phase: "upcoming" })
  );
  const standingsLoading = isLoading && !data;

  // Featured: the first bounty not yet ended, else the most recent one (unchanged rule).
  const currentBounty = all.find((b) => b.status !== "ended") ?? all[all.length - 1];
  const status = currentBounty.status;
  const endedBounties = all.filter((b) => b.status === "ended" && b.id !== currentBounty.id).reverse(); // newest first
  const upcomingBounties = all.filter((b) => b.status === "upcoming" && b.id !== currentBounty.id);

  const statusBadgeText = status === "upcoming" ? "Upcoming" : status === "live" ? "LIVE 🔴" : "Ended";
  const targetTime = status === "upcoming" ? new Date(currentBounty.startTime) : new Date(currentBounty.endTime);

  return (
    <div className="bounty-page">
      <h1 className="bounty-page__title">Bounties</h1>
      {status === "ended" && (
        <p className="bounty-page__note">No bounty is running right now. The latest results are below.</p>
      )}

      {/* Featured bounty */}
      <div className={`bounty-card bounty-card--${status}`}>
        <p className="bounty-card__kicker">Bounty #{currentBounty.number}</p>
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
          {status !== "ended" ? (
            <div className="bounty-card__info-item">
              <span className="bounty-card__info-label">{status === "upcoming" ? "Starts in" : "Ends in"}</span>
              <CountdownTimer targetTime={targetTime} />
            </div>
          ) : (
            <div className="bounty-card__info-item">
              <span className="bounty-card__info-label">Ran</span>
              <span className="bounty-card__info-value">{fmtBountyWindow(currentBounty)}</span>
            </div>
          )}
        </div>

        <div className="bounty-card__section">
          <h3 className="bounty-card__section-title">How to Participate</h3>
          <ol className="bounty-card__list">
            {currentBounty.howToParticipate.map((step, i) => (
              <li key={i} className="bounty-card__list-item">{step}</li>
            ))}
          </ol>
        </div>

        <div className="bounty-card__section">
          <h3 className="bounty-card__section-title">Winner Criteria</h3>
          <p className="bounty-card__criteria">{currentBounty.winnerCriteria}</p>
        </div>

        {/* Live: current standings. Completed: the five winners only (the API sends nothing more). */}
        {status !== "upcoming" && (
          <div className="bounty-card__section bounty-card__section--leaderboard">
            <BountyStandings standings={currentBounty.standings} loading={standingsLoading} />
          </div>
        )}
      </div>

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

      {endedBounties.length > 0 && (
        <div className="bounty-page__past">
          <h2 className="bounty-page__past-title">Past Bounties</h2>
          {endedBounties.map((bounty) => <PastBountyCard key={bounty.id} bounty={bounty} loading={standingsLoading} />)}
        </div>
      )}
    </div>
  );
}
