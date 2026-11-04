import { pct } from "../../lib/stats/statsView";

/** Presentational pieces of /stats (Figma frame 5). The page passes values from /api/stats. */

const fmt = new Intl.NumberFormat("en-US");

export function StatTile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "green" }) {
  return (
    <div className="stats2__tile card">
      <p className="kicker">{label}</p>
      <p className={`stats2__tile-value stats2__tile-value--${tone}`}>{value}</p>
      {sub && <p className="stats2__tile-sub">{sub}</p>}
    </div>
  );
}

export function CatchingUpNotice() {
  return (
    <p className="stats2__notice" role="status">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
      </svg>
      Chain indexing is still catching up. These values are a saved snapshot and may not yet reflect all on-chain activity.
    </p>
  );
}

/** Overlapping stages, each a share of all player wallets (not a strict funnel). */
export function Funnel({ stages }: { stages: ReadonlyArray<{ label: string; count: number; share: number }> }) {
  return (
    <ul className="stats2__funnel">
      {stages.map((s) => (
        <li key={s.label}>
          <div className="stats2__funnel-row">
            <span>{s.label}</span>
            <strong>{fmt.format(s.count)} · {pct(s.share)}</strong>
          </div>
          <span className="stats2__funnel-track" aria-hidden="true">
            <span className="stats2__funnel-fill" style={{ width: `${Math.min(100, Math.max(s.share * 100, s.count > 0 ? 1 : 0))}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CloserLook({ rows }: { rows: ReadonlyArray<[string, number]> }) {
  return (
    <section className="card stats2__closer" aria-labelledby="stats-closer">
      <h2 id="stats-closer" className="card__title">A closer look at participation</h2>
      <dl className="stats2__closer-grid">
        {rows.map(([k, v]) => (
          <div key={k} className="stats2__closer-row"><dt>{k}</dt><dd>{fmt.format(v)}</dd></div>
        ))}
      </dl>
    </section>
  );
}
