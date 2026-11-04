/**
 * Profile "UBI contributed": totals come only from the subgraph's verified UbiContribution sums,
 * a failure is never shown as zero, and nothing is shown as an amount before contributions exist.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchUbiTotals, formatUbiAmount, ubiStat, ubiTotalsQuery, type UbiTotals } from "./ubiProfile";
import StatCard from "../components/StatCard";

const URL = "https://subgraph.example/gn";
const ALICE = "0xAA5E2B37666AFCA1B6AAC7B108A9BDECAA44DFE8";
const BOB = "0x00000000000000000000000000000000000b0b00";
const G = 10n ** 18n;
const READY = { status: "ready" as const, bps: 500n, recipient: "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1" as `0x${string}` };
const src = (p: string) => readFileSync(join(__dirname, p), "utf8");

/** A fetch that answers with `body` (or fails) and records the GraphQL query it was sent. */
function fakeFetch(body: unknown, init: { ok?: boolean; status?: number; reject?: boolean } = {}) {
  const queries: string[] = [];
  const fn = vi.fn(async (_url: string, req?: RequestInit) => {
    queries.push(JSON.parse(String(req?.body)).query);
    if (init.reject) throw new TypeError("network down");
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body } as Response;
  });
  return { fn: fn as unknown as typeof fetch, queries };
}
const player = (o: Partial<Record<string, unknown>> = {}) => ({
  data: { players: [{ id: ALICE.toLowerCase(), totalUbiContributed: "0", ubiContributionCount: 0, totalUbiUnverified: "0", ubiUnverifiedCount: 0, ...o }] },
});
const ready = (totalWei: bigint, count: number, unverifiedWei = 0n, unverifiedCount = 0): UbiTotals =>
  ({ kind: "ready", totalWei, count, unverifiedWei, unverifiedCount });

describe("reading a wallet's totals from the subgraph", () => {
  it("one contribution: the subgraph's verified total, exactly", async () => {
    const f = fakeFetch(player({ totalUbiContributed: "1250000000000000000", ubiContributionCount: 1 }));
    expect(await fetchUbiTotals(URL, ALICE, f.fn)).toEqual(ready(1_250_000_000_000_000_000n, 1));
  });

  it("multiple contributions: the summed total and count, as the subgraph reports them", async () => {
    const f = fakeFetch(player({ totalUbiContributed: "7250000000000000000", ubiContributionCount: 2 }));
    expect(await fetchUbiTotals(URL, ALICE, f.fn)).toEqual(ready(7_250_000_000_000_000_000n, 2));
  });

  it("each wallet is queried for itself, by its lowercase address", async () => {
    const a = fakeFetch(player({ totalUbiContributed: "1250000000000000000", ubiContributionCount: 1 }));
    const b = fakeFetch({ data: { players: [{ id: BOB, totalUbiContributed: "6250000000000000000", ubiContributionCount: 1, totalUbiUnverified: "0", ubiUnverifiedCount: 0 }] } });
    expect(await fetchUbiTotals(URL, ALICE, a.fn)).toMatchObject({ totalWei: 1_250_000_000_000_000_000n });
    expect(await fetchUbiTotals(URL, BOB, b.fn)).toMatchObject({ totalWei: 6_250_000_000_000_000_000n });
    expect(a.queries[0]).toContain(`id: "${ALICE.toLowerCase()}"`);
    expect(b.queries[0]).toContain(`id: "${BOB}"`);
    expect(ubiTotalsQuery(ALICE)).toMatch(/totalUbiContributed[\s\S]*ubiContributionCount[\s\S]*totalUbiUnverified[\s\S]*ubiUnverifiedCount/);
  });

  it("zero contributions, or no indexed player row at all, is a real zero", async () => {
    expect(await fetchUbiTotals(URL, ALICE, fakeFetch(player()).fn)).toEqual(ready(0n, 0));
    expect(await fetchUbiTotals(URL, ALICE, fakeFetch({ data: { players: [] } }).fn)).toEqual(ready(0n, 0));
  });

  it("unverified contributions come back separately and are not added to the total", async () => {
    const f = fakeFetch(player({ totalUbiContributed: "1250000000000000000", ubiContributionCount: 1, totalUbiUnverified: "6000000000000000000", ubiUnverifiedCount: 1 }));
    expect(await fetchUbiTotals(URL, ALICE, f.fn)).toEqual(ready(1_250_000_000_000_000_000n, 1, 6n * G, 1));
  });

  it("a subgraph without the UBI fields (the version before this one) is 'not indexed', not an error and not zero", async () => {
    const errs = { errors: [
      { message: "Type `Player` has no field `totalUbiContributed`" },
      { message: "Type `Player` has no field `ubiContributionCount`" },
    ] };
    expect(await fetchUbiTotals(URL, ALICE, fakeFetch(errs).fn)).toEqual({ kind: "not-indexed" });
  });

  it("every failure is an error, never zero: HTTP, network, other GraphQL errors, bad or inconsistent data", async () => {
    const cases: Array<[unknown, { ok?: boolean; status?: number; reject?: boolean }?]> = [
      [player(), { ok: false, status: 502 }],
      [player(), { reject: true }],
      [{ errors: [{ message: "indexing_error" }] }],
      [{ errors: [{ message: "Type `Player` has no field `somethingElse`" }] }],
      [{ data: {} }],
      [player({ totalUbiContributed: 1.25 })],
      [player({ totalUbiContributed: "-5" })],
      [player({ ubiContributionCount: -1 })],
      [player({ ubiContributionCount: 1.5 })],
      [player({ totalUbiContributed: "1250000000000000000", ubiContributionCount: 0 })], // amount without a count
      [player({ totalUbiContributed: "0", ubiContributionCount: 2 })],                    // count without an amount
    ];
    for (const [body, init] of cases) {
      const r = await fetchUbiTotals(URL, ALICE, fakeFetch(body, init).fn);
      expect(r.kind, JSON.stringify(body)).toBe("error");
    }
  });

  it("refuses a non-address without sending a query, and reports a missing subgraph as an error", async () => {
    const f = fakeFetch(player());
    expect((await fetchUbiTotals(URL, 'x" } } evil { ', f.fn)).kind).toBe("error");
    expect((await fetchUbiTotals("", ALICE, f.fn)).kind).toBe("error");
    expect(f.fn).not.toHaveBeenCalled();
  });
});

describe("formatting G$ amounts (integer arithmetic only)", () => {
  it("shows whole and two-decimal amounts, and marks dust instead of showing 0", () => {
    expect(formatUbiAmount(1_250_000_000_000_000_000n)).toBe("1.25 G$"); // 5% of a 25 G$ shield
    expect(formatUbiAmount(2n * G)).toBe("2 G$");                       // 5% of a 40 G$ Undo credit
    expect(formatUbiAmount(6_250_000_000_000_000_000n)).toBe("6.25 G$"); // 5% of a 125 G$ boost
    expect(formatUbiAmount(1_234n * G + G / 2n)).toBe("1,234.50 G$");
    expect(formatUbiAmount(10n ** 16n)).toBe("0.01 G$");
    expect(formatUbiAmount(1n)).toBe("<0.01 G$");
    expect(formatUbiAmount(10n ** 16n - 1n)).toBe("<0.01 G$");
    expect(formatUbiAmount(0n)).toBe("0 G$");
  });

  it("truncates (never rounds a contribution up) and is exact far beyond float precision", () => {
    expect(formatUbiAmount(1_259_999_999_999_999_999n)).toBe("1.25 G$");
    expect(formatUbiAmount(123_456_789_012_345_678_901_234_567n)).toBe("123,456,789.01 G$");
  });

  it("the module does no floating-point work on base units", () => {
    expect(src("./ubiProfile.ts")).not.toMatch(/parseFloat|parseInt|1e18|10 \*\* 18|Number\((total|unverified|wei)/);
  });
});

describe("what the UBI card shows", () => {
  it("loading: a skeleton while the subgraph read is in flight", () => {
    expect(ubiStat({ rate: READY, totals: null })).toEqual({ state: "loading" });
  });

  it("an error says so and never shows a number", () => {
    const v = ubiStat({ rate: READY, totals: { kind: "error", message: "x" } });
    expect(v).toMatchObject({ state: "shown", value: "Unavailable", muted: true });
    expect(JSON.stringify(v)).not.toMatch(/\d/);
  });

  it("before activation (contract has no UBI rate) nothing is shown as an amount", () => {
    for (const rate of [{ status: "unavailable" as const }]) {
      const v = ubiStat({ rate, totals: ready(0n, 0) });
      expect(v).toMatchObject({ state: "shown", value: "Not yet available", muted: true });
      expect(JSON.stringify(v)).not.toMatch(/G\$|\d/);
    }
    expect(ubiStat({ rate: { status: "loading" }, totals: ready(0n, 0) })).toEqual({ state: "loading" });
    expect(ubiStat({ rate: READY, totals: { kind: "not-indexed" } })).toMatchObject({ value: "Not yet available", muted: true });
  });

  it("once active, zero is a real, muted zero with the contract's rate in the caption", () => {
    expect(ubiStat({ rate: READY, totals: ready(0n, 0) })).toEqual({
      state: "shown", value: "0 G$", note: "5% of Shop purchases sent to GoodDollar UBI", muted: true, title: undefined,
    });
    // The rate is the contract's, not a constant.
    expect(ubiStat({ rate: { ...READY, bps: 250n }, totals: ready(0n, 0) })).toMatchObject({ note: "2.5% of Shop purchases sent to GoodDollar UBI" });
  });

  it("one or many contributions: the wallet's verified total", () => {
    expect(ubiStat({ rate: READY, totals: ready(1_250_000_000_000_000_000n, 1) })).toEqual({
      state: "shown", value: "1.25 G$", note: "5% of Shop purchases sent to GoodDollar UBI", muted: false, title: "From 1 verified contribution",
    });
    expect(ubiStat({ rate: READY, totals: ready(7_250_000_000_000_000_000n, 2) })).toMatchObject({ value: "7.25 G$", title: "From 2 verified contributions" });
  });

  it("small contributions show as <0.01 G$, not 0", () => {
    expect(ubiStat({ rate: READY, totals: ready(1n, 1) })).toMatchObject({ value: "<0.01 G$", muted: false });
  });

  it("recorded totals still show if the rate can't be read; the caption just drops the number", () => {
    expect(ubiStat({ rate: { status: "unavailable" }, totals: ready(2n * G, 1) })).toMatchObject({
      value: "2 G$", note: "Shop purchases sent to GoodDollar UBI",
    });
  });

  it("contributions awaiting verification are mentioned and not counted", () => {
    expect(ubiStat({ rate: READY, totals: ready(2n * G, 1, 6n * G, 1) })).toMatchObject({
      value: "2 G$", note: "5% of Shop purchases sent to GoodDollar UBI · 1 contribution awaiting verification",
    });
    expect(ubiStat({ rate: READY, totals: ready(0n, 0, 6n * G, 2) })).toMatchObject({ value: "0 G$", note: expect.stringContaining("2 contributions awaiting verification") });
  });
});

describe("the profile card", () => {
  const card = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(StatCard, { label: "UBI contributed", value: null, ...props } as any));

  it("renders the label, value and caption; a status is muted; loading is a skeleton", () => {
    const html = card({ value: "1.25 G$", note: "5% of Shop purchases sent to GoodDollar UBI", title: "From 1 verified contribution" });
    expect(html).toContain("UBI contributed");
    expect(html).toContain("1.25 G$");
    expect(html).toContain('<p class="stat-card__note">5% of Shop purchases sent to GoodDollar UBI</p>');
    expect(html).toContain('title="From 1 verified contribution"');
    expect(card({ value: "Unavailable", muted: true })).toContain('<span class="stat-card__empty">Unavailable</span>');
    expect(card({ loading: true })).toContain("stat-card__skeleton");
  });

  it("existing cards render exactly as before (no caption unless given one)", () => {
    const html = renderToStaticMarkup(createElement(StatCard, { label: "G$ Spent", value: "25", loading: false, error: false }));
    expect(html).toBe('<div class="stat-card"><div class="stat-card__header"><span class="stat-card__label">G$ Spent</span></div><div class="stat-card__value"><span class="">25</span></div></div>');
  });

  it("sits beside G$ Spent, fed only by the subgraph totals and the contract's rate", () => {
    const view = src("../../app/profile/[identifier]/ProfileView.tsx");
    const spent = view.indexOf('label="G$ Spent"'), ubi = view.indexOf('label="UBI contributed"');
    expect(spent).toBeGreaterThan(0);
    expect(ubi).toBeGreaterThan(spent);
    expect(view.slice(spent, ubi).match(/<StatCard/g)).toHaveLength(1); // the very next card
    expect(view).toContain("const ubiRate = useUbiContribution();");
    expect(view).toContain("const ubiCard = ubiStat({ rate: ubiRate, totals: ubi });");
    expect(view).not.toMatch(/5%|UBI_CONTRIBUTION_BPS|\* ?0\.05|\/ ?20n/); // no hard-coded rate or client-side calculation
  });

  it("the query is per wallet and separate from the G$ query, whose failures are swallowed", () => {
    const hook = src("../hooks/useProfileData.ts");
    expect(hook).toContain('queryKey: ["profile-player-ubi", address?.toLowerCase()]');
    expect(hook).toContain("queryFn: () => fetchUbiTotals(subgraphUrl, address as string)");
    expect(hook).toContain(": ubiTotals ?? null;"); // loading stays null, never a default zero
    expect(hook).toContain('queryKey: ["profile-player-gdollar", address]'); // unchanged
  });
});
