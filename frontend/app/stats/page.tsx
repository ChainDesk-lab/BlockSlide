"use client";

/**
 * Public, self-updating stats page — the in-app answer to "what is happening on
 * BlockSlide". Every figure comes from Celo mainnet event logs for the game
 * contract, aggregated server-side and refreshed incrementally, so nobody has
 * to run a script to get current numbers.
 *
 * Deliberately NOT sourced from the leaderboard subgraph: the deployed subgraph
 * reports 613 players against 676 on chain (25 Sep 2026), because the live build
 * predates the handleSessionStarted mapping added on 17 Sep. Chain logs are the
 * defensible source and stay correct whether or not the subgraph is redeployed.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart, LineChart, HBarChart } from "../../src/components/stats/Charts";
import "../../src/styles/stats.css";

const fmt = new Intl.NumberFormat("en-US");

interface Snapshot {
  updatedAt: string;
  checkpointBlock: number;
  firstBlockTime: string;
  spanDays: number;
  playerWallets: number;
  totals: { logs: number; sessionsStarted: number; gamesCompleted: number; usernamesSet: number; rewardsPaid: number };
  funnel: Array<{ label: string; count: number; share: number }>;
  weekly: Array<{ week: string; newWallets: number; activeWallets: number; events: number; cumulative: number; perWallet: number }>;
  recent: { events24h: number; events7d: number; events30d: number; active7d: number; active30d: number; new7d: number; new30d: number };
  retention: { oneEventOnly: number; multiWeek: number; span7d: number; span30d: number };
  engagement: Array<{ bucket: string; wallets: number }>;
  medianGames: number;
  totalGames: number;
  gDollarPaid: number;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stats-tile">
      <span className="stats-tile__label">{label}</span>
      <strong className="stats-tile__value">{value}</strong>
      {sub && <span className="stats-tile__sub">{sub}</span>}
    </div>
  );
}

const shortWeek = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default function StatsPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) { setError(json.message ?? json.error ?? "Could not load stats"); return; }
        setData(json);
        setError(null);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };
    load();
    // Refresh while the tab stays open; the API only re-scans when stale.
    const timer = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (error) {
    return (
      <div className="stats">
        <header className="stats__header">
          <h1 className="stats__title">BlockSlide Stats</h1>
        </header>
        <p className="stats__error">{error}</p>
        <Link href="/" className="stats__back">Back to the game</Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="stats">
        <header className="stats__header"><h1 className="stats__title">BlockSlide Stats</h1></header>
        <p className="stats__loading">Reading the chain…</p>
      </div>
    );
  }

  const weekly = data.weekly;
  const played = data.engagement.reduce((s, b) => s + b.wallets, 0);
  const updated = new Date(data.updatedAt);

  return (
    <div className="stats">
      <header className="stats__header">
        <h1 className="stats__title">BlockSlide Stats</h1>
        <p className="stats__subtitle">
          Live from Celo mainnet — every number below is read from the game contract&apos;s own event
          logs, not from an analytics service.
        </p>
        <p className="stats__meta">
          Updated {updated.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · block{" "}
          {fmt.format(data.checkpointBlock)} · {data.spanDays} days since launch
        </p>
      </header>

      <section className="stats__section" aria-label="Headline numbers">
        <div className="stats__tiles">
          <Stat label="Player wallets" value={fmt.format(data.playerWallets)} sub="all time" />
          <Stat label="Games completed" value={fmt.format(data.totalGames)} sub={`by ${fmt.format(played)} players`} />
          <Stat label="Sessions started" value={fmt.format(data.totals.sessionsStarted)} />
          <Stat label="G$ paid to players" value={fmt.format(data.gDollarPaid)} sub={`${data.totals.rewardsPaid} payouts`} />
        </div>
      </section>

      <section className="stats__section" aria-label="Recent activity">
        <h2 className="stats__h2">Right now</h2>
        <div className="stats__tiles">
          <Stat label="Events, last 24h" value={fmt.format(data.recent.events24h)} />
          <Stat label="Events, last 7d" value={fmt.format(data.recent.events7d)} />
          <Stat label="Wallets active, 7d" value={fmt.format(data.recent.active7d)} />
          <Stat label="New wallets, 7d" value={fmt.format(data.recent.new7d)} />
        </div>
      </section>

      <section className="stats__section" aria-label="Growth">
        <h2 className="stats__h2">Growth</h2>
        <div className="stats__grid">
          <LineChart
            title="Total player wallets"
            note="Cumulative distinct wallets that have interacted with the contract."
            valueLabel="wallets"
            data={weekly.map((w) => ({ label: shortWeek(w.week), value: w.cumulative }))}
          />
          <BarChart
            title="New wallets per week"
            note="First-ever contract interaction, by ISO week. The final bar is the current week and is still filling."
            valueLabel="wallets"
            highlightLast
            data={weekly.map((w) => ({ label: shortWeek(w.week), value: w.newWallets }))}
          />
        </div>
      </section>

      <section className="stats__section" aria-label="Activity">
        <h2 className="stats__h2">Activity</h2>
        <div className="stats__grid">
          <BarChart
            title="Contract events per week"
            note="Every log the game contract emitted. The final bar is the current week."
            valueLabel="events"
            highlightLast
            data={weekly.map((w) => ({ label: shortWeek(w.week), value: w.events }))}
          />
          <BarChart
            title="Wallets active per week"
            note="Distinct wallets that did something on chain that week."
            valueLabel="wallets"
            highlightLast
            series={2}
            data={weekly.map((w) => ({ label: shortWeek(w.week), value: w.activeWallets }))}
          />
        </div>
      </section>

      <section className="stats__section" aria-label="Conversion and depth">
        <h2 className="stats__h2">Who gets how far</h2>
        <div className="stats__grid">
          <HBarChart
            title="From first touch to reward"
            note="Overlapping stages, not a strict funnel — some wallets play without ever setting a username."
            valueLabel="wallets"
            showShare
            data={data.funnel.map((f) => ({ label: f.label, value: f.count, share: f.share }))}
          />
          <HBarChart
            title="Players by games completed"
            note={`Only the ${fmt.format(played)} wallets that finished at least one game. Median is ${data.medianGames}.`}
            valueLabel="players"
            data={data.engagement.map((e) => ({ label: e.bucket, value: e.wallets }))}
          />
        </div>
        <p className="stats__aside">
          Of {fmt.format(data.playerWallets)} wallets, {fmt.format(data.retention.oneEventOnly)} did exactly one
          thing on chain and {fmt.format(data.retention.multiWeek)} came back in a second week.{" "}
          {fmt.format(data.retention.span30d)} have been active across more than 30 days.
        </p>
      </section>

      <footer className="stats__footer">
        <p>
          Contract <code>0xD551…ceB6</code> on Celo. Counts are distinct wallet addresses, which is not
          the same as distinct people — one person can hold several wallets. Verified player identity is
          gated separately by GoodDollar face verification.
        </p>
        <Link href="/" className="stats__back">Back to the game</Link>
      </footer>
    </div>
  );
}
