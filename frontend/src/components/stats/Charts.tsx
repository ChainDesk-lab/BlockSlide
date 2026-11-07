"use client";

/**
 * Dependency-free SVG chart primitives for the stats page.
 *
 * Deliberately no charting library: this is a mobile-first MiniPay game and the
 * bundle budget matters more than the handful of features a library would add.
 *
 * Every chart here is SINGLE-AXIS by construction. Two measures of different
 * scale (new wallets vs cumulative, events vs intensity) are shown as separate
 * charts on a shared x, never as a dual-axis overlay.
 */
import { useId, useState } from "react";
import { tickIndices } from "../../lib/stats/statsView";

/**
 * The SVG is drawn in a fixed W × H space and stretched to the plot box (preserveAspectRatio
 * "none"), so it holds shapes only. Every piece of text, and the line chart's marker, is HTML
 * placed over it by percentage, which keeps it at its real size and shape at any chart width.
 * The y-axis labels sit in a fixed-width column (--axis-w) beside the plot, not inside it.
 */
const PAD = { top: 16, bottom: 4 };
const W = 720;
const H = 240;

/** Horizontal position inside the plot box (which starts after the y-axis column). */
const xPos = (x: number) => `calc(var(--axis-w) + (100% - var(--axis-w)) * ${(x / W).toFixed(4)})`;
const yPos = (y: number) => `${((y / H) * 100).toFixed(2)}%`;

const fmt = new Intl.NumberFormat("en-US");
/** Axis label: 2500 -> "2.5k", 2000 -> "2k" (no trailing ".0"). */
export const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : fmt.format(n));

/** A round gridline step (1, 2, 2.5 or 5 × 10^n) giving about four intervals up to `v`. */
export function niceStep(v: number): number {
  if (v <= 0) return 1;
  const raw = v / 4, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  return Math.max(1, step); // counts are whole numbers: never a fractional gridline
}
/** The axis top: the data maximum rounded up to a whole number of round steps. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const step = niceStep(v);
  return Math.ceil(v / step) * step;
}

function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: string } | null>(null);
  return { tip, setTip };
}

function Tooltip({ tip }: { tip: { x: number; y: number; label: string; value: string } | null }) {
  if (!tip) return null;
  // Near either end of the plot the tip opens inwards, so it stays inside the card.
  const edge = tip.x < W * 0.2 ? " stats-chart__tip--start" : tip.x > W * 0.8 ? " stats-chart__tip--end" : "";
  return (
    <div className={`stats-chart__tip${edge}`} style={{ left: xPos(tip.x), top: yPos(tip.y) }} role="status">
      <span className="stats-chart__tip-label">{tip.label}</span>
      <span className="stats-chart__tip-value">{tip.value}</span>
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stats-chart__table">
      <button type="button" className="stats-chart__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide data table" : "Show data table"}
      </button>
      {open && (
        <div className="stats-chart__table-scroll">
          <table>
            <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{typeof c === "number" ? fmt.format(c) : c}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function gridValues(max: number) {
  const step = niceStep(max);
  return Array.from({ length: Math.round(max / step) + 1 }, (_, i) => {
    const v = step * i;
    return { v, y: PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom) };
  });
}

function Grid({ max }: { max: number }) {
  return (
    <g aria-hidden="true">
      {gridValues(max).map(({ v, y }) => (
        <line key={v} x1={0} x2={W} y1={y} y2={y} className="stats-chart__grid" vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  );
}

function YAxis({ max }: { max: number }) {
  return (
    <div className="stats-chart__yaxis" aria-hidden="true">
      {gridValues(max).map(({ v, y }) => <span key={v} style={{ top: yPos(y) }}>{short(v)}</span>)}
    </div>
  );
}

/** Title, optional subtitle (e.g. "Weekly · 8 Jun – 2 Nov 2026") and optional note. */
function Head({ title, subtitle, note }: { title: string; subtitle?: string; note?: string }) {
  return (
    <figcaption className="stats-chart__head">
      <h3 className="stats-chart__title">{title}</h3>
      {subtitle && <p className="stats-chart__subtitle">{subtitle}</p>}
      {note && <p className="stats-chart__note">{note}</p>}
    </figcaption>
  );
}

/** "ends": first and last label (default). "spread": up to five evenly spaced. "all": every label (categories). */
export type XLabels = "ends" | "spread" | "all";

function XAxis({ data, mode, centred }: { data: Series[]; mode: XLabels; centred: boolean }) {
  if (mode === "ends") {
    return <div className="stats-chart__xaxis"><span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span></div>;
  }
  // Categories: one equal cell per bar, so each label is centred under its own bar and wraps
  // inside its cell instead of running into the next one.
  if (mode === "all" && centred) {
    return (
      <div className="stats-chart__xaxis stats-chart__xaxis--cats" aria-hidden="true">
        {data.map((d) => <span key={d.label}>{d.label}</span>)}
      </div>
    );
  }
  const idx = mode === "all" ? data.map((_, i) => i) : tickIndices(data.length);
  const n = data.length;
  const at = (i: number) => (centred ? (i + 0.5) / n : n === 1 ? 0.5 : i / (n - 1)) * 100;
  // In a full five-tick row the 2nd and 4th are minor: a narrow chart hides them (stats.css).
  const minor = (k: number) => idx.length === 5 && k % 2 === 1;
  return (
    <div className="stats-chart__xaxis stats-chart__xaxis--ticks" aria-hidden="true">
      {idx.map((i, k) => <span key={i} className={minor(k) ? "is-minor" : undefined} style={{ left: `${at(i)}%` }}>{data[i].label}</span>)}
    </div>
  );
}

function Empty({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <figure className="stats-chart stats-chart--empty">
      <Head title={title} subtitle={subtitle} />
      <p className="stats-chart__empty">No data recorded for this period yet.</p>
    </figure>
  );
}

export interface Series { label: string; value: number }

/** Vertical bars. Rounded data-ends, 2px surface gap, hover tooltip. */
export function BarChart({
  data, title, subtitle, note, valueLabel, highlightLast, series = 1, xLabels = "ends", showValues = false, periodLabel = "Period",
}: {
  data: Series[]; title: string; subtitle?: string; note?: string; valueLabel: string; highlightLast?: boolean; series?: 1 | 2;
  xLabels?: XLabels; showValues?: boolean; periodLabel?: string;
}) {
  const { tip, setTip } = useTooltip();
  const id = useId();
  if (!data.length) return <Empty title={title} subtitle={subtitle} />;
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const plotH = H - PAD.top - PAD.bottom;
  const step = W / data.length;
  const barW = Math.max(2, step - 2); // 2px surface gap between bars

  return (
    <figure className="stats-chart">
      <Head title={title} subtitle={subtitle} note={note} />
      <div className="stats-chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} preserveAspectRatio="none">
          <title id={id}>{title}</title>
          <Grid max={max} />
          {data.map((d, i) => {
            const h = (d.value / max) * plotH;
            const x = i * step + 1;
            const y = PAD.top + plotH - h;
            const isLast = highlightLast && i === data.length - 1;
            return (
              <g key={d.label}>
                <rect
                  x={x} y={y} width={barW} height={Math.max(h, d.value > 0 ? 1.5 : 0)}
                  rx={Math.min(4, barW / 2)}
                  className={`stats-chart__bar${isLast ? " stats-chart__bar--alt" : ""}${series === 2 ? " stats-chart__bar--s2" : ""}`}
                />
                <rect
                  x={x} y={PAD.top} width={barW} height={plotH} fill="transparent"
                  onMouseEnter={() => setTip({ x: x + barW / 2, y, label: d.label, value: `${fmt.format(d.value)} ${valueLabel}` })}
                  onMouseLeave={() => setTip(null)}
                />
              </g>
            );
          })}
          <line x1={0} x2={W} y1={PAD.top + plotH} y2={PAD.top + plotH} className="stats-chart__baseline" vectorEffect="non-scaling-stroke" />
        </svg>
        <YAxis max={max} />
        {showValues && data.map((d, i) => (
          <span key={d.label} className="stats-chart__value" aria-hidden="true"
            style={{ left: xPos(i * step + 1 + barW / 2), top: yPos(PAD.top + plotH - (d.value / max) * plotH) }}>
            {fmt.format(d.value)}
          </span>
        ))}
        <Tooltip tip={tip} />
      </div>
      <XAxis data={data} mode={xLabels} centred />
      <DataTable head={[periodLabel, valueLabel]} rows={data.map((d) => [d.label, d.value])} />
    </figure>
  );
}

/** Single line with a crosshair. Used for cumulative totals. */
export function LineChart({
  data, title, subtitle, note, valueLabel, xLabels = "ends",
}: { data: Series[]; title: string; subtitle?: string; note?: string; valueLabel: string; xLabels?: XLabels }) {
  const { tip, setTip } = useTooltip();
  const id = useId();
  if (!data.length) return <Empty title={title} subtitle={subtitle} />;
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const plotW = W;
  const plotH = H - PAD.top - PAD.bottom;
  const xOf = (i: number) => (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yOf = (v: number) => PAD.top + (1 - v / max) * plotH;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${xOf(data.length - 1).toFixed(1)},${PAD.top + plotH} L${xOf(0).toFixed(1)},${PAD.top + plotH} Z`;
  const hovered = tip ? data.findIndex((d) => d.label === tip.label) : -1;

  return (
    <figure className="stats-chart">
      <Head title={title} subtitle={subtitle} note={note} />
      <div className="stats-chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} preserveAspectRatio="none">
          <title id={id}>{title}</title>
          <Grid max={max} />
          <path d={area} className="stats-chart__area" />
          <path d={path} className="stats-chart__line" vectorEffect="non-scaling-stroke" />
          {hovered >= 0 && (
            <line x1={xOf(hovered)} x2={xOf(hovered)} y1={PAD.top} y2={PAD.top + plotH} className="stats-chart__crosshair" vectorEffect="non-scaling-stroke" aria-hidden="true" />
          )}
          {data.map((d, i) => (
            <rect
              key={d.label}
              x={xOf(i) - plotW / (2 * Math.max(data.length - 1, 1))} y={PAD.top}
              width={plotW / Math.max(data.length - 1, 1)} height={plotH} fill="transparent"
              onMouseEnter={() => setTip({ x: xOf(i), y: yOf(d.value), label: d.label, value: `${fmt.format(d.value)} ${valueLabel}` })}
              onMouseLeave={() => setTip(null)}
            />
          ))}
          <line x1={0} x2={W} y1={PAD.top + plotH} y2={PAD.top + plotH} className="stats-chart__baseline" vectorEffect="non-scaling-stroke" />
        </svg>
        <YAxis max={max} />
        {hovered >= 0 && (
          <span className="stats-chart__marker" aria-hidden="true" style={{ left: xPos(xOf(hovered)), top: yPos(yOf(data[hovered].value)) }} />
        )}
        <Tooltip tip={tip} />
      </div>
      <XAxis data={data} mode={xLabels} centred={false} />
      <DataTable head={["Period", valueLabel]} rows={data.map((d) => [d.label, d.value])} />
    </figure>
  );
}

/**
 * Horizontal bars with a direct label on every bar. Used for the funnel and the
 * games distribution, where the category name needs room to be readable and the
 * count matters more than fine comparison.
 */
export function HBarChart({
  data, title, note, valueLabel, showShare,
}: { data: Array<Series & { share?: number }>; title: string; note?: string; valueLabel: string; showShare?: boolean }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <figure className="stats-chart">
      <figcaption className="stats-chart__head">
        <h3 className="stats-chart__title">{title}</h3>
        {note && <p className="stats-chart__note">{note}</p>}
      </figcaption>
      <ul className="stats-hbar">
        {data.map((d) => (
          <li key={d.label} className="stats-hbar__row">
            <span className="stats-hbar__label">{d.label}</span>
            <span className="stats-hbar__track">
              <span className="stats-hbar__fill" style={{ width: `${Math.max((d.value / max) * 100, d.value > 0 ? 1.5 : 0)}%` }} />
            </span>
            <span className="stats-hbar__value">
              {fmt.format(d.value)}
              {showShare && d.share !== undefined && <em>{(d.share * 100).toFixed(0)}%</em>}
            </span>
          </li>
        ))}
      </ul>
      <DataTable
        head={showShare ? ["Stage", valueLabel, "Share"] : ["Bucket", valueLabel]}
        rows={data.map((d) => (showShare ? [d.label, d.value, `${((d.share ?? 0) * 100).toFixed(1)}%`] : [d.label, d.value]))}
      />
    </figure>
  );
}
