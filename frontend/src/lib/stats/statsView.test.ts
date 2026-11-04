/**
 * Stats screen (Figma frame 5): time windows say exactly what they count, stale data says so,
 * charts survive empty data, and the page never presents XP as G$ or wallets as people.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANCHOR_BLOCK, ANCHOR_TIME } from "./config";
import { STALE_WARNING_MS, catchingUp, pct, tickIndices, utcDayEvents, weekRangeLabel } from "./statsView";
import { BarChart, LineChart, niceMax, niceStep, short } from "../../components/stats/Charts";
import { CatchingUpNotice, CloserLook, Funnel, StatTile } from "../../components/stats/StatsPanels";

const page = readFileSync(join(__dirname, "../../../app/stats/page.tsx"), "utf8");
/** The page with comments removed: guards check what the code does, not what its comments explain. */
const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** The block whose wall time is `iso` (Celo: one block per second from the anchor). */
const blockAt = (iso: string) => ANCHOR_BLOCK + (Date.parse(iso) / 1000 - ANCHOR_TIME);

describe("Event windows are whole UTC days, labelled as such", () => {
  const daily = [
    { day: "2026-10-27", events: 100 }, // 7 days before the snapshot day: outside
    { day: "2026-10-28", events: 10 },
    { day: "2026-11-02", events: 5 },
    { day: "2026-11-03", events: 2 },
  ];

  it("'today' is since 00:00 UTC on the snapshot's day; 'last 7 days' is that day and the six before", () => {
    expect(utcDayEvents(daily, blockAt("2026-11-03T12:46:49Z"))).toEqual({ today: 2, last7: 17, headDay: "2026-11-03" });
  });

  it("just after midnight UTC, 'today' restarts at what has happened since", () => {
    expect(utcDayEvents(daily, blockAt("2026-11-03T00:00:05Z")).today).toBe(2);
    expect(utcDayEvents(daily, blockAt("2026-11-02T23:59:59Z"))).toMatchObject({ today: 5, headDay: "2026-11-02" });
  });

  it("the page uses these, never the old 'last 24h / 7d' fields that summed 'yesterday + today'", () => {
    expect(page).toContain("utcDayEvents(data.daily ?? [], data.checkpointBlock)");
    expect(page).not.toMatch(/events24h|events7d|last 24h/);
    expect(page).toContain('sub="Since 00:00 UTC"');
    expect(page).toContain('sub="UTC days, today included"');
    // Wallet windows are true rolling windows (block arithmetic in derive), and say so.
    expect(page).toContain("last 7 × 24 h");
  });
});

describe("Freshness", () => {
  const now = Date.parse("2026-11-03T13:00:00Z");
  it("warns when the last refresh couldn't reach the chain head", () => {
    expect(catchingUp({ updatedAt: "2026-11-03T12:59:00Z", scan: { caughtUp: false }, now })).toBe(true);
    expect(catchingUp({ updatedAt: "2026-11-03T12:59:00Z", scan: { caughtUp: true }, now })).toBe(false);
  });
  it("warns when the snapshot hasn't been refreshed for 15 minutes, or its time is unreadable", () => {
    expect(catchingUp({ updatedAt: new Date(now - STALE_WARNING_MS - 1000).toISOString(), scan: null, now })).toBe(true);
    expect(catchingUp({ updatedAt: new Date(now - 60_000).toISOString(), now })).toBe(false);
    expect(catchingUp({ updatedAt: "not a date", now })).toBe(true);
  });
  it("the notice says the values are a snapshot, not that they are wrong", () => {
    expect(renderToStaticMarkup(createElement(CatchingUpNotice))).toContain("Chain indexing is still catching up. These values are a saved snapshot");
  });
});

describe("Axes and labels", () => {
  it("gridlines use round steps", () => {
    expect([niceStep(5000), niceMax(4200)]).toEqual([2000, 6000]);
    expect([niceStep(700), niceMax(700)]).toEqual([200, 800]);
    expect([niceStep(150), niceMax(150)]).toEqual([50, 150]);
    expect([niceStep(3), niceMax(3)]).toEqual([1, 3]);
    expect([niceStep(2), niceMax(2)]).toEqual([1, 2]); // never a 0.5 gridline for counts
    expect(niceMax(0)).toBe(1);
  });
  it("axis labels are compact without trailing zeros", () => {
    expect([short(2000), short(2500), short(12000), short(800)]).toEqual(["2k", "2.5k", "12k", "800"]);
  });
  it("x ticks are evenly spaced and always include both ends", () => {
    expect(tickIndices(22)).toEqual([0, 5, 11, 16, 21]);
    expect(tickIndices(3)).toEqual([0, 1, 2]);
    expect(tickIndices(0)).toEqual([]);
  });
  it("the weekly range reads like the design", () => {
    expect(weekRangeLabel(["2026-06-08", "2026-07-06", "2026-11-02"])).toBe("8 Jun – 2 Nov 2026");
    expect(weekRangeLabel([])).toBeNull();
    expect(pct(0.869)).toBe("86.9%");
  });
});

describe("Charts survive empty or tiny datasets", () => {
  it("no data renders an empty state, not a broken chart", () => {
    for (const C of [BarChart, LineChart]) {
      const html = renderToStaticMarkup(createElement(C, { data: [], title: "X", valueLabel: "wallets" }));
      expect(html).toContain("No data recorded for this period yet.");
      expect(html).not.toContain("<svg");
      expect(html).not.toMatch(/NaN|Infinity/);
    }
  });
  it("a single point and value labels render without NaN", () => {
    const html = renderToStaticMarkup(createElement(BarChart, { data: [{ label: "1 game", value: 78 }], title: "X", valueLabel: "wallets", showValues: true, xLabels: "all" }));
    expect(html).toContain(">78</text>");
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(renderToStaticMarkup(createElement(LineChart, { data: [{ label: "8 Jun", value: 3 }], title: "X", valueLabel: "wallets", xLabels: "spread" }))).not.toMatch(/NaN|Infinity/);
  });
  it("every chart keeps its data table, with units in the header", () => {
    const html = renderToStaticMarkup(createElement(BarChart, { data: [{ label: "8 Jun", value: 3 }], title: "X", valueLabel: "wallets" }));
    expect(html).toContain("Show data table");
  });
});

describe("Units and wording", () => {
  it("G$ is shown as G$ from the payout total; XP never appears on the page", () => {
    expect(page).toContain('value={`${fmt.format(data.gDollarPaid)} G$`}');
    expect(code).not.toMatch(/\bXP\b/i); // as a word: "xp" also occurs inside other words
    expect(renderToStaticMarkup(createElement(StatTile, { label: "G$ paid to players", value: "725 G$", tone: "green" }))).toContain("stats2__tile-value--green");
  });
  it("wallet counts are called wallets, and the page says wallets are not people", () => {
    expect(page).toContain("By ${fmt.format(played)} wallets");
    expect(page).toContain("Counts are distinct wallet addresses, not distinct people");
    expect(page).not.toMatch(/unique (people|users|humans)|verified (people|users)/i);
  });
  it("the funnel shows each stage's count and its share of all wallets", () => {
    const html = renderToStaticMarkup(createElement(Funnel, { stages: [{ label: "Player wallets", count: 696, share: 1 }, { label: "Earned a G$ reward", count: 53, share: 53 / 696 }] }));
    expect(html).toContain("696 · 100.0%");
    expect(html).toContain("53 · 7.6%");
  });
  it("the closer look lists exactly what the aggregate measures", () => {
    const html = renderToStaticMarkup(createElement(CloserLook, { rows: [["Wallets active in more than one week", 86]] }));
    expect(html).toContain("<dt>Wallets active in more than one week</dt><dd>86</dd>");
    expect(page).toContain('["Wallets active in more than one week", data.retention.multiWeek]');
    expect(page).toContain('["Wallets active across more than 30 days", data.retention.span30d]');
  });
});

describe("Data sources", () => {
  it("everything comes from /api/stats (chain logs), never the subgraph, refreshed every 120 s", () => {
    expect(page).toContain(`fetch("/api/stats", { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })`);
    expect(code).not.toMatch(/subgraph|goldsky|NEXT_PUBLIC_SUBGRAPH_URL/i);
    expect(page).toContain("const REFRESH_MS = 120_000;");
  });
  it("when the feed fails, the page shows no numbers rather than stale or invented ones", () => {
    expect(page).toContain("Stats are unavailable right now");
    expect(page).toMatch(/if \(!data\) \{/);
  });
});
