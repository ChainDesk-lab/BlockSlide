import Link from "next/link";
import { getAvatarGradient, formatAddress } from "../lib/profileUtils";
import type { ChecksStatus, LiveEntry, PublicBounty, PublicStandings, Winner } from "../lib/bountyStandings";
import { fmtPrizeUsd, ordinal, prizeFor, prizePoolUsd, type EntryEligibility } from "../lib/bountyEligibility";
import type { EligibilityItem, PrizePlace } from "../config/bounties";

/** Presentational pieces of /bounty. Data comes from /api/bounties (see lib/bountyStandings). */

const fmtXp = (xp: string) => `${Number(xp).toLocaleString("en-US")} XP`;

/** The bounty's window in the zone it was announced in (UTC unless the bounty sets one). */
export function fmtBountyWindow(b: Pick<PublicBounty, "startTime" | "endTime" | "timeZone">): string {
  const zone = b.timeZone?.iana ?? "UTC";
  const f = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: zone });
  return `${f(b.startTime)} – ${f(b.endTime)} ${b.timeZone?.label ?? "UTC"}`;
}

type RuleInfo = Pick<PublicBounty, "rules" | "prizeTable">;

// ── Bounties with rules: prizes, eligibility and per-player checks ──────────────

export function PrizeTable({ table }: { table: PrizePlace[] }) {
  return (
    <div className="bounty-prizes">
      <table className="bounty-prizes__table">
        <caption className="bounty-prizes__caption">Prize pool: {fmtPrizeUsd(prizePoolUsd(table))}</caption>
        <thead>
          <tr><th scope="col">Place</th><th scope="col">Prize</th></tr>
        </thead>
        <tbody>
          {table.map((p) => (
            <tr key={p.place} className={`bounty-prizes__row bounty-prizes__row--${p.place}`}>
              <th scope="row">{ordinal(p.place)}</th>
              <td>{fmtPrizeUsd(p.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="bounty-prizes__note">Prizes are paid in G$ worth these dollar amounts. The number of G$ depends on the G$ rate on the day prizes are paid.</p>
    </div>
  );
}

const CHECK_LABEL: Record<EligibilityItem["check"], string> = {
  "on-chain": "Checked on-chain",
  leaderboard: "From the race leaderboard",
  team: "Checked by the team",
};

export function EligibilityList({ items }: { items: EligibilityItem[] }) {
  return (
    <ul className="bounty-eligibility">
      {items.map((it) => (
        <li key={it.text} className="bounty-eligibility__item">
          <span className="bounty-eligibility__text">{it.text}</span>
          <span className={`bounty-eligibility__check bounty-eligibility__check--${it.check}`}>{CHECK_LABEL[it.check]}</span>
        </li>
      ))}
    </ul>
  );
}

function EligibilityBadges({ e, minPurchases }: { e: EntryEligibility; minPurchases: number }) {
  const gd: [string, string] =
    e.goodDollarVerified === true ? ["ok", "GoodDollar verified"]
      : e.goodDollarVerified === false ? ["no", "Not GoodDollar verified"]
        : ["unknown", "Verification pending"];
  let purchases: [string, string] | null = null;
  if (minPurchases > 0) {
    if (e.purchases === null) purchases = ["unknown", "Purchases: counting"];
    else {
      const reached = e.purchases >= minPurchases;
      const tone = reached ? "ok" : e.purchasesComplete ? "no" : "unknown";
      purchases = [tone, `${Math.min(e.purchases, 999)}${e.purchasesComplete ? "" : "+"}/${minPurchases} purchases`];
    }
  }
  return (
    <span className="bounty-badges">
      <span className={`bounty-badge bounty-badge--${gd[0]}`}>{gd[1]}</span>
      {purchases && <span className={`bounty-badge bounty-badge--${purchases[0]}`}>{purchases[1]}</span>}
    </span>
  );
}

function ChecksNote({ checks, live }: { checks: ChecksStatus; live: boolean }) {
  const manual = checks.manualChecks.length > 0 ? checks.manualChecks.join("; ") : null;
  return (
    <div className="bounty-checks">
      {live && <p className="bounty-checks__line">🏆 marks the five highest-ranked players who meet the on-chain checks right now: GoodDollar verification and enough Shop purchases during the race.</p>}
      {!checks.purchasesComplete && <p className="bounty-checks__line bounty-checks__line--warn">Purchase counts are still catching up from the start of the race, so a count may rise.</p>}
      {!checks.verificationAvailable && <p className="bounty-checks__line bounty-checks__line--warn">GoodDollar verification couldn&apos;t be read for some players. It&apos;s retried on the next refresh.</p>}
      {live && !checks.selectionComplete && <p className="bounty-checks__line bounty-checks__line--warn">Prize positions may change: some higher-ranked players&apos; eligibility couldn&apos;t be confirmed yet.</p>}
      {manual && <p className="bounty-checks__line">Checked by the team before any prize is paid: {manual}.</p>}
    </div>
  );
}

// ── Standings rows ────────────────────────────────────────────────────

function LiveRow({ e, rules, prizePlace }: { e: LiveEntry; rules?: RuleInfo; prizePlace: number | null }) {
  const ruled = !!e.eligibility;
  const prize = ruled ? prizePlace !== null : e.rank <= 5;
  const name = <Link href={`/profile/${e.id}`} className="bounty-leaderboard__name-link">{e.username || formatAddress(e.id)}</Link>;
  const prizeUsd = prizePlace !== null ? prizeFor(rules?.prizeTable, prizePlace) : null;
  return (
    <li className={`bounty-leaderboard__entry ${prize ? "bounty-leaderboard__entry--prize" : ""}`}>
      <span className="bounty-leaderboard__rank">{prize ? `🏆 #${e.rank}` : `#${e.rank}`}</span>
      <div className="bounty-leaderboard__avatar" style={{ background: getAvatarGradient(e.id) }}>{e.id.slice(2, 3).toUpperCase()}</div>
      {ruled ? (
        <div className="bounty-leaderboard__who">
          <div className="bounty-leaderboard__name">{name}</div>
          <EligibilityBadges e={e.eligibility as EntryEligibility} minPurchases={rules?.rules?.minPurchases ?? 0} />
        </div>
      ) : (
        <div className="bounty-leaderboard__name">{name}</div>
      )}
      <span className="bounty-leaderboard__xp">
        {fmtXp(e.xp)}
        {prizePlace !== null && prizeUsd !== null && <span className="bounty-leaderboard__prize">{ordinal(prizePlace)} · ${prizeUsd} in G$</span>}
      </span>
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
      <span className="bounty-leaderboard__xp">
        {fmtXp(w.xp)}
        {w.prizeUsd !== undefined && w.prizeUsd !== null && <span className="bounty-leaderboard__prize">{fmtPrizeUsd(w.prizeUsd)}</span>}
      </span>
    </li>
  );
}


/** Live: current standings. Completed: the five winners only. */
export function BountyStandings({ standings, loading, title = true, bounty }: { standings: PublicStandings | null; loading?: boolean; title?: boolean; bounty?: RuleInfo }) {
  if (loading || !standings) {
    return <p className="bounty-leaderboard__loading">Loading standings…</p>;
  }
  if (standings.phase === "upcoming") return null;
  if (standings.phase === "unavailable") {
    return <p className="bounty-leaderboard__error">Standings can&apos;t be loaded right now. Please try again shortly.</p>;
  }
  if (standings.phase === "live") {
    const ruled = !!standings.checks;
    // Prize positions come from the server, which walks the whole ranking, so a position can
    // belong to a player ranked below the displayed list.
    const positions = standings.prizePositions ?? [];
    const places = new Map(positions.map((p) => [p.id, p.place]));
    const below = positions.filter((p) => p.rank > standings.entries.length);
    return (
      <div className="bounty-standings bounty-standings--live">
        {title && <h3 className="bounty-card__section-title">Live Standings</h3>}
        {standings.entries.length === 0
          ? <p className="bounty-leaderboard__empty">{ruled ? "No one has earned XP in the race yet. Play a game to get on the board." : "No verified players have earned XP yet."}</p>
          : <ol className="bounty-leaderboard__list">{standings.entries.map((e) => <LiveRow key={e.id} e={e} rules={bounty} prizePlace={places.get(e.id) ?? null} />)}</ol>}
        {below.length > 0 && (
          <>
            <p className="bounty-checks__line">Also in a prize position, ranked below #{standings.entries.length}:</p>
            <ol className="bounty-leaderboard__list">{below.map((p) => <LiveRow key={p.id} e={p} rules={bounty} prizePlace={p.place} />)}</ol>
          </>
        )}
        {standings.checks && <ChecksNote checks={standings.checks} live />}
      </div>
    );
  }
  const ruled = !!standings.checks;
  const settled = standings.complete !== false;
  const heading = !ruled ? "Winners · Final Standings" : settled ? "Provisional Winners · Final Standings" : "Results Being Checked";
  return (
    <div className="bounty-standings bounty-standings--final">
      {title && <h3 className="bounty-card__section-title">{heading}</h3>}
      {ruled && !settled && (
        <p className="bounty-checks__line bounty-checks__line--warn">
          Not final: some players&apos; eligibility couldn&apos;t be checked yet. The players below pass every check so far, and the list may still change.
        </p>
      )}
      {standings.winners.length === 0
        ? <p className="bounty-leaderboard__empty">{ruled ? "No player has passed the on-chain checks yet, so there are no winners to show." : "No verified player earned XP during this bounty, so there are no winners."}</p>
        : <ol className="bounty-leaderboard__list">{standings.winners.map((w) => <WinnerRow key={w.rank} w={w} />)}</ol>}
      {ruled ? (
        <>
          <p className="bounty-standings__note">
            Results: XP earned from the race&apos;s start up to (not including) its end, among players who passed the on-chain checks.
            {settled && standings.winners.length > 0 && standings.winners.length < 5 && ` Only ${standings.winners.length} player${standings.winners.length === 1 ? "" : "s"} passed every check.`}
            {standings.participants > 0 && ` ${standings.participants} player${standings.participants === 1 ? "" : "s"} earned XP in the race.`}
          </p>
          {standings.checks && <ChecksNote checks={standings.checks} live={false} />}
        </>
      ) : (
        <p className="bounty-standings__note">
          {standings.winners.length < 5 && standings.winners.length > 0
            ? `Only ${standings.winners.length} verified player${standings.winners.length === 1 ? "" : "s"} earned XP during this bounty. `
            : ""}
          Final results: XP earned between the bounty&apos;s start and end.
          {standings.participants > 0 && ` ${standings.participants} verified player${standings.participants === 1 ? "" : "s"} took part.`}
        </p>
      )}
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
      <BountyStandings standings={bounty.standings} loading={loading} bounty={bounty} />
    </article>
  );
}
