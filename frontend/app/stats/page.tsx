"use client";

/**
 * Public stats (Figma frame 5). Every figure comes from Celo mainnet event logs for the game
 * contract, aggregated server-side (/api/stats, Redis) and refreshed incrementally.
 *
 * Deliberately NOT sourced from the leaderboard subgraph: the deployed subgraph undercounts
 * players (its build predates handleSessionStarted). Chain logs stay correct either way.
 *
 * Integrity rules for this page: XP is never shown as G$; wallets are never called people;
 * event counts are stated by whole UTC days because that is what the aggregate stores; and a
 * snapshot that couldn't reach the chain head says so.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart, LineChart } from "../../src/components/stats/Charts";
import { CatchingUpNotice, CloserLook, Funnel, StatTile } from "../../src/components/stats/StatsPanels";
import { catchingUp, shortWeek, utcDayEvents, weekRangeLabel } from "../../src/lib/stats/statsView";
import "../../src/styles/stats.css";

const fmt = new Intl.NumberFormat("en-US");
const REFRESH_MS = 120_000;
/** The route may scan up to 12 chunks (maxDuration 60 s) before answering. */
const FETCH_TIMEOUT_MS = 75_000;

/** The subset of /api/stats this page reads (older aggregates may lack the newer fields). */
interface StatsFeed {
  updatedAt: string;
  checkpointBlock: number;
  spanDays: number;
  playerWallets: number;
  totals: { sessionsStarted: number; rewardsPaid: number };
  funnel: Array<{ label: string; count: number; share: number }>;
  weekly: Array<{ week: string; newWallets: number; activeWallets: number; events: number; cumulative: number }>;
  daily: Array<{ day: string; events: number }>;
  recent: { active7d: number; new7d: number };
  retention: { oneEventOnly: number; multiWeek: number; span30d: number };
  engagement: Array<{ bucket: string; wallets: number }>;
  medianGames: number;
  totalGames: number;
  gDollarPaid: number;
  scan?: { chunks: number; caughtUp: boolean } | null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="main">
      <div className="page stats stats2">
        <header className="stats2__hero">
          <p className="kicker kicker--green">Global on-chain analytics</p>
          <h1 className="page__title">BlockSlide Stats</h1>
          <p className="page__lede page__lede--wide">
            Live from Celo mainnet. Every number below is read from the game contract&apos;s own event logs, not from an analytics service.
          </p>
        </header>
        {children}
      </div>
    </main>
  );
}

export default function StatsPage() {
  const [data, setData] = useState<StatsFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        // A stalled server must end in the unavailable state, not an endless "Reading the chain…".
        const res = await fetch("/api/stats", { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        const json = await res.json();
        if (!alive) return;
        setNow(Date.now());
        if (!res.ok) { setError(json.message ?? json.error ?? "Could not load stats"); return; }
        setData(json);
        setError(null);
      } catch (err) {
        if (alive) setError((err as Error).name === "TimeoutError" ? "the stats service didn't answer in time" : (err as Error).message);
      }
    };
    load();
    // Refresh while the tab stays open; the API only re-scans when its aggregate is stale.
    const timer = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!data) {
    return (
      <Shell>
        {error
          ? <p className="state-note state-note--error" role="alert">Stats are unavailable right now: {error.replace(/\.\s*$/, "")}. Nothing is shown rather than guessed.</p>
          : <p className="state-note" role="status">Reading the chain…</p>}
        <div className="stats2__footer"><span /><Link href="/" className="stats2__back">Back to the game</Link></div>
      </Shell>
    );
  }

  const weekly = data.weekly;
  const range = weekRangeLabel(weekly.map((w) => w.week));
  const weeklySub = range ? `Weekly · ${range}` : "Weekly";
  const played = data.engagement.reduce((s, b) => s + b.wallets, 0);
  const updated = new Date(data.updatedAt);
  const days = utcDayEvents(data.daily ?? [], data.checkpointBlock);
  const behind = catchingUp({ updatedAt: data.updatedAt, scan: data.scan, now });
  const wk = (w: { week: string }) => shortWeek(w.week);

  return (
    <Shell>
      <div className="stats2__meta">
        <p>
          Updated {updated.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · block {fmt.format(data.checkpointBlock)} ·{" "}
          {data.spanDays} days since launch
        </p>
        <p>Auto-refreshes every {REFRESH_MS / 1000} seconds{error ? " · last refresh failed, showing the previous snapshot" : ""}</p>
      </div>
      {behind && <CatchingUpNotice />}

      <section aria-label="Headline numbers" className="stats2__tiles">
        <StatTile label="Player wallets" value={fmt.format(data.playerWallets)} sub="All time" />
        <StatTile label="Games completed" value={fmt.format(data.totalGames)} sub={`By ${fmt.format(played)} wallets`} />
        <StatTile label="Sessions started" value={fmt.format(data.totals.sessionsStarted)} sub="All time" />
        <StatTile label="G$ paid to players" value={`${fmt.format(data.gDollarPaid)} G$`} sub={`${fmt.format(data.totals.rewardsPaid)} milestone payouts`} tone="green" />
        <StatTile label="Events today" value={fmt.format(days.today)} sub="Since 00:00 UTC" />
        <StatTile label="Events, last 7 days" value={fmt.format(days.last7)} sub="UTC days, today included" />
        <StatTile label="Wallets active, 7 days" value={fmt.format(data.recent.active7d)} sub="Distinct wallets, last 7 × 24 h" />
        <StatTile label="New wallets, 7 days" value={fmt.format(data.recent.new7d)} sub="First on-chain activity, last 7 × 24 h" />
      </section>

      <section aria-labelledby="stats-growth">
        <div className="stats2__section-head"><h2 id="stats-growth" className="section-title">Growth</h2><p>Player wallets over time</p></div>
        <div className="stats2__grid">
          <LineChart title="Total player wallets" subtitle={weeklySub} valueLabel="wallets" xLabels="spread"
            note="Cumulative distinct wallets that have interacted with the game contract."
            data={weekly.map((w) => ({ label: wk(w), value: w.cumulative }))} />
          <BarChart title="New wallets per week" subtitle={weeklySub} valueLabel="wallets" xLabels="spread" highlightLast
            note="A wallet's first contract interaction, by ISO week (Monday start). The last bar is the current week, still filling."
            data={weekly.map((w) => ({ label: wk(w), value: w.newWallets }))} />
        </div>
      </section>

      <section aria-labelledby="stats-activity">
        <div className="stats2__section-head"><h2 id="stats-activity" className="section-title">Activity</h2><p>Interactions with the game contract</p></div>
        <div className="stats2__grid">
          <BarChart title="Contract events per week" subtitle={weeklySub} valueLabel="events" xLabels="spread" highlightLast
            note="Every log the game contract emitted. The last bar is the current week."
            data={weekly.map((w) => ({ label: wk(w), value: w.events }))} />
          <BarChart title="Wallets active per week" subtitle={weeklySub} valueLabel="wallets" xLabels="spread" highlightLast
            note="Distinct wallets that did anything on chain that week."
            data={weekly.map((w) => ({ label: wk(w), value: w.activeWallets }))} />
        </div>
      </section>

      <section aria-labelledby="stats-depth">
        <div className="stats2__section-head"><h2 id="stats-depth" className="section-title">Who gets how far</h2><p>Participation and completed games</p></div>
        <div className="stats2__grid">
          <figure className="stats-chart">
            <figcaption className="stats-chart__head">
              <h3 className="stats-chart__title">From first touch to reward</h3>
              <p className="stats-chart__subtitle">Overlapping stages, not a strict funnel. Share of all {fmt.format(data.playerWallets)} player wallets.</p>
            </figcaption>
            <Funnel stages={data.funnel} />
          </figure>
          <BarChart title="Players by games completed" valueLabel="wallets" periodLabel="Games completed" xLabels="all" showValues series={1}
            subtitle={`${fmt.format(played)} wallets with at least one completed game · median ${fmt.format(data.medianGames)}`}
            data={data.engagement.map((e) => ({ label: e.bucket.replace("-", "–"), value: e.wallets }))} />
        </div>
      </section>

      <CloserLook rows={[
        ["Median games completed (per wallet that played)", data.medianGames],
        ["Wallets active in more than one week", data.retention.multiWeek],
        ["Wallets that did exactly one thing on chain", data.retention.oneEventOnly],
        ["Wallets active across more than 30 days", data.retention.span30d],
      ]} />

      <div className="stats2__footer">
        <p>
          Contract <code>0xD551…ceB6</code> on Celo. Counts are distinct wallet addresses, not distinct people: one person can hold
          several wallets. GoodDollar identity verification is separate from the wallet activity shown here.
        </p>
        <div className="stats2__footer-links">
          <Link href="/analytics" className="stats2__back stats2__back--secondary">Detailed analytics</Link>
          <Link href="/" className="stats2__back">Back to the game</Link>
        </div>
      </div>
    </Shell>
  );
}
