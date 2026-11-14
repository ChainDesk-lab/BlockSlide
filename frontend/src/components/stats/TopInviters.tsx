import Link from "next/link";
import { useTopInviters } from "../../hooks/useReferrals";

const fmt = new Intl.NumberFormat("en-US");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Stats page: the players whose invite links brought the most people in, ranked by how many of
 * those have played (rules in lib/referrals.ts). Has its own loading, empty and error states, so
 * the rest of the page never waits for it.
 */
export default function TopInviters() {
  const { data, isLoading, isError } = useTopInviters();
  const playedKnown = data?.totals.played !== null && data?.totals.played !== undefined;

  return (
    <section aria-labelledby="stats-invites">
      <div className="stats2__section-head">
        <h2 id="stats-invites" className="section-title">Top inviters</h2>
        <p>Players who brought others to BlockSlide with their invite link</p>
      </div>
      <div className="card stats2__invites">
        {isLoading && <p className="state-note" role="status">Loading invite counts…</p>}
        {isError && <p className="state-note state-note--error" role="alert">Invite counts can&apos;t be read right now.</p>}
        {data && data.top.length === 0 && (
          <p className="state-note">No one has joined through an invite link yet. Every player can share theirs from their profile.</p>
        )}
        {data && data.top.length > 0 && (
          <>
            <p className="stats2__invites-total">
              <strong>{fmt.format(data.totals.joined)}</strong> {data.totals.joined === 1 ? "player has" : "players have"} joined through invite links
              {playedKnown && <> · <strong>{fmt.format(data.totals.played as number)}</strong> {data.totals.played === 1 ? "has" : "have"} played</>}
            </p>
            <div className="stats2__invites-scroll">
              <table className="stats2__invites-table">
                <caption className="sr-only">Top inviters, ranked by invited players who have played</caption>
                <thead>
                  <tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" className="num">Played</th><th scope="col" className="num">Joined</th></tr>
                </thead>
                <tbody>
                  {data.top.map((t, i) => (
                    <tr key={t.address}>
                      <td className="rank">{i + 1}</td>
                      <td className="who"><Link href={`/profile/${t.address}`}>{t.username ?? short(t.address)}</Link></td>
                      <td className="num">{t.played === null ? "—" : fmt.format(t.played)}</td>
                      <td className="num">{fmt.format(t.joined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="stats2__invites-note">
          <strong>Joined</strong>: signed in for the first time through the player&apos;s invite link. <strong>Played</strong>: of those,
          started a game on chain. Ranked by Played. Updates every minute.
        </p>
      </div>
    </section>
  );
}
