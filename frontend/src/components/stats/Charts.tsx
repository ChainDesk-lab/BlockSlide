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

const PAD = { top: 14, right: 12, bottom: 26, left: 44 };
const W = 720;
const H = 240;

const fmt = new Intl.NumberFormat("en-US");
const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : fmt.format(n));

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: string } | null>(null);
  return { tip, setTip };
}

function Tooltip({ tip }: { tip: { x: number; y: number; label: string; value: string } | null }) {
  if (!tip) return null;
  return (
    <div
      className="stats-chart__tip"
      style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}
      role="status"
    >
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

function Grid({ max, ticks = 4 }: { max: number; ticks?: number }) {
  const lines = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i);
  return (
    <g aria-hidden="true">
      {lines.map((v) => {
        const y = PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
        return (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} className="stats-chart__grid" />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="stats-chart__axis">{short(v)}</text>
          </g>
        );
      })}
    </g>
  );
}

export interface Series { label: string; value: number }

/** Vertical bars. Rounded data-ends, 2px surface gap, hover tooltip. */
export function BarChart({
  data, title, note, valueLabel, highlightLast, series = 1,
}: { data: Series[]; title: string; note?: string; valueLabel: string; highlightLast?: boolean; series?: 1 | 2 }) {
  const { tip, setTip } = useTooltip();
  const id = useId();
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = plotW / data.length;
  const barW = Math.max(2, step - 2); // 2px surface gap between bars

  return (
    <figure className="stats-chart">
      <figcaption className="stats-chart__head">
        <h3 className="stats-chart__title">{title}</h3>
        {note && <p className="stats-chart__note">{note}</p>}
      </figcaption>
      <div className="stats-chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} preserveAspectRatio="none">
          <title id={id}>{title}</title>
          <Grid max={max} />
          {data.map((d, i) => {
            const h = (d.value / max) * plotH;
            const x = PAD.left + i * step + 1;
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
          <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} className="stats-chart__baseline" />
        </svg>
        <Tooltip tip={tip} />
      </div>
      <div className="stats-chart__xaxis">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
      <DataTable head={["Period", valueLabel]} rows={data.map((d) => [d.label, d.value])} />
    </figure>
  );
}

/** Single line with a crosshair. Used for cumulative totals. */
export function LineChart({
  data, title, note, valueLabel,
}: { data: Series[]; title: string; note?: string; valueLabel: string }) {
  const { tip, setTip } = useTooltip();
  const id = useId();
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xOf = (i: number) => PAD.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yOf = (v: number) => PAD.top + (1 - v / max) * plotH;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${xOf(data.length - 1).toFixed(1)},${PAD.top + plotH} L${xOf(0).toFixed(1)},${PAD.top + plotH} Z`;
  const hovered = tip ? data.findIndex((d) => d.label === tip.label) : -1;

  return (
    <figure className="stats-chart">
      <figcaption className="stats-chart__head">
        <h3 className="stats-chart__title">{title}</h3>
        {note && <p className="stats-chart__note">{note}</p>}
      </figcaption>
      <div className="stats-chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} preserveAspectRatio="none">
          <title id={id}>{title}</title>
          <Grid max={max} />
          <path d={area} className="stats-chart__area" />
          <path d={path} className="stats-chart__line" />
          {hovered >= 0 && (
            <g aria-hidden="true">
              <line x1={xOf(hovered)} x2={xOf(hovered)} y1={PAD.top} y2={PAD.top + plotH} className="stats-chart__crosshair" />
              <circle cx={xOf(hovered)} cy={yOf(data[hovered].value)} r={5} className="stats-chart__marker" />
            </g>
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
          <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} className="stats-chart__baseline" />
        </svg>
        <Tooltip tip={tip} />
      </div>
      <div className="stats-chart__xaxis">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
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
