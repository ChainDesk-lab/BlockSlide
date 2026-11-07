"use client";

/**
 * Public analytics dashboard.
 *
 * Three independent sources, each with its own loading, empty and error state,
 * so one failing never blanks the page:
 *   - /api/stats: the chain-log aggregate (wallets, sessions, games, rewards,
 *     per-day activity, recent events, shop purchases). Refreshed from Celo at
 *     most every few minutes; the page shows the block it reflects.
 *   - /api/analytics/top-scores: the contract's own top-10 score table.
 *   - /api/leaderboard: the XP leaderboard (subgraph), with its freshness flag.
 *
 * Nothing here is estimated. A metric the data can't establish is shown as
 * unavailable with the reason, never as a zero.
 */
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BarChart, LineChart } from "../../src/components/stats/Charts";
import { blockToUnix } from "../../src/lib/stats/config";
import type { StatsSnapshot } from "../../src/lib/stats/state";
import type { TopScore } from "../../src/lib/stats/topScores";
import {
  RANGES, type Range, describeEvent, fillDays, rangeStart, shortAddress, shortDay, sum, timeAgo,
} from "../../src/lib/stats/analyticsView";
import "../../src/styles/stats.css";
import "../../src/styles/analytics.css";

const CELOSCAN = "https://celoscan.io";
const fmt = new Intl.NumberFormat("en-US");

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

interface TopScoresResponse { entries: TopScore[]; readAt: string; stale: boolean; contract: string }
interface XpEntry { id: string; xp: string; username: string | null; isVerified: boolean | null }
interface XpResponse { entries: XpEntry[]; totalPlayers: number; stale: boolean; servedFrom: string | null; builtAt: number | null }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? json.error ?? `Request failed (${res.status})`);
  return json as T;
}

function useSource<T>(url: string, refreshMs?: number): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    const load = () =>
      getJson<T>(url)
        .then((data) => alive && setState({ status: "ready", data }))
        .catch((err: Error) =>
          // Keep showing data we already have if a background refresh fails.
          alive && setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: err.message })));
    load();
    const timer = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [url, refreshMs]);
  return state;
}

// ── Small building blocks ─────────────────────────────────────────────────────

function Metric({ label, value, sub, title }: { label: string; value: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div className="an-metric" title={title}>
      <span className="an-metric__label">{label}</span>
      <strong className="an-metric__value">{value}</strong>
      {sub && <span className="an-metric__sub">{sub}</span>}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`an-skeleton ${className}`} aria-hidden="true" />;
}

function MetricSkeletons({ n }: { n: number }) {
  return (
    <div className="an-metrics" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div className="an-metric" key={i}><Skeleton className="an-skeleton--label" /><Skeleton className="an-skeleton--value" /></div>
      ))}
    </div>
  );
}

function Panel({ title, source, children, action }: { title: string; source?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="an-panel">
      <header className="an-panel__head">
        <div>
          <h2 className="an-panel__title">{title}</h2>
          {source && <p className="an-panel__source">{source}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="an-error" role="status">{children}</p>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="an-empty">{children}</p>;
}

const addrLink = (a: string, label?: string) => (
  <a href={`${CELOSCAN}/address/${a}`} target="_blank" rel="noopener noreferrer" className="an-mono">{label ?? shortAddress(a)}</a>
);

/** Username (linked) with the address beside it; on narrow screens only the name shows. */
const playerCell = (address: string, username: string | null) =>
  username ? (
    <>
      <a href={`${CELOSCAN}/address/${address}`} target="_blank" rel="noopener noreferrer" className="an-name">{username}</a>
      <span className="an-addr-secondary">{addrLink(address)}</span>
    </>
  ) : addrLink(address);

function RangeTabs({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="an-tabs" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <button key={r.id} type="button" className={`an-tab ${value === r.id ? "an-tab--on" : ""}`}
          aria-pressed={value === r.id} onClick={() => onChange(r.id)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const stats = useSource<StatsSnapshot>("/api/stats", 120_000);
  const top = useSource<TopScoresResponse>("/api/analytics/top-scores", 120_000);
  const xp = useSource<XpResponse>("/api/leaderboard?page=0");
  const [range, setRange] = useState<Range>("30d");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const s = stats.status === "ready" ? stats.data : null;
  const best = top.status === "ready" ? top.data.entries[0] : undefined;

  return (
    <div className="stats an">
      <header className="an-header">
        <div>
          <p className="an-eyebrow">Celo mainnet · game contract</p>
          <h1 className="an-title">BlockSlide Analytics</h1>
          <p className="an-subtitle">
            Every figure on this page is derived from the BlockSlide contract on Celo mainnet. Players, blocks and transactions link to Celoscan so they can be checked.
          </p>
        </div>
        <div className="an-header__meta">
          {s ? (
            <>
              <span>Updated {new Date(s.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              <span>
                Through block{" "}
                <a href={`${CELOSCAN}/block/${s.checkpointBlock}`} target="_blank" rel="noopener noreferrer">{fmt.format(s.checkpointBlock)}</a>
              </span>
              <span className="an-muted">Refreshed from the chain at most every 5 minutes</span>
            </>
          ) : stats.status === "loading" ? <Skeleton className="an-skeleton--meta" /> : null}
          <a href={`${CELOSCAN}/address/0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6`} target="_blank" rel="noopener noreferrer">
            View contract on Celoscan ↗
          </a>
        </div>
      </header>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      <Panel title="All time" source="Distinct wallet addresses and contract events since launch">
        {stats.status === "loading" && <MetricSkeletons n={8} />}
        {stats.status === "error" && <ErrorNote>Chain totals are unavailable right now: {stats.message}</ErrorNote>}
        {s && (
          <div className="an-metrics">
            <Metric label="Player wallets" value={fmt.format(s.playerWallets)} sub={`over ${Math.round(s.spanDays)} days`} />
            <Metric label="Games completed" value={fmt.format(s.totals.gamesCompleted)} sub="scores submitted on chain" />
            <Metric label="Sessions started" value={fmt.format(s.totals.sessionsStarted)} sub="includes games not finished" />
            <Metric
              label="Highest score"
              value={top.status === "loading" ? <Skeleton className="an-skeleton--value" /> : best ? fmt.format(best.score) : "—"}
              sub={best ? <>{best.highestTile} tile · {best.username ?? shortAddress(best.player)}</> : top.status === "error" ? "score table unavailable" : undefined}
            />
            <Metric label="Milestone G$ paid" value={fmt.format(s.gDollarPaid)} sub={`${fmt.format(s.totals.rewardsPaid)} payouts by the game contract`} />
            <Metric label="Active wallets, 7d" value={fmt.format(s.recent.active7d)} sub={`${fmt.format(s.recent.active30d)} in 30 days`} />
            <Metric label="New wallets, 7d" value={fmt.format(s.recent.new7d)} sub={`${fmt.format(s.recent.new30d)} in 30 days`} />
            <Metric label="Usernames set" value={fmt.format(s.totals.usernamesSet)} sub="on-chain names" />
          </div>
        )}
      </Panel>

      {/* ── Activity over time ──────────────────────────────────────────── */}
      <Panel title="Activity" source="By UTC day" action={<RangeTabs value={range} onChange={setRange} />}>
        {stats.status === "loading" && <div className="an-grid"><Skeleton className="an-skeleton--chart" /><Skeleton className="an-skeleton--chart" /></div>}
        {stats.status === "error" && <ErrorNote>Activity history is unavailable right now.</ErrorNote>}
        {s && <ActivityCharts s={s} range={range} />}
      </Panel>

      <Panel title="Growth" source="All time, by ISO week (Monday start). The last week is still in progress.">
        {s ? (
          <div className="an-grid">
            <LineChart title="Total player wallets" valueLabel="wallets"
              note="Cumulative distinct wallets that have used the contract."
              data={s.weekly.map((w) => ({ label: shortDay(w.week), value: w.cumulative }))} />
            <BarChart title="Wallets active per week" valueLabel="wallets" highlightLast series={2}
              note="Distinct wallets with at least one player event that week: a game, reward, purchase or profile change."
              data={s.weekly.map((w) => ({ label: shortDay(w.week), value: w.activeWallets }))} />
          </div>
        ) : stats.status === "loading" ? <div className="an-grid"><Skeleton className="an-skeleton--chart" /><Skeleton className="an-skeleton--chart" /></div>
          : <ErrorNote>Growth history is unavailable right now.</ErrorNote>}
      </Panel>

      {/* ── Players ─────────────────────────────────────────────────────── */}
      <div className="an-grid an-grid--tables">
        <Panel title="Top scores" source="The contract's own top-10 table (getLeaderboard)">
          <TopScoresTable top={top} />
        </Panel>
        <Panel title="Top players by XP" source="XP leaderboard, indexed by the BlockSlide subgraph">
          <XpTable xp={xp} />
        </Panel>
      </div>

      {/* ── Recent activity ─────────────────────────────────────────────── */}
      <Panel title="Recent on-chain activity" source="The latest game, reward and shop events, with their transactions">
        {stats.status === "loading" && <Skeleton className="an-skeleton--table" />}
        {stats.status === "error" && <ErrorNote>Recent activity is unavailable right now.</ErrorNote>}
        {s && <RecentTable s={s} now={now} />}
      </Panel>

      {/* ── Shop ────────────────────────────────────────────────────────── */}
      <Panel title="Shop purchases" source="Count of purchase events, all time">
        {s ? (
          <>
            <div className="an-metrics an-metrics--compact">
              <Metric label="Streak shields" value={fmt.format(s.shop.shields)} />
              <Metric label="XP boosts" value={fmt.format(s.shop.boosts)} />
              <Metric label="Undo purchases" value={fmt.format(s.shop.undoCredits)} />
              <Metric label="Cosmetics" value={fmt.format(s.shop.cosmetics)} />
            </div>
            <p className="an-note">
              Counts include the team&apos;s own purchases. G$ purchase volume isn&apos;t shown: purchase events from before the
              V6 contract don&apos;t record the price paid, so a total would be incomplete.
            </p>
          </>
        ) : stats.status === "loading" ? <MetricSkeletons n={4} /> : <ErrorNote>Shop data is unavailable right now.</ErrorNote>}
      </Panel>

      <footer className="an-footer">
        <p>
          <strong>Definitions.</strong> A <em>session</em> starts when a player commits a game seed on chain; a
          <em> completed game</em> is a score submitted for that session. Counts are distinct wallet addresses, not
          people: one person can use several wallets. G$ rewards are paid only to GoodDollar-verified players.
        </p>
        <p>
          <strong>Sources.</strong> Totals, activity and recent events come from the contract&apos;s event logs on Celo
          mainnet, folded into a server-side aggregate. Top scores are read directly from the contract. XP rankings come
          from the BlockSlide subgraph and are marked if it falls behind.
        </p>
        <Link href="/" className="stats__back">Back to the game</Link>
      </footer>
    </div>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

function ActivityCharts({ s, range }: { s: StatsSnapshot; range: Range }) {
  const lastDay = new Date(blockToUnix(s.checkpointBlock) * 1000).toISOString().slice(0, 10);
  const firstDay = s.daily[0]?.day ?? lastDay;
  const from = rangeStart(range, lastDay, firstDay);
  const events = fillDays(s.daily, from, lastDay, (d) => d.events);

  const since = s.detail.sinceDay;
  const detailFrom = since && since > from ? since : from;
  const games = since ? fillDays(s.detail.days, detailFrom, lastDay, (d) => d.games) : [];
  const active = since ? fillDays(s.detail.days, detailFrom, lastDay, (d) => d.active) : [];
  const partial = since !== null && since > from;

  const windowed = range === "all"
    ? { sessions: s.totals.sessionsStarted, games: s.totals.gamesCompleted }
    : s.detail.window[range];
  const coverageNote = since ? `Tracked per day from ${shortDay(since)}` : "Per-day tracking starts with the next data refresh";

  return (
    <>
      <div className="an-metrics an-metrics--compact">
        <Metric label="Contract events" value={fmt.format(sum(events))} />
        <Metric label="Games completed" value={windowed ? fmt.format(windowed.games) : "—"}
          sub={windowed ? undefined : coverageNote} />
        <Metric label="Sessions started" value={windowed ? fmt.format(windowed.sessions) : "—"}
          sub={windowed ? undefined : coverageNote} />
      </div>
      <div className="an-grid">
        <BarChart title="Contract events per day" valueLabel="events" highlightLast
          note="Every event the game contract emitted: sessions, scores, rewards, purchases and profile changes. Today's bar is still filling."
          data={events.map((d) => ({ label: shortDay(d.day), value: d.value }))} />
        {since && games.length > 0 ? (
          <BarChart title="Games completed per day" valueLabel="games" highlightLast series={2}
            note={partial ? `${coverageNote}; earlier days in this range aren't broken down yet.` : "Scores submitted on chain. Today's bar is still filling."}
            data={games.map((d) => ({ label: shortDay(d.day), value: d.value }))} />
        ) : (
          <div className="an-chart-empty"><Empty>{coverageNote}. Until then, contract events per day cover the full history.</Empty></div>
        )}
      </div>
      {since && active.length > 0 && (
        <div className="an-grid an-grid--single">
          <BarChart title="Active wallets per day" valueLabel="wallets" highlightLast
            note={`Distinct wallets with at least one player event that day. ${partial ? coverageNote + "." : ""}`}
            data={active.map((d) => ({ label: shortDay(d.day), value: d.value }))} />
        </div>
      )}
    </>
  );
}

function TopScoresTable({ top }: { top: Load<TopScoresResponse> }) {
  if (top.status === "loading") return <Skeleton className="an-skeleton--table" />;
  if (top.status === "error") return <ErrorNote>The on-chain score table couldn&apos;t be read: {top.message}</ErrorNote>;
  const rows = top.data.entries;
  if (rows.length === 0) return <Empty>No scores have been submitted yet.</Empty>;
  return (
    <>
      {top.data.stale && <p className="an-badge an-badge--warn">Showing the last table read; the latest read failed.</p>}
      <div className="an-table-wrap">
        <table className="an-table">
          <caption className="an-sr">Top 10 scores recorded by the contract</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" className="an-num">Score</th><th scope="col" className="an-num">Best tile</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.player + r.rank}>
                <td className="an-rank">{r.rank}</td>
                <td className="an-player">{playerCell(r.player, r.username)}</td>
                <td className="an-num">{fmt.format(r.score)}</td>
                <td className="an-num">{fmt.format(r.highestTile)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function XpTable({ xp }: { xp: Load<XpResponse> }) {
  if (xp.status === "loading") return <Skeleton className="an-skeleton--table" />;
  if (xp.status === "error") return <ErrorNote>The XP leaderboard is unavailable right now: {xp.message}</ErrorNote>;
  const rows = xp.data.entries.slice(0, 10);
  if (rows.length === 0) return <Empty>No players on the XP leaderboard yet.</Empty>;
  return (
    <>
      {xp.data.stale && (
        <p className="an-badge an-badge--warn">
          {xp.data.servedFrom === "last_known_good" ? "Showing the last complete leaderboard; the indexer is unavailable." : "The indexer is behind the chain; XP may lag."}
        </p>
      )}
      <div className="an-table-wrap">
        <table className="an-table">
          <caption className="an-sr">Top 10 players by XP</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" className="an-num">XP</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="an-rank">{i + 1}</td>
                <td className="an-player">
                  {playerCell(r.id, r.username)}
                  {r.isVerified && <span className="an-verified" title="GoodDollar verified">verified</span>}
                </td>
                <td className="an-num">{fmt.format(BigInt(r.xp || "0"))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="an-note">{fmt.format(xp.data.totalPlayers)} players ranked. Verified players are listed first, as on the in-game leaderboard.</p>
    </>
  );
}

function RecentTable({ s, now }: { s: StatsSnapshot; now: number }) {
  const rows = s.recentEvents;
  if (!s.detail.sinceDay) return <Empty>Recent-activity tracking starts with the next data refresh.</Empty>;
  if (rows.length === 0) return <Empty>No game, reward or shop events since tracking began on {shortDay(s.detail.sinceDay)}.</Empty>;
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <caption className="an-sr">Most recent on-chain events</caption>
        <thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">Player</th><th scope="col" className="an-col-detail">Details</th><th scope="col">Transaction</th></tr></thead>
        <tbody>
          {rows.map((ev, i) => {
            const { label, detail } = describeEvent(ev);
            const unix = blockToUnix(ev.block);
            return (
              <tr key={`${ev.block}-${i}`}>
                <td title={new Date(unix * 1000).toISOString()}>{timeAgo(unix, now)}</td>
                <td>
                  <span className={`an-event an-event--${ev.type}`}>{label}</span>
                  {detail && <span className="an-inline-detail">{detail}</span>}
                </td>
                <td>{addrLink(ev.player)}</td>
                <td className="an-col-detail">{detail || <span className="an-muted">—</span>}</td>
                <td>
                  {ev.tx
                    ? <a href={`${CELOSCAN}/tx/${ev.tx}`} target="_blank" rel="noopener noreferrer" className="an-mono">{shortAddress(ev.tx)} ↗</a>
                    : <a href={`${CELOSCAN}/block/${ev.block}`} target="_blank" rel="noopener noreferrer" className="an-mono">block {fmt.format(ev.block)} ↗</a>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
