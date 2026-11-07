import Link from "next/link";
import { getAvatarGradient, formatAddress } from "../lib/profileUtils";
import type { LiveEntry, PublicBounty, PublicStandings, Winner } from "../lib/bountyStandings";

/** Presentational pieces of /bounty. Data comes from /api/bounties (see lib/bountyStandings). */

const fmtXp = (xp: string) => `${Number(xp).toLocaleString("en-US")} XP`;

export function fmtBountyWindow(b: Pick<PublicBounty, "startTime" | "endTime">): string {
  const f = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${f(b.startTime)} – ${f(b.endTime)} UTC`;
}

function LiveRow({ e }: { e: LiveEntry }) {
  const prize = e.rank <= 5;
  return (
    <li className={`bounty-leaderboard__entry ${prize ? "bounty-leaderboard__entry--prize" : ""}`}>
      <span className="bounty-leaderboard__rank">{prize ? `🏆 #${e.rank}` : `#${e.rank}`}</span>
      <div className="bounty-leaderboard__avatar" style={{ background: getAvatarGradient(e.id) }}>{e.id.slice(2, 3).toUpperCase()}</div>
      <div className="bounty-leaderboard__name">
        <Link href={`/profile/${e.id}`} className="bounty-leaderboard__name-link">{e.username || formatAddress(e.id)}</Link>
      </div>
      <span className="bounty-leaderboard__xp">{fmtXp(e.xp)}</span>
    </li>
  );
}

/** A winner has no address: named winners link to their profile by username; unnamed ones don't link. */
function WinnerRow({ w }: { w: Winner }) {
  const name = w.displayName ?? "Unnamed player";
  return (
    <li className={`bounty-leaderboard__entry bounty-leaderboard__entry--prize bounty-winner bounty-winner--${w.rank}`}>
      <span className="bounty-leaderboard__rank">🏆 #{w.rank}</span>
      <div className="bounty-leaderboard__avatar bounty-winner__avatar" aria-hidden="true">{w.displayName ? w.displayName.charAt(0).toUpperCase() : "?"}</div>
      <div className="bounty-leaderboard__name">
        {w.profile
          ? <Link href={`/profile/${encodeURIComponent(w.profile)}`} className="bounty-leaderboard__name-link">{name}</Link>
          : <span className="bounty-winner__unnamed">{name}</span>}
      </div>
      <span className="bounty-leaderboard__xp">{fmtXp(w.xp)}</span>
    </li>
  );
}

/** Live: current standings. Completed: the five winners only. */
export function BountyStandings({ standings, loading, title = true }: { standings: PublicStandings | null; loading?: boolean; title?: boolean }) {
  if (loading || !standings) {
    return <p className="bounty-leaderboard__loading">Loading standings…</p>;
  }
  if (standings.phase === "upcoming") return null;
  if (standings.phase === "unavailable") {
    return <p className="bounty-leaderboard__error">Standings can&apos;t be loaded right now. Please try again shortly.</p>;
  }
  if (standings.phase === "live") {
    return (
      <div className="bounty-standings bounty-standings--live">
        {title && <h3 className="bounty-card__section-title">Live Standings</h3>}
        {standings.entries.length === 0
          ? <p className="bounty-leaderboard__empty">No verified players have earned XP yet.</p>
          : <ol className="bounty-leaderboard__list">{standings.entries.map((e) => <LiveRow key={e.id} e={e} />)}</ol>}
      </div>
    );
  }
  return (
    <div className="bounty-standings bounty-standings--final">
      {title && <h3 className="bounty-card__section-title">Winners · Final Standings</h3>}
      {standings.winners.length === 0
        ? <p className="bounty-leaderboard__empty">No verified player earned XP during this bounty, so there are no winners.</p>
        : <ol className="bounty-leaderboard__list">{standings.winners.map((w) => <WinnerRow key={w.rank} w={w} />)}</ol>}
      <p className="bounty-standings__note">
        {standings.winners.length < 5 && standings.winners.length > 0
          ? `Only ${standings.winners.length} verified player${standings.winners.length === 1 ? "" : "s"} earned XP during this bounty. `
          : ""}
        Final results: XP earned between the bounty&apos;s start and end.
        {standings.participants > 0 && ` ${standings.participants} verified player${standings.participants === 1 ? "" : "s"} took part.`}
      </p>
    </div>
  );
}

export function PastBountyCard({ bounty, loading }: { bounty: PublicBounty; loading?: boolean }) {
  return (
    <article className="bounty-ended bounty-card--ended" aria-label={`Bounty ${bounty.number}: ${bounty.title}`}>
      <p className="bounty-card__kicker">Bounty #{bounty.number}</p>
      <div className="bounty-card__header">
        <h3 className="bounty-card__title">{bounty.title}</h3>
        <span className="bounty-card__badge">Ended</span>
      </div>
      <p className="bounty-card__description">{bounty.description}</p>
      <div className="bounty-card__info">
        <div className="bounty-card__info-item">
          <span className="bounty-card__info-label">Prizes</span>
          <span className="bounty-card__info-value">{bounty.prizes}</span>
        </div>
        <div className="bounty-card__info-item">
          <span className="bounty-card__info-label">Ran</span>
          <span className="bounty-card__info-value">{fmtBountyWindow(bounty)}</span>
        </div>
      </div>
      <BountyStandings standings={bounty.standings} loading={loading} />
    </article>
  );
}
